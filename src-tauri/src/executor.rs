use std::cmp::Reverse;
use std::collections::hash_map::Entry;
use std::collections::{BTreeMap, BinaryHeap, HashMap, HashSet};
use std::ops::Range;
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use rusqlite::Connection;
use uuid::Uuid;

use crate::contracts::{
    BatchKind, BatchOutcome, BatchProgress, BatchResult, BatchStatus, Plan, RenameFailure,
    SkipReason, SkippedStep, StepRole, StepStatus,
};
use crate::drives::Drives;
use crate::error::CommandError;
use crate::journal::{
    self, BatchVolume, Fingerprint, JournalPath, JournalStep, NewBatch, RecordedStep, StepOutcome,
};
use crate::names;
use crate::platform;

#[derive(Debug, Clone, Default)]
pub struct BatchGate(Arc<AtomicBool>);

struct BatchTicket(Arc<AtomicBool>);

impl BatchGate {
    fn enter(&self) -> Result<BatchTicket, CommandError> {
        self.0
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map(|_| BatchTicket(self.0.clone()))
            .map_err(|_| CommandError::BatchAlreadyRunning)
    }
}

impl Drop for BatchTicket {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

pub fn execute(
    gate: &BatchGate,
    journal: &JournalPath,
    plan: Plan,
    progress: impl Fn(BatchProgress),
) -> Result<BatchResult, CommandError> {
    let _ticket = gate.enter()?;
    revalidate_steps(&plan)?;
    let volumes = plan_volumes(&plan)?;

    let mut connection = journal.open()?;
    if journal::plan_was_applied(&connection, &plan.plan_id)? {
        return Err(CommandError::InvalidRequest(
            "this plan has already been applied".to_string(),
        ));
    }

    let batch_id = Uuid::now_v7().to_string();
    let steps = with_source_fingerprints(&plan);
    let batch = NewBatch {
        id: &batch_id,
        kind: BatchKind::Rename,
        undoes_batch_id: None,
        plan_id: Some(&plan.plan_id),
        volumes: &volumes,
    };
    journal::begin_batch(&mut connection, &batch, &steps)?;
    progress(BatchProgress::Started {
        batch_id: batch_id.clone(),
        total_steps: steps.len() as u32,
    });

    let drives = Drives::as_recorded(&volumes);
    let result = run_rename_steps(&mut connection, &batch_id, &steps, &drives, &progress);
    if result.is_err() {
        let _ = journal::interrupt_batch(&mut connection, &batch_id, &drives);
    }
    result
}

fn with_source_fingerprints(plan: &Plan) -> Vec<JournalStep> {
    let mut parked: HashMap<&str, Option<Fingerprint>> = HashMap::new();
    plan.steps
        .iter()
        .map(|plan_step| {
            let mut step = JournalStep::from(plan_step);
            step.fingerprint = match step.role {
                StepRole::FromTemporary => parked.get(plan_step.row_id.as_str()).copied().flatten(),
                StepRole::Direct | StepRole::ToTemporary => Fingerprint::of(Path::new(&step.from)),
            };
            if step.role == StepRole::ToTemporary {
                parked.insert(&plan_step.row_id, step.fingerprint);
            }
            step
        })
        .collect()
}

fn plan_volumes(plan: &Plan) -> Result<Vec<BatchVolume>, CommandError> {
    let mut volumes: Vec<BatchVolume> = Vec::new();
    let mut checked_folders = HashSet::new();
    for step in &plan.steps {
        let Some(folder) = Path::new(&step.from).parent() else {
            continue;
        };
        if !checked_folders.insert(folder) {
            continue;
        }
        let volume = platform::volume_info(folder)?;
        if volume.id != step.volume_id {
            return Err(CommandError::InvalidRequest(format!(
                "the drive holding step {} changed after planning",
                step.position
            )));
        }
        match volumes.iter().find(|known| known.volume_id == volume.id) {
            Some(known) if known.mount_point != volume.mount_point => {
                return Err(CommandError::DriveMountedTwice(volume.label));
            }
            Some(_) => {}
            None => volumes.push(BatchVolume {
                volume_id: volume.id,
                mount_point: volume.mount_point,
                label: volume.label,
            }),
        }
    }
    Ok(volumes)
}

fn run_rename_steps(
    connection: &mut Connection,
    batch_id: &str,
    steps: &[JournalStep],
    drives: &Drives,
    progress: &impl Fn(BatchProgress),
) -> Result<BatchResult, CommandError> {
    let total_steps = steps.len() as u32;
    let mut touched_paths = Vec::new();

    for (index, step) in steps.iter().enumerate() {
        let next_position = steps.get(index + 1).map(|next| next.position);
        match platform::rename_no_overwrite(Path::new(&step.from), Path::new(&step.to)) {
            Ok(()) => {
                let fingerprint = Fingerprint::of(Path::new(&step.to));
                journal::record_step(
                    connection,
                    batch_id,
                    step.position,
                    StepOutcome::Done(fingerprint),
                    next_position,
                )?;
                touched_paths.push(step.to.clone());
                progress(BatchProgress::StepDone {
                    position: step.position,
                    row_id: step.row_id.clone(),
                });
            }
            Err(failure) => {
                let failure = drives.blame_a_lost_drive(&step.volume_id, failure);
                journal::record_step(
                    connection,
                    batch_id,
                    step.position,
                    StepOutcome::Failed(&failure),
                    None,
                )?;
                journal::finish_batch(connection, batch_id, BatchStatus::Stopped)?;
                return Ok(BatchResult {
                    batch_id: batch_id.to_string(),
                    kind: BatchKind::Rename,
                    outcome: BatchOutcome::Stopped {
                        position: step.position,
                        row_id: step.row_id.clone(),
                        failure,
                    },
                    completed_steps: index as u32,
                    total_steps,
                    skipped: Vec::new(),
                    touched_paths,
                });
            }
        }
    }

    journal::finish_batch(connection, batch_id, BatchStatus::Completed)?;
    Ok(BatchResult {
        batch_id: batch_id.to_string(),
        kind: BatchKind::Rename,
        outcome: BatchOutcome::Completed,
        completed_steps: total_steps,
        total_steps,
        skipped: Vec::new(),
        touched_paths,
    })
}

pub fn resume(
    gate: &BatchGate,
    journal: &JournalPath,
    batch_id: &str,
    progress: impl Fn(BatchProgress),
) -> Result<BatchResult, CommandError> {
    let _ticket = gate.enter()?;
    let mut connection = journal.open()?;

    let batch = journal::load_batch(&connection, batch_id)?
        .ok_or_else(|| CommandError::BatchNotFound(batch_id.to_string()))?;
    let stopped_part_way = matches!(
        batch.status,
        BatchStatus::Stopped | BatchStatus::Interrupted
    );
    if batch.kind != BatchKind::Rename || !stopped_part_way {
        return Err(CommandError::InvalidRequest(
            "only a rename that stopped part-way can be resumed".to_string(),
        ));
    }

    let volumes = journal::load_batch_volumes(&connection, batch_id)?;
    let mut drives = Drives::find(&volumes)?;
    journal::settle_batch_and_its_undo_batches(&mut connection, batch_id, &drives)?;
    let recorded = journal::load_steps(&connection, batch_id)?;
    refuse_unless_it_can_resume(&recorded)?;
    requeue_renames_that_never_reached_the_disk(&connection, batch_id, &recorded, &drives)?;

    let steps: Vec<JournalStep> = pending_steps(&journal::load_steps(&connection, batch_id)?)?
        .into_iter()
        .map(|step| JournalStep {
            from: drives.translate(&step.volume_id, &step.from),
            to: drives.translate(&step.volume_id, &step.to),
            ..step
        })
        .collect();
    for step in &steps {
        revalidate_step(step.position, &step.from, &step.to)?;
    }
    if let Some(reason) = group_blocker(&steps, &mut drives) {
        return Err(CommandError::ResumeBlocked(
            match reason {
                SkipReason::FileChanged => "a file waiting to be renamed has changed",
                SkipReason::FileMissing => "a file waiting to be renamed is no longer there",
                SkipReason::OriginalNameTaken => "another file now has one of the new names",
            }
            .to_string(),
        ));
    }

    journal::restart_batch(&mut connection, batch_id, steps[0].position)?;
    progress(BatchProgress::Started {
        batch_id: batch_id.to_string(),
        total_steps: steps.len() as u32,
    });
    let result = run_rename_steps(&mut connection, batch_id, &steps, &drives, &progress);
    if result.is_err() {
        let _ = journal::interrupt_batch(&mut connection, batch_id, &drives);
    }
    result
}

fn requeue_renames_that_never_reached_the_disk(
    connection: &Connection,
    batch_id: &str,
    recorded: &[RecordedStep],
    drives: &Drives,
) -> Result<(), CommandError> {
    for (index, recorded_step) in recorded.iter().enumerate().rev() {
        if recorded_step.status != StepStatus::Done {
            continue;
        }
        let step = &recorded_step.step;
        let Some(fingerprint) = step.fingerprint else {
            break;
        };
        let fingerprint_at =
            |path: &str| Fingerprint::of(Path::new(&drives.translate(&step.volume_id, path)));
        let parking = (step.role == StepRole::FromTemporary)
            .then(|| {
                recorded[..index].iter().rev().find(|earlier| {
                    earlier.step.role == StepRole::ToTemporary && earlier.step.row_id == step.row_id
                })
            })
            .flatten();
        let still_before_this_step = fingerprint_at(&step.from) == Some(fingerprint)
            || parking
                .is_some_and(|parking| fingerprint_at(&parking.step.from) == Some(fingerprint));
        let target_holds_it = fingerprint_at(&step.to) == Some(fingerprint);
        if !still_before_this_step || target_holds_it {
            break;
        }
        journal::set_step_status(connection, batch_id, step.position, StepStatus::Planned)?;
    }
    Ok(())
}

fn cannot_resume(reason: &str) -> CommandError {
    CommandError::InvalidRequest(format!("this batch can't be resumed: {reason}"))
}

fn refuse_unless_it_can_resume(recorded: &[RecordedStep]) -> Result<(), CommandError> {
    let any = |status: StepStatus| {
        recorded
            .iter()
            .any(|recorded_step| recorded_step.status == status)
    };
    if any(StepStatus::Undone) {
        return Err(cannot_resume("part of it has been undone"));
    }
    if any(StepStatus::Started) {
        return Err(cannot_resume(
            "it's unclear whether one of its renames happened",
        ));
    }
    Ok(())
}

fn pending_steps(recorded: &[RecordedStep]) -> Result<Vec<JournalStep>, CommandError> {
    let is_pending = |recorded_step: &RecordedStep| {
        matches!(
            recorded_step.status,
            StepStatus::Planned | StepStatus::Failed
        )
    };
    let Some(first_pending) = recorded.iter().position(is_pending) else {
        return Err(cannot_resume("nothing is left to rename"));
    };
    let pending = &recorded[first_pending..];
    if !pending.iter().all(is_pending) {
        return Err(cannot_resume(
            "its finished and unfinished renames are out of order",
        ));
    }
    if pending
        .iter()
        .any(|recorded_step| recorded_step.step.fingerprint.is_none())
    {
        return Err(cannot_resume("it was made by an older version of Dub"));
    }
    Ok(pending
        .iter()
        .map(|recorded_step| recorded_step.step.clone())
        .collect())
}

pub fn undo(
    gate: &BatchGate,
    journal: &JournalPath,
    batch_id: &str,
    progress: impl Fn(BatchProgress),
) -> Result<BatchResult, CommandError> {
    undo_with(
        gate,
        journal,
        batch_id,
        progress,
        &platform::rename_no_overwrite,
    )
}

fn undo_with(
    gate: &BatchGate,
    journal: &JournalPath,
    batch_id: &str,
    progress: impl Fn(BatchProgress),
    rename: &impl Fn(&Path, &Path) -> Result<(), RenameFailure>,
) -> Result<BatchResult, CommandError> {
    let _ticket = gate.enter()?;
    let mut connection = journal.open()?;

    let original = journal::load_batch(&connection, batch_id)?
        .ok_or_else(|| CommandError::BatchNotFound(batch_id.to_string()))?;
    if original.kind != BatchKind::Rename {
        return Err(CommandError::InvalidRequest(
            "an undo can't itself be undone".to_string(),
        ));
    }
    if original.status == BatchStatus::Running {
        return Err(CommandError::InvalidRequest(
            "batch is still running and can't be undone".to_string(),
        ));
    }

    let recorded_volumes = journal::load_batch_volumes(&connection, batch_id)?;
    let mut drives = Drives::find(&recorded_volumes)?;
    journal::settle_batch_and_its_undo_batches(&mut connection, batch_id, &drives)?;

    let recorded = journal::load_steps(&connection, batch_id)?;
    let mut steps: Vec<JournalStep> = Vec::new();
    let mut units: Vec<Range<usize>> = Vec::new();
    for unit in undo_units(&recorded) {
        let start = steps.len();
        for index in unit {
            let original = &recorded[index].step;
            steps.push(JournalStep {
                position: steps.len() as u32 + 1,
                row_id: original.row_id.clone(),
                group_id: original.group_id.clone(),
                role: inverse(original.role),
                volume_id: original.volume_id.clone(),
                from: drives.translate(&original.volume_id, &original.to),
                to: drives.translate(&original.volume_id, &original.from),
                undoes_position: Some(original.position),
                fingerprint: original.fingerprint,
            });
        }
        units.push(start..steps.len());
    }
    if steps.is_empty() {
        return Err(CommandError::InvalidRequest(
            "nothing in this batch is left to undo".to_string(),
        ));
    }

    let undo_id = Uuid::now_v7().to_string();
    let current_volumes = drives.current_volumes(&recorded_volumes);
    let batch = NewBatch {
        id: &undo_id,
        kind: BatchKind::Undo,
        undoes_batch_id: Some(batch_id),
        plan_id: None,
        volumes: &current_volumes,
    };
    journal::begin_batch(&mut connection, &batch, &steps)?;
    progress(BatchProgress::Started {
        batch_id: undo_id.clone(),
        total_steps: steps.len() as u32,
    });

    let result = run_undo_steps(
        &mut connection,
        &undo_id,
        &steps,
        &units,
        &mut drives,
        &progress,
        rename,
    );
    if result.is_err() {
        let drives = Drives::as_recorded(&current_volumes);
        let _ = journal::interrupt_batch(&mut connection, &undo_id, &drives);
    }
    result
}

fn run_undo_steps(
    connection: &mut Connection,
    undo_id: &str,
    steps: &[JournalStep],
    units: &[Range<usize>],
    drives: &mut Drives,
    progress: &impl Fn(BatchProgress),
    rename: &impl Fn(&Path, &Path) -> Result<(), RenameFailure>,
) -> Result<BatchResult, CommandError> {
    let total_steps = steps.len() as u32;
    let mut skipped = Vec::new();
    let mut touched_paths = Vec::new();
    let mut completed_steps = 0u32;
    let next_position = |index: usize| steps.get(index + 1).map(|next| next.position);

    for group in units.iter().cloned() {
        if let Some(reason) = group_blocker(&steps[group.clone()], drives) {
            for index in group {
                let step = &steps[index];
                journal::record_step(
                    connection,
                    undo_id,
                    step.position,
                    StepOutcome::Skipped(reason),
                    next_position(index),
                )?;
                skipped.push(SkippedStep {
                    position: step.position,
                    row_id: step.row_id.clone(),
                    reason,
                });
            }
            continue;
        }

        let mut moved: Vec<usize> = Vec::new();
        for index in group.clone() {
            let step = &steps[index];
            match rename(Path::new(&step.from), Path::new(&step.to)) {
                Ok(()) => {
                    let fingerprint = Fingerprint::of(Path::new(&step.to));
                    journal::record_step(
                        connection,
                        undo_id,
                        step.position,
                        StepOutcome::Done(fingerprint),
                        next_position(index),
                    )?;
                    moved.push(index);
                }
                Err(failure) => {
                    let failure = drives.blame_a_lost_drive(&step.volume_id, failure);
                    journal::record_step(
                        connection,
                        undo_id,
                        step.position,
                        StepOutcome::Failed(&failure),
                        None,
                    )?;
                    let stranded = roll_back(connection, undo_id, steps, &moved, rename)?;
                    touched_paths.extend(stranded);
                    journal::finish_batch(connection, undo_id, BatchStatus::Stopped)?;
                    return Ok(BatchResult {
                        batch_id: undo_id.to_string(),
                        kind: BatchKind::Undo,
                        outcome: BatchOutcome::Stopped {
                            position: step.position,
                            row_id: step.row_id.clone(),
                            failure,
                        },
                        completed_steps,
                        total_steps,
                        skipped,
                        touched_paths,
                    });
                }
            }
        }

        for index in moved {
            let step = &steps[index];
            touched_paths.push(step.to.clone());
            completed_steps += 1;
            progress(BatchProgress::StepDone {
                position: step.position,
                row_id: step.row_id.clone(),
            });
        }
    }

    journal::finish_batch(connection, undo_id, BatchStatus::Completed)?;
    Ok(BatchResult {
        batch_id: undo_id.to_string(),
        kind: BatchKind::Undo,
        outcome: BatchOutcome::Completed,
        completed_steps,
        total_steps,
        skipped,
        touched_paths,
    })
}

fn roll_back(
    connection: &mut Connection,
    undo_id: &str,
    steps: &[JournalStep],
    moved: &[usize],
    rename: &impl Fn(&Path, &Path) -> Result<(), RenameFailure>,
) -> Result<Vec<String>, CommandError> {
    let mut stranded = Vec::new();
    for &index in moved.iter().rev() {
        let step = &steps[index];
        if rename(Path::new(&step.to), Path::new(&step.from)).is_ok() {
            journal::record_step(
                connection,
                undo_id,
                step.position,
                StepOutcome::RolledBack,
                None,
            )?;
        } else {
            stranded.push(step.to.clone());
        }
    }
    Ok(stranded)
}

fn undo_units(recorded: &[RecordedStep]) -> Vec<Vec<usize>> {
    let mut joined = UnionFind::new(recorded.len());
    let mut first_in_group: HashMap<&str, usize> = HashMap::new();
    let mut cycle_start = None;
    for (index, recorded_step) in recorded.iter().enumerate() {
        let step = &recorded_step.step;
        match first_in_group.entry(step.group_id.as_str()) {
            Entry::Occupied(first) => joined.join(*first.get(), index),
            Entry::Vacant(slot) => {
                slot.insert(index);
            }
        }
        if step.role == StepRole::ToTemporary {
            cycle_start = Some(index);
        }
        if let Some(start) = cycle_start {
            joined.join(start, index);
        }
        if step.role == StepRole::FromTemporary {
            cycle_start = None;
        }
    }

    let mut members: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for index in (0..recorded.len()).filter(|index| recorded[*index].status == StepStatus::Done) {
        members.entry(joined.root(index)).or_default().push(index);
    }
    order_units(recorded, members.into_values().collect())
}

fn order_units(recorded: &[RecordedStep], units: Vec<Vec<usize>>) -> Vec<Vec<usize>> {
    let unit_by_source: HashMap<String, usize> = units
        .iter()
        .enumerate()
        .flat_map(|(unit, members)| {
            members
                .iter()
                .map(move |index| (names::collision_key(&recorded[*index].step.from), unit))
        })
        .collect();

    let mut waiting_on = vec![0usize; units.len()];
    let mut releases: Vec<Vec<usize>> = vec![Vec::new(); units.len()];
    for (unit, members) in units.iter().enumerate() {
        for index in members {
            let target = names::collision_key(&recorded[*index].step.to);
            if let Some(&blocked) = unit_by_source.get(&target)
                && blocked != unit
            {
                releases[unit].push(blocked);
                waiting_on[blocked] += 1;
            }
        }
    }

    let latest = |unit: usize| units[unit].last().copied().unwrap_or_default();
    let mut ready: BinaryHeap<(usize, usize)> = (0..units.len())
        .filter(|unit| waiting_on[*unit] == 0)
        .map(|unit| (latest(unit), unit))
        .collect();
    let mut order = Vec::with_capacity(units.len());
    let mut placed = vec![false; units.len()];
    while let Some((_, unit)) = ready.pop() {
        order.push(unit);
        placed[unit] = true;
        for &released in &releases[unit] {
            waiting_on[released] -= 1;
            if waiting_on[released] == 0 {
                ready.push((latest(released), released));
            }
        }
    }
    let mut stuck: Vec<usize> = (0..units.len()).filter(|unit| !placed[*unit]).collect();
    stuck.sort_by_key(|unit| Reverse(latest(*unit)));
    order.extend(stuck);

    order
        .into_iter()
        .map(|unit| units[unit].iter().rev().copied().collect())
        .collect()
}

struct UnionFind(Vec<usize>);

impl UnionFind {
    fn new(size: usize) -> Self {
        Self((0..size).collect())
    }

    fn root(&mut self, mut index: usize) -> usize {
        while self.0[index] != index {
            self.0[index] = self.0[self.0[index]];
            index = self.0[index];
        }
        index
    }

    fn join(&mut self, left: usize, right: usize) {
        let (left, right) = (self.root(left), self.root(right));
        self.0[left.max(right)] = left.min(right);
    }
}

fn group_blocker(group: &[JournalStep], drives: &mut Drives) -> Option<SkipReason> {
    let mut vacated_in_group: HashSet<String> = HashSet::new();
    let mut created_in_group: HashSet<String> = HashSet::new();

    for step in group {
        if !drives.holds(&step.volume_id, &step.from) {
            return Some(SkipReason::FileMissing);
        }
        let from_key = names::collision_key(&step.from);
        let to_key = names::collision_key(&step.to);

        if !created_in_group.contains(&from_key) {
            match Fingerprint::of(Path::new(&step.from)) {
                None => return Some(SkipReason::FileMissing),
                Some(current) if Some(current) != step.fingerprint => {
                    return Some(SkipReason::FileChanged);
                }
                Some(_) => {}
            }
        }
        if !vacated_in_group.contains(&to_key) && platform::path_present(Path::new(&step.to)) {
            return Some(SkipReason::OriginalNameTaken);
        }

        vacated_in_group.insert(from_key);
        vacated_in_group.remove(&to_key);
        created_in_group.insert(to_key);
    }
    None
}

fn revalidate_steps(plan: &Plan) -> Result<(), CommandError> {
    for (index, step) in plan.steps.iter().enumerate() {
        if step.position != index as u32 + 1 {
            return Err(CommandError::InvalidRequest(
                "steps are out of order".to_string(),
            ));
        }
        revalidate_step(step.position, &step.from, &step.to)?;
    }
    Ok(())
}

fn revalidate_step(position: u32, from: &str, to: &str) -> Result<(), CommandError> {
    let from = Path::new(from);
    let to = Path::new(to);
    if from.parent() != to.parent() {
        return Err(CommandError::InvalidRequest(format!(
            "step {position} leaves its folder"
        )));
    }
    let name = to
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    if !names::validate_name(name).is_empty() {
        return Err(CommandError::InvalidRequest(format!(
            "step {position} has an invalid name"
        )));
    }
    Ok(())
}

fn inverse(role: StepRole) -> StepRole {
    match role {
        StepRole::Direct => StepRole::Direct,
        StepRole::ToTemporary => StepRole::FromTemporary,
        StepRole::FromTemporary => StepRole::ToTemporary,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contracts::{
        JournalEntry, PlanRequest, ProposedRename, RenameFailure, RenameTarget,
    };
    use crate::planner::{self, DiskProbe};
    use std::fs;
    use std::time::{Duration, SystemTime};

    struct Workspace {
        folder: tempfile::TempDir,
        journal: JournalPath,
        gate: BatchGate,
    }

    impl Workspace {
        fn new(files: &[&str]) -> Self {
            let folder = tempfile::tempdir().unwrap();
            for name in files {
                fs::write(folder.path().join(name), name.as_bytes()).unwrap();
            }
            let journal = JournalPath(folder.path().join("journal.db"));
            Self {
                folder,
                journal,
                gate: BatchGate::default(),
            }
        }

        fn path(&self, name: &str) -> String {
            self.folder.path().join(name).to_string_lossy().into_owned()
        }

        fn plan(&self, renames: &[(&str, &str)]) -> Plan {
            let renames: Vec<(&str, &str, Option<&str>)> = renames
                .iter()
                .map(|(from, to)| (*from, *to, None))
                .collect();
            self.plan_with_companions(&renames)
        }

        fn plan_with_companions(&self, renames: &[(&str, &str, Option<&str>)]) -> Plan {
            let renames = renames
                .iter()
                .map(|(from, to, video)| ProposedRename {
                    row_id: from.to_string(),
                    source: self.path(from),
                    target: RenameTarget::SameFolder {
                        name: to.to_string(),
                    },
                    companion_of: video.map(str::to_string),
                })
                .collect();
            planner::plan(
                PlanRequest {
                    revision: 1,
                    renames,
                },
                &mut DiskProbe::default(),
            )
        }

        fn contents(&self, name: &str) -> Option<String> {
            fs::read_to_string(self.folder.path().join(name)).ok()
        }

        fn set_modified(&self, name: &str, time: SystemTime) {
            fs::File::options()
                .write(true)
                .open(self.path(name))
                .unwrap()
                .set_modified(time)
                .unwrap();
        }

        fn change(&self, name: &str) -> SystemTime {
            let original_time = fs::metadata(self.path(name)).unwrap().modified().unwrap();
            self.set_modified(name, SystemTime::now() + Duration::from_secs(3600));
            original_time
        }

        fn names(&self) -> Vec<String> {
            let mut names: Vec<String> = fs::read_dir(self.folder.path())
                .unwrap()
                .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
                .filter(|name| !name.starts_with("journal.db"))
                .collect();
            names.sort();
            names
        }

        fn batch_status(&self, batch_id: &str) -> BatchStatus {
            journal::load_batch(&self.journal.open().unwrap(), batch_id)
                .unwrap()
                .unwrap()
                .status
        }

        fn begin_without_running(&self, plan: &Plan) -> &'static str {
            const BATCH_ID: &str = "interrupted";
            let steps = with_source_fingerprints(plan);
            let volumes = plan_volumes(plan).unwrap();
            let batch = NewBatch {
                id: BATCH_ID,
                kind: BatchKind::Rename,
                undoes_batch_id: None,
                plan_id: Some(&plan.plan_id),
                volumes: &volumes,
            };
            journal::begin_batch(&mut self.journal.open().unwrap(), &batch, &steps).unwrap();
            BATCH_ID
        }

        fn newest_history_entry(&self) -> JournalEntry {
            journal::history(&self.journal.open().unwrap(), 1)
                .unwrap()
                .remove(0)
        }

        fn step_statuses(&self, batch_id: &str) -> Vec<StepStatus> {
            journal::load_steps(&self.journal.open().unwrap(), batch_id)
                .unwrap()
                .into_iter()
                .map(|recorded| recorded.status)
                .collect()
        }
    }

    fn fails_from_a_temporary_name(from: &Path, to: &Path) -> Result<(), RenameFailure> {
        let name = from.file_name().unwrap().to_string_lossy();
        if name.starts_with("dub-tmp-") {
            return Err(RenameFailure::FileInUse);
        }
        platform::rename_no_overwrite(from, to)
    }

    #[test]
    fn rename_refuses_to_overwrite() {
        let workspace = Workspace::new(&["a.txt", "b.txt"]);
        let result = platform::rename_no_overwrite(
            Path::new(&workspace.path("a.txt")),
            Path::new(&workspace.path("b.txt")),
        );
        assert_eq!(result, Err(RenameFailure::TargetExists));
        assert_eq!(workspace.contents("b.txt").as_deref(), Some("b.txt"));
        assert_eq!(workspace.contents("a.txt").as_deref(), Some("a.txt"));
    }

    #[test]
    fn execute_then_undo_restores_every_name() {
        let workspace = Workspace::new(&["a.txt", "b.txt", "c.txt"]);
        let plan = workspace.plan(&[("a.txt", "b.txt"), ("b.txt", "a.txt"), ("c.txt", "d.txt")]);
        assert_eq!(plan.steps.len(), 4);

        let result = execute(&workspace.gate, &workspace.journal, plan, |_| {}).unwrap();
        assert_eq!(result.outcome, BatchOutcome::Completed);
        assert_eq!(workspace.contents("b.txt").as_deref(), Some("a.txt"));
        assert_eq!(workspace.contents("a.txt").as_deref(), Some("b.txt"));
        assert_eq!(workspace.contents("d.txt").as_deref(), Some("c.txt"));

        let undone = undo(
            &workspace.gate,
            &workspace.journal,
            &result.batch_id,
            |_| {},
        )
        .unwrap();
        assert_eq!(undone.outcome, BatchOutcome::Completed);
        assert!(undone.skipped.is_empty());
        assert_eq!(workspace.names(), vec!["a.txt", "b.txt", "c.txt"]);
        assert_eq!(workspace.contents("a.txt").as_deref(), Some("a.txt"));
        assert_eq!(
            workspace.step_statuses(&result.batch_id),
            vec![StepStatus::Undone; 4]
        );
    }

    #[test]
    fn a_failed_rollback_leaves_the_file_undone_and_the_next_undo_finishes() {
        let workspace = Workspace::new(&["a.txt", "b.txt"]);
        let plan = workspace.plan(&[("a.txt", "b.txt"), ("b.txt", "a.txt")]);
        let result = execute(&workspace.gate, &workspace.journal, plan, |_| {}).unwrap();

        let first = undo_with(
            &workspace.gate,
            &workspace.journal,
            &result.batch_id,
            |_| {},
            &fails_from_a_temporary_name,
        )
        .unwrap();
        assert!(matches!(first.outcome, BatchOutcome::Stopped { .. }));
        let names = workspace.names();
        assert_eq!(names[0], "a.txt");
        assert!(names[1].starts_with("dub-tmp-"));
        assert_eq!(
            workspace.step_statuses(&result.batch_id),
            vec![StepStatus::Done, StepStatus::Done, StepStatus::Undone]
        );

        let second = undo(
            &workspace.gate,
            &workspace.journal,
            &result.batch_id,
            |_| {},
        )
        .unwrap();
        assert!(second.skipped.is_empty());
        assert_eq!(workspace.names(), vec!["a.txt", "b.txt"]);
        assert_eq!(workspace.contents("a.txt").as_deref(), Some("a.txt"));
        assert_eq!(workspace.contents("b.txt").as_deref(), Some("b.txt"));
    }

    #[test]
    fn an_interrupted_undo_marks_the_original_step() {
        let workspace = Workspace::new(&["a.txt", "b.txt"]);
        let plan = workspace.plan(&[("a.txt", "b.txt"), ("b.txt", "a.txt")]);
        let result = execute(&workspace.gate, &workspace.journal, plan, |_| {}).unwrap();

        let quits_on_the_second_rename = |from: &Path, to: &Path| {
            if to.ends_with("b.txt") {
                panic!("the app quit");
            }
            platform::rename_no_overwrite(from, to)
        };
        let crashed = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            undo_with(
                &workspace.gate,
                &workspace.journal,
                &result.batch_id,
                |_| {},
                &quits_on_the_second_rename,
            )
        }));
        assert!(crashed.is_err());
        assert_eq!(
            workspace.step_statuses(&result.batch_id),
            vec![StepStatus::Done, StepStatus::Done, StepStatus::Undone]
        );

        journal::recover(&workspace.journal).unwrap();
        let undone = undo(
            &workspace.gate,
            &workspace.journal,
            &result.batch_id,
            |_| {},
        )
        .unwrap();
        assert!(undone.skipped.is_empty());
        assert_eq!(workspace.names(), vec!["a.txt", "b.txt"]);
        assert_eq!(workspace.contents("a.txt").as_deref(), Some("a.txt"));
    }

    #[test]
    fn case_only_rename_changes_the_case_on_disk() {
        let workspace = Workspace::new(&["smallville.mkv"]);
        let plan = workspace.plan(&[("smallville.mkv", "Smallville.mkv")]);
        execute(&workspace.gate, &workspace.journal, plan, |_| {}).unwrap();
        assert_eq!(workspace.names(), vec!["Smallville.mkv"]);
    }

    #[test]
    fn a_started_rename_found_on_disk_can_be_undone() {
        let workspace = Workspace::new(&["a.txt"]);
        let plan = workspace.plan(&[("a.txt", "b.txt")]);
        let batch_id = workspace.begin_without_running(&plan);
        fs::rename(workspace.path("a.txt"), workspace.path("b.txt")).unwrap();

        journal::recover(&workspace.journal).unwrap();
        assert_eq!(workspace.batch_status(batch_id), BatchStatus::Interrupted);
        assert_eq!(workspace.step_statuses(batch_id), vec![StepStatus::Done]);

        undo(&workspace.gate, &workspace.journal, batch_id, |_| {}).unwrap();
        assert_eq!(workspace.names(), vec!["a.txt"]);
    }

    #[test]
    fn a_started_rename_that_did_not_happen_is_planned_again() {
        let workspace = Workspace::new(&["a.txt"]);
        let plan = workspace.plan(&[("a.txt", "b.txt")]);
        let batch_id = workspace.begin_without_running(&plan);

        journal::recover(&workspace.journal).unwrap();
        assert_eq!(workspace.batch_status(batch_id), BatchStatus::Interrupted);
        assert_eq!(workspace.step_statuses(batch_id), vec![StepStatus::Planned]);

        let undone = undo(&workspace.gate, &workspace.journal, batch_id, |_| {});
        assert!(matches!(undone, Err(CommandError::InvalidRequest(_))));
        assert_eq!(workspace.names(), vec!["a.txt"]);
    }

    #[test]
    fn a_plan_can_only_be_applied_once() {
        let workspace = Workspace::new(&["a.txt", "b.txt"]);
        let plan = workspace.plan(&[("a.txt", "b.txt"), ("b.txt", "a.txt")]);
        execute(&workspace.gate, &workspace.journal, plan.clone(), |_| {}).unwrap();

        let again = execute(&workspace.gate, &workspace.journal, plan, |_| {});
        assert!(matches!(again, Err(CommandError::InvalidRequest(_))));
        assert_eq!(workspace.contents("a.txt").as_deref(), Some("b.txt"));
    }

    #[test]
    fn a_changed_file_in_a_swap_skips_the_whole_swap() {
        let workspace = Workspace::new(&["a.txt", "b.txt"]);
        let plan = workspace.plan(&[("a.txt", "b.txt"), ("b.txt", "a.txt")]);
        let result = execute(&workspace.gate, &workspace.journal, plan, |_| {}).unwrap();

        workspace.change("a.txt");
        let undone = undo(
            &workspace.gate,
            &workspace.journal,
            &result.batch_id,
            |_| {},
        )
        .unwrap();
        assert_eq!(undone.outcome, BatchOutcome::Completed);
        assert_eq!(undone.skipped.len(), 3);
        assert_eq!(workspace.names(), vec!["a.txt", "b.txt"]);
        assert_eq!(workspace.contents("a.txt").as_deref(), Some("b.txt"));
    }

    #[test]
    fn a_partially_undone_batch_can_be_undone_again() {
        let workspace = Workspace::new(&["a.txt", "b.txt"]);
        let plan = workspace.plan(&[("a.txt", "x.txt"), ("b.txt", "y.txt")]);
        let result = execute(&workspace.gate, &workspace.journal, plan, |_| {}).unwrap();

        let original_time = workspace.change("x.txt");
        let first = undo(
            &workspace.gate,
            &workspace.journal,
            &result.batch_id,
            |_| {},
        )
        .unwrap();
        assert_eq!(first.skipped.len(), 1);
        assert_eq!(first.skipped[0].reason, SkipReason::FileChanged);
        assert_eq!(workspace.names(), vec!["b.txt", "x.txt"]);
        assert_eq!(
            workspace.step_statuses(&result.batch_id),
            vec![StepStatus::Done, StepStatus::Undone]
        );

        workspace.set_modified("x.txt", original_time);
        let second = undo(
            &workspace.gate,
            &workspace.journal,
            &result.batch_id,
            |_| {},
        )
        .unwrap();
        assert!(second.skipped.is_empty());
        assert_eq!(workspace.names(), vec!["a.txt", "b.txt"]);
        assert_eq!(
            workspace.step_statuses(&result.batch_id),
            vec![StepStatus::Undone; 2]
        );
    }

    #[test]
    fn a_changed_companion_keeps_its_video_renamed() {
        let workspace = Workspace::new(&["v.mkv", "v.en.srt", "v.nfo"]);
        let plan = workspace.plan_with_companions(&[
            ("v.mkv", "w.mkv", None),
            ("v.en.srt", "w.en.srt", Some("v.mkv")),
            ("v.nfo", "w.nfo", Some("v.mkv")),
        ]);
        let result = execute(&workspace.gate, &workspace.journal, plan, |_| {}).unwrap();

        workspace.change("w.en.srt");
        let undone = undo(
            &workspace.gate,
            &workspace.journal,
            &result.batch_id,
            |_| {},
        )
        .unwrap();
        assert_eq!(undone.skipped.len(), 3);
        assert_eq!(workspace.names(), vec!["w.en.srt", "w.mkv", "w.nfo"]);
    }

    fn renumber_season(workspace: &Workspace) -> BatchResult {
        let plan = workspace.plan_with_companions(&[
            ("e1.mkv", "e2.mkv", None),
            ("e1.srt", "e2.srt", Some("e1.mkv")),
            ("e2.mkv", "e3.mkv", None),
            ("e2.srt", "e3.srt", Some("e2.mkv")),
        ]);
        let result = execute(&workspace.gate, &workspace.journal, plan, |_| {}).unwrap();
        assert_eq!(
            workspace.names(),
            vec!["e2.mkv", "e2.srt", "e3.mkv", "e3.srt"]
        );
        result
    }

    #[test]
    fn undo_restores_a_renumbered_season_with_subtitles() {
        let workspace = Workspace::new(&["e1.mkv", "e1.srt", "e2.mkv", "e2.srt"]);
        let result = renumber_season(&workspace);

        let undone = undo(
            &workspace.gate,
            &workspace.journal,
            &result.batch_id,
            |_| {},
        )
        .unwrap();
        assert!(undone.skipped.is_empty());
        assert_eq!(
            workspace.names(),
            vec!["e1.mkv", "e1.srt", "e2.mkv", "e2.srt"]
        );
        assert_eq!(workspace.contents("e1.srt").as_deref(), Some("e1.srt"));
        assert_eq!(workspace.contents("e2.mkv").as_deref(), Some("e2.mkv"));
    }

    #[test]
    fn a_changed_file_blocks_the_units_waiting_on_its_name() {
        let workspace = Workspace::new(&["e1.mkv", "e1.srt", "e2.mkv", "e2.srt"]);
        let result = renumber_season(&workspace);

        workspace.change("e2.mkv");
        let undone = undo(
            &workspace.gate,
            &workspace.journal,
            &result.batch_id,
            |_| {},
        )
        .unwrap();
        assert_eq!(undone.skipped.len(), 4);
        assert_eq!(
            workspace.names(),
            vec!["e2.mkv", "e2.srt", "e3.mkv", "e3.srt"]
        );
    }

    #[test]
    fn undo_waits_for_the_unit_holding_its_original_name() {
        let workspace = Workspace::new(&["x.mkv", "x.srt", "y.mkv", "y.nfo"]);
        let plan = workspace.plan_with_companions(&[
            ("x.mkv", "y.mkv", None),
            ("x.srt", "y.srt", Some("x.mkv")),
            ("y.mkv", "z.mkv", None),
            ("y.nfo", "z.nfo", Some("y.mkv")),
        ]);
        let order: Vec<&str> = plan.steps.iter().map(|step| step.row_id.as_str()).collect();
        assert_eq!(order, vec!["y.mkv", "x.mkv", "x.srt", "y.nfo"]);
        let result = execute(&workspace.gate, &workspace.journal, plan, |_| {}).unwrap();

        let undone = undo(
            &workspace.gate,
            &workspace.journal,
            &result.batch_id,
            |_| {},
        )
        .unwrap();
        assert!(undone.skipped.is_empty());
        assert_eq!(workspace.names(), vec!["x.mkv", "x.srt", "y.mkv", "y.nfo"]);
        assert_eq!(workspace.contents("y.mkv").as_deref(), Some("y.mkv"));
    }

    #[test]
    fn execute_stops_at_the_first_failure() {
        let workspace = Workspace::new(&["a.txt", "b.txt"]);
        let plan = workspace.plan(&[("a.txt", "x.txt"), ("b.txt", "y.txt")]);
        fs::write(workspace.path("y.txt"), "arrived after planning").unwrap();

        let result = execute(&workspace.gate, &workspace.journal, plan, |_| {}).unwrap();
        assert!(matches!(
            result.outcome,
            BatchOutcome::Stopped {
                failure: RenameFailure::TargetExists,
                ..
            }
        ));
        assert_eq!(result.completed_steps, 1);
        assert_eq!(
            workspace.contents("y.txt").as_deref(),
            Some("arrived after planning")
        );
    }

    #[test]
    fn steps_that_leave_their_folder_are_rejected() {
        let workspace = Workspace::new(&["a.txt"]);
        let mut plan = workspace.plan(&[("a.txt", "b.txt")]);
        plan.steps[0].to = std::env::temp_dir()
            .join("escaped.txt")
            .to_string_lossy()
            .into_owned();
        let result = execute(&workspace.gate, &workspace.journal, plan, |_| {});
        assert!(matches!(result, Err(CommandError::InvalidRequest(_))));
        assert_eq!(workspace.names(), vec!["a.txt"]);
    }

    fn stop_before_the_second_rename(workspace: &Workspace) -> BatchResult {
        let plan = workspace.plan(&[("a.txt", "x.txt"), ("b.txt", "y.txt")]);
        fs::write(workspace.path("y.txt"), "in the way").unwrap();
        let stopped = execute(&workspace.gate, &workspace.journal, plan, |_| {}).unwrap();
        assert!(matches!(stopped.outcome, BatchOutcome::Stopped { .. }));
        fs::remove_file(workspace.path("y.txt")).unwrap();
        stopped
    }

    #[test]
    fn a_stopped_batch_resumes_from_the_failed_step() {
        let workspace = Workspace::new(&["a.txt", "b.txt"]);
        let stopped = stop_before_the_second_rename(&workspace);
        let entry = workspace.newest_history_entry();
        assert!(entry.can_resume && entry.can_undo);
        assert_eq!(entry.stop_reason, Some(RenameFailure::TargetExists));
        assert_eq!((entry.total_files, entry.renamed_files), (2, 1));

        let resumed = resume(
            &workspace.gate,
            &workspace.journal,
            &stopped.batch_id,
            |_| {},
        )
        .unwrap();
        assert_eq!(resumed.outcome, BatchOutcome::Completed);
        assert_eq!(workspace.names(), vec!["x.txt", "y.txt"]);
        assert_eq!(workspace.contents("y.txt").as_deref(), Some("b.txt"));
        assert_eq!(
            workspace.batch_status(&stopped.batch_id),
            BatchStatus::Completed
        );

        undo(
            &workspace.gate,
            &workspace.journal,
            &stopped.batch_id,
            |_| {},
        )
        .unwrap();
        assert_eq!(workspace.names(), vec!["a.txt", "b.txt"]);
        let entry = workspace.newest_history_entry();
        assert!(!entry.can_resume && !entry.can_undo);
        assert_eq!(entry.undone_files, 2);
    }

    #[test]
    fn an_interrupted_batch_resumes() {
        let workspace = Workspace::new(&["a.txt", "b.txt"]);
        let plan = workspace.plan(&[("a.txt", "x.txt"), ("b.txt", "y.txt")]);
        let batch_id = workspace.begin_without_running(&plan);
        fs::rename(workspace.path("a.txt"), workspace.path("x.txt")).unwrap();
        journal::recover(&workspace.journal).unwrap();
        assert_eq!(
            workspace.step_statuses(batch_id),
            vec![StepStatus::Done, StepStatus::Planned]
        );

        let resumed = resume(&workspace.gate, &workspace.journal, batch_id, |_| {}).unwrap();
        assert_eq!(resumed.outcome, BatchOutcome::Completed);
        assert_eq!(workspace.names(), vec!["x.txt", "y.txt"]);
    }

    #[test]
    fn resume_refuses_when_a_waiting_file_changed() {
        let workspace = Workspace::new(&["a.txt", "b.txt"]);
        let stopped = stop_before_the_second_rename(&workspace);
        workspace.change("b.txt");

        let refused = resume(
            &workspace.gate,
            &workspace.journal,
            &stopped.batch_id,
            |_| {},
        );
        assert!(matches!(refused, Err(CommandError::ResumeBlocked(_))));
        assert_eq!(workspace.names(), vec!["b.txt", "x.txt"]);
    }

    #[test]
    fn resume_finishes_a_swap_left_on_its_temporary_name() {
        let workspace = Workspace::new(&["a.txt", "b.txt"]);
        let plan = workspace.plan(&[("a.txt", "b.txt"), ("b.txt", "a.txt")]);
        let temporary = plan.steps[0].to.clone();
        let batch_id = workspace.begin_without_running(&plan);
        fs::rename(workspace.path("a.txt"), &temporary).unwrap();
        journal::recover(&workspace.journal).unwrap();

        let resumed = resume(&workspace.gate, &workspace.journal, batch_id, |_| {}).unwrap();
        assert_eq!(resumed.outcome, BatchOutcome::Completed);
        assert_eq!(workspace.names(), vec!["a.txt", "b.txt"]);
        assert_eq!(workspace.contents("a.txt").as_deref(), Some("b.txt"));
        assert_eq!(workspace.contents("b.txt").as_deref(), Some("a.txt"));
    }

    #[test]
    fn resume_retries_renames_that_never_reached_the_disk() {
        let workspace = Workspace::new(&["a.txt", "b.txt"]);
        let plan = workspace.plan(&[("a.txt", "x.txt"), ("b.txt", "y.txt")]);
        let batch_id = workspace.begin_without_running(&plan);
        let mut connection = workspace.journal.open().unwrap();
        let fingerprint = Fingerprint::of(Path::new(&workspace.path("a.txt")));
        journal::record_step(
            &mut connection,
            batch_id,
            1,
            StepOutcome::Done(fingerprint),
            Some(2),
        )
        .unwrap();
        journal::record_step(
            &mut connection,
            batch_id,
            2,
            StepOutcome::Failed(&RenameFailure::SourceMissing),
            None,
        )
        .unwrap();
        journal::finish_batch(&connection, batch_id, BatchStatus::Stopped).unwrap();

        let resumed = resume(&workspace.gate, &workspace.journal, batch_id, |_| {}).unwrap();
        assert_eq!(resumed.completed_steps, 2);
        assert_eq!(workspace.names(), vec!["x.txt", "y.txt"]);
    }

    #[test]
    fn resume_retries_a_swap_that_never_reached_the_disk() {
        let workspace = Workspace::new(&["a.txt", "bb.txt", "c.txt"]);
        let plan = workspace.plan(&[("a.txt", "bb.txt"), ("bb.txt", "a.txt"), ("c.txt", "d.txt")]);
        let batch_id = workspace.begin_without_running(&plan);
        fs::rename(workspace.path("c.txt"), workspace.path("d.txt")).unwrap();
        let mut connection = workspace.journal.open().unwrap();
        for position in 1..=4 {
            let next_position = (position < 4).then_some(position + 1);
            journal::record_step(
                &mut connection,
                batch_id,
                position,
                StepOutcome::Done(None),
                next_position,
            )
            .unwrap();
        }
        journal::finish_batch(&connection, batch_id, BatchStatus::Interrupted).unwrap();

        let resumed = resume(&workspace.gate, &workspace.journal, batch_id, |_| {}).unwrap();
        assert_eq!(resumed.completed_steps, 3);
        assert_eq!(workspace.names(), vec!["a.txt", "bb.txt", "d.txt"]);
        assert_eq!(workspace.contents("a.txt").as_deref(), Some("bb.txt"));
        assert_eq!(workspace.contents("bb.txt").as_deref(), Some("a.txt"));
    }

    #[test]
    fn a_partly_undone_batch_cannot_be_resumed() {
        let workspace = Workspace::new(&["a.txt", "b.txt"]);
        let stopped = stop_before_the_second_rename(&workspace);
        undo(
            &workspace.gate,
            &workspace.journal,
            &stopped.batch_id,
            |_| {},
        )
        .unwrap();

        let refused = resume(
            &workspace.gate,
            &workspace.journal,
            &stopped.batch_id,
            |_| {},
        );
        assert!(matches!(refused, Err(CommandError::InvalidRequest(_))));
        assert_eq!(workspace.names(), vec!["a.txt", "b.txt"]);
    }

    #[test]
    fn execute_refuses_a_plan_whose_drive_changed() {
        let workspace = Workspace::new(&["a.txt"]);
        let mut plan = workspace.plan(&[("a.txt", "b.txt")]);
        plan.steps[0].volume_id = "uuid:00000000-0000-0000-0000-000000000000".to_string();
        let result = execute(&workspace.gate, &workspace.journal, plan, |_| {});
        assert!(matches!(result, Err(CommandError::InvalidRequest(_))));
        assert_eq!(workspace.names(), vec!["a.txt"]);
    }

    #[test]
    #[ignore = "creates and mounts a disk image with hdiutil"]
    fn undo_works_after_the_image_is_remounted_elsewhere() {
        let scratch = tempfile::tempdir().unwrap();
        let path = |name: &str| scratch.path().join(name).to_string_lossy().into_owned();
        let (image, first_mount, second_mount) =
            (path("remount.dmg"), path("first"), path("second"));
        let hdiutil = |arguments: &[&str]| {
            let status = std::process::Command::new("hdiutil")
                .args(arguments)
                .status()
                .unwrap();
            assert!(status.success(), "hdiutil {arguments:?} failed");
        };
        hdiutil(&[
            "create",
            "-size",
            "16m",
            "-fs",
            "APFS",
            "-volname",
            "Remounted",
            &image,
        ]);
        hdiutil(&["attach", "-nobrowse", "-mountpoint", &first_mount, &image]);

        let file = |mount: &str, name: &str| Path::new(mount).join(name);
        fs::write(file(&first_mount, "a.txt"), "a").unwrap();
        fs::write(file(&first_mount, "b.txt"), "b").unwrap();
        let journal = JournalPath(scratch.path().join("journal.db"));
        let gate = BatchGate::default();
        let renames = [("a.txt", "b.txt"), ("b.txt", "c.txt")]
            .iter()
            .map(|(from, to)| ProposedRename {
                row_id: from.to_string(),
                source: file(&first_mount, from).to_string_lossy().into_owned(),
                target: RenameTarget::SameFolder {
                    name: to.to_string(),
                },
                companion_of: None,
            })
            .collect();
        let plan = planner::plan(
            PlanRequest {
                revision: 1,
                renames,
            },
            &mut DiskProbe::default(),
        );
        let result = execute(&gate, &journal, plan, |_| {}).unwrap();
        assert_eq!(result.outcome, BatchOutcome::Completed);

        hdiutil(&["detach", &first_mount]);
        let missing = undo(&gate, &journal, &result.batch_id, |_| {});
        assert!(matches!(missing, Err(CommandError::DriveNotConnected(_))));

        hdiutil(&["attach", "-nobrowse", "-mountpoint", &second_mount, &image]);
        let undone = undo(&gate, &journal, &result.batch_id, |_| {}).unwrap();
        let contents = |name: &str| fs::read_to_string(file(&second_mount, name)).ok();
        let restored = (contents("a.txt"), contents("b.txt"), contents("c.txt"));
        hdiutil(&["detach", &second_mount]);

        assert!(undone.skipped.is_empty());
        assert_eq!(
            restored,
            (Some("a".to_string()), Some("b".to_string()), None)
        );
    }

    #[test]
    #[ignore = "needs DUB_TEST_VOLUME pointing at a writable folder on the drive under test"]
    fn volume_rules_hold_on_the_test_volume() {
        let root = std::env::var("DUB_TEST_VOLUME").expect("set DUB_TEST_VOLUME");
        let folder = tempfile::tempdir_in(&root).unwrap();
        let path = |name: &str| folder.path().join(name);
        let names = || {
            let mut names: Vec<String> = fs::read_dir(folder.path())
                .unwrap()
                .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
                .filter(|name| !name.starts_with("._"))
                .collect();
            names.sort();
            names
        };

        let volume = platform::volume_info(folder.path()).unwrap();
        println!("volume: {volume:#?}");

        fs::write(path("a.txt"), "a").unwrap();
        fs::write(path("b.txt"), "b").unwrap();
        assert_eq!(
            platform::rename_no_overwrite(&path("a.txt"), &path("b.txt")),
            Err(RenameFailure::TargetExists),
            "an overwrite must be refused"
        );
        assert_eq!(fs::read_to_string(path("b.txt")).unwrap(), "b");

        assert_eq!(
            platform::rename_no_overwrite(&path("a.txt"), &path("B.TXT")),
            Err(RenameFailure::TargetExists),
            "a name differing only in case must count as taken"
        );

        let journal = JournalPath(
            std::env::temp_dir().join(format!("dub-volume-test-{}.db", Uuid::now_v7())),
        );
        let gate = BatchGate::default();
        let plan_for = |from: &str, to: &str| {
            planner::plan(
                PlanRequest {
                    revision: 1,
                    renames: vec![ProposedRename {
                        row_id: from.to_string(),
                        source: path(from).to_string_lossy().into_owned(),
                        target: RenameTarget::SameFolder {
                            name: to.to_string(),
                        },
                        companion_of: None,
                    }],
                },
                &mut DiskProbe::default(),
            )
        };

        let case_only = execute(&gate, &journal, plan_for("a.txt", "A.txt"), |_| {}).unwrap();
        assert_eq!(case_only.outcome, BatchOutcome::Completed);
        assert_eq!(names(), vec!["A.txt", "b.txt"]);

        fs::write(path("Poke\u{301}mon.txt"), "p").unwrap();
        let normalised = execute(
            &gate,
            &journal,
            plan_for("Poke\u{301}mon.txt", "Pokémon.txt"),
            |_| {},
        )
        .unwrap();
        assert_eq!(normalised.outcome, BatchOutcome::Completed);
        println!("names after NFD to NFC: {:?}", names());

        let longest_cjk_name = format!("{}.txt", "葬".repeat(251));
        assert_eq!(longest_cjk_name.encode_utf16().count(), 255);
        assert_eq!(longest_cjk_name.len(), 757);
        fs::write(path("c.txt"), "c").unwrap();
        execute(
            &gate,
            &journal,
            plan_for("c.txt", &longest_cjk_name),
            |_| {},
        )
        .unwrap();
        assert!(
            names().contains(&longest_cjk_name),
            "the drive rejected a 255-unit CJK name"
        );

        let undone = undo(&gate, &journal, &case_only.batch_id, |_| {}).unwrap();
        assert_eq!(undone.outcome, BatchOutcome::Completed);
        assert!(names().contains(&"a.txt".to_string()));
        let _ = fs::remove_file(&journal.0);
    }

    #[test]
    #[ignore = "needs DUB_TEST_READ_ONLY_VOLUME pointing at a read-only drive with at least one file"]
    fn read_only_volumes_are_detected_and_blocked() {
        let root =
            std::env::var("DUB_TEST_READ_ONLY_VOLUME").expect("set DUB_TEST_READ_ONLY_VOLUME");
        let volume = platform::volume_info(Path::new(&root)).unwrap();
        println!("volume: {volume:#?}");
        assert_eq!(volume.access, crate::contracts::VolumeAccess::ReadOnly);

        let file = fs::read_dir(&root)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .find(|path| path.is_file())
            .expect("the drive needs at least one file");
        let plan = planner::plan(
            PlanRequest {
                revision: 1,
                renames: vec![ProposedRename {
                    row_id: "file".to_string(),
                    source: file.to_string_lossy().into_owned(),
                    target: RenameTarget::SameFolder {
                        name: "renamed.txt".to_string(),
                    },
                    companion_of: None,
                }],
            },
            &mut DiskProbe::default(),
        );
        assert!(plan.steps.is_empty());
        println!("row: {:?}", plan.rows[0].outcome);
    }

    #[test]
    #[ignore = "timing measurement, run by hand"]
    fn thousand_renames_timing() {
        let names: Vec<String> = (0..1000)
            .map(|index| format!("file-{index:04}.txt"))
            .collect();
        let name_refs: Vec<&str> = names.iter().map(String::as_str).collect();
        let workspace = Workspace::new(&name_refs);
        let renames: Vec<(String, String)> = names
            .iter()
            .map(|name| (name.clone(), format!("renamed-{name}")))
            .collect();
        let rename_refs: Vec<(&str, &str)> = renames
            .iter()
            .map(|(from, to)| (from.as_str(), to.as_str()))
            .collect();

        let started = std::time::Instant::now();
        let plan = workspace.plan(&rename_refs);
        let planned = started.elapsed();
        let result = execute(&workspace.gate, &workspace.journal, plan, |_| {}).unwrap();
        let executed = started.elapsed() - planned;
        assert_eq!(result.outcome, BatchOutcome::Completed);
        println!(
            "planning 1,000 renames: {planned:?}; executing with a full fsync per step: {executed:?}"
        );
    }
}
