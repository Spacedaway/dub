use std::collections::HashSet;
use std::ops::Range;
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use rusqlite::Connection;
use uuid::Uuid;

use crate::contracts::{
    BatchKind, BatchOutcome, BatchProgress, BatchResult, BatchStatus, Plan, SkipReason,
    SkippedStep, StepRole,
};
use crate::error::CommandError;
use crate::journal::{
    self, Fingerprint, JournalPath, JournalStep, NewBatch, RecordedStep, StepOutcome, StepStatus,
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

    let mut connection = journal.open()?;
    if journal::plan_was_applied(&connection, &plan.plan_id)? {
        return Err(CommandError::InvalidRequest(
            "this plan has already been applied".to_string(),
        ));
    }

    let batch_id = Uuid::now_v7().to_string();
    let steps: Vec<JournalStep> = plan.steps.iter().map(JournalStep::from).collect();
    let batch = NewBatch {
        id: &batch_id,
        kind: BatchKind::Rename,
        undoes_batch_id: None,
        plan_id: Some(&plan.plan_id),
    };
    journal::begin_batch(&mut connection, &batch, &steps)?;
    progress(BatchProgress::Started {
        batch_id: batch_id.clone(),
        total_steps: steps.len() as u32,
    });

    let result = run_rename_steps(&mut connection, &batch_id, &steps, &progress);
    if result.is_err() {
        let _ = journal::reconcile_batch(&mut connection, &batch_id);
    }
    result
}

fn run_rename_steps(
    connection: &mut Connection,
    batch_id: &str,
    steps: &[JournalStep],
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

struct UndoStep {
    step: JournalStep,
    original_position: u32,
    expected: Option<Fingerprint>,
}

pub fn undo(
    gate: &BatchGate,
    journal: &JournalPath,
    batch_id: &str,
    progress: impl Fn(BatchProgress),
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
    if matches!(original.status, BatchStatus::Running | BatchStatus::Undone) {
        return Err(CommandError::InvalidRequest(format!(
            "batch is {} and can't be undone",
            original.status.as_text()
        )));
    }

    let mut done: Vec<RecordedStep> = journal::load_steps(&connection, batch_id)?
        .into_iter()
        .filter(|recorded| recorded.status == StepStatus::Done)
        .collect();
    if done.is_empty() {
        return Err(CommandError::InvalidRequest(
            "nothing in this batch is left to undo".to_string(),
        ));
    }
    done.reverse();

    let steps: Vec<UndoStep> = done
        .iter()
        .enumerate()
        .map(|(index, recorded)| UndoStep {
            step: JournalStep {
                position: index as u32 + 1,
                row_id: recorded.step.row_id.clone(),
                role: inverse(recorded.step.role),
                volume_id: recorded.step.volume_id.clone(),
                from: recorded.step.to.clone(),
                to: recorded.step.from.clone(),
            },
            original_position: recorded.step.position,
            expected: recorded.fingerprint,
        })
        .collect();

    let undo_id = Uuid::now_v7().to_string();
    let journal_steps: Vec<JournalStep> = steps
        .iter()
        .map(|undo_step| undo_step.step.clone())
        .collect();
    let batch = NewBatch {
        id: &undo_id,
        kind: BatchKind::Undo,
        undoes_batch_id: Some(batch_id),
        plan_id: None,
    };
    journal::begin_batch(&mut connection, &batch, &journal_steps)?;
    progress(BatchProgress::Started {
        batch_id: undo_id.clone(),
        total_steps: steps.len() as u32,
    });

    let result = run_undo_steps(&mut connection, &undo_id, batch_id, &steps, &progress);
    if result.is_err() {
        let _ = journal::reconcile_batch(&mut connection, &undo_id);
    }

    let still_done = journal::load_steps(&connection, batch_id)?
        .iter()
        .any(|recorded| recorded.status == StepStatus::Done);
    let original_status = if still_done {
        BatchStatus::PartiallyUndone
    } else {
        BatchStatus::Undone
    };
    journal::set_batch_status(&connection, batch_id, original_status)?;
    result
}

fn run_undo_steps(
    connection: &mut Connection,
    undo_id: &str,
    original_id: &str,
    steps: &[UndoStep],
    progress: &impl Fn(BatchProgress),
) -> Result<BatchResult, CommandError> {
    let total_steps = steps.len() as u32;
    let mut skipped = Vec::new();
    let mut touched_paths = Vec::new();
    let mut completed_steps = 0u32;
    let next_position = |index: usize| steps.get(index + 1).map(|next| next.step.position);

    for group in undo_groups(steps) {
        if let Some(reason) = group_blocker(&steps[group.clone()]) {
            for index in group {
                let step = &steps[index].step;
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
            let step = &steps[index].step;
            match platform::rename_no_overwrite(Path::new(&step.from), Path::new(&step.to)) {
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
                    journal::record_step(
                        connection,
                        undo_id,
                        step.position,
                        StepOutcome::Failed(&failure),
                        None,
                    )?;
                    roll_back(connection, undo_id, steps, &moved)?;
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
            let undo_step = &steps[index];
            journal::set_step_status(
                connection,
                original_id,
                undo_step.original_position,
                StepStatus::Undone,
            )?;
            touched_paths.push(undo_step.step.to.clone());
            completed_steps += 1;
            progress(BatchProgress::StepDone {
                position: undo_step.step.position,
                row_id: undo_step.step.row_id.clone(),
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
    steps: &[UndoStep],
    moved: &[usize],
) -> Result<(), CommandError> {
    for &index in moved.iter().rev() {
        let step = &steps[index].step;
        if platform::rename_no_overwrite(Path::new(&step.to), Path::new(&step.from)).is_ok() {
            journal::record_step(
                connection,
                undo_id,
                step.position,
                StepOutcome::RolledBack,
                None,
            )?;
        }
    }
    Ok(())
}

fn undo_groups(steps: &[UndoStep]) -> Vec<Range<usize>> {
    let mut groups = Vec::new();
    let mut index = 0;
    while index < steps.len() {
        let start = index;
        if steps[index].step.role == StepRole::ToTemporary {
            while index < steps.len() && steps[index].step.role != StepRole::FromTemporary {
                index += 1;
            }
        }
        index = (index + 1).min(steps.len());
        groups.push(start..index);
    }
    groups
}

fn group_blocker(group: &[UndoStep]) -> Option<SkipReason> {
    let mut vacated_in_group: HashSet<String> = HashSet::new();
    let mut created_in_group: HashSet<String> = HashSet::new();

    for undo_step in group {
        let from_key = names::collision_key(&undo_step.step.from);
        let to_key = names::collision_key(&undo_step.step.to);

        if !created_in_group.contains(&from_key) {
            match Fingerprint::of(Path::new(&undo_step.step.from)) {
                None => return Some(SkipReason::FileMissing),
                Some(current) if Some(current) != undo_step.expected => {
                    return Some(SkipReason::FileChanged);
                }
                Some(_) => {}
            }
        }
        if !vacated_in_group.contains(&to_key)
            && platform::path_present(Path::new(&undo_step.step.to))
        {
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
        let from = Path::new(&step.from);
        let to = Path::new(&step.to);
        if from.parent() != to.parent() {
            return Err(CommandError::InvalidRequest(format!(
                "step {} leaves its folder",
                step.position
            )));
        }
        let name = to
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default();
        if !names::validate_name(name).is_empty() {
            return Err(CommandError::InvalidRequest(format!(
                "step {} has an invalid name",
                step.position
            )));
        }
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
    use crate::contracts::{PlanRequest, ProposedRename, RenameFailure, RenameTarget};
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
            let renames = renames
                .iter()
                .map(|(from, to)| ProposedRename {
                    row_id: from.to_string(),
                    source: self.path(from),
                    target: RenameTarget::SameFolder {
                        name: to.to_string(),
                    },
                    companion_of: None,
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
            workspace.batch_status(&result.batch_id),
            BatchStatus::Undone
        );
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
        let steps: Vec<JournalStep> = plan.steps.iter().map(JournalStep::from).collect();
        let batch = NewBatch {
            id: "interrupted",
            kind: BatchKind::Rename,
            undoes_batch_id: None,
            plan_id: Some(&plan.plan_id),
        };
        let mut connection = workspace.journal.open().unwrap();
        journal::begin_batch(&mut connection, &batch, &steps).unwrap();
        fs::rename(workspace.path("a.txt"), workspace.path("b.txt")).unwrap();

        journal::reconcile_batch(&mut connection, batch.id).unwrap();
        assert_eq!(workspace.batch_status(batch.id), BatchStatus::Interrupted);

        undo(&workspace.gate, &workspace.journal, batch.id, |_| {}).unwrap();
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

        let changed = fs::File::options()
            .write(true)
            .open(workspace.path("a.txt"))
            .unwrap();
        changed
            .set_modified(SystemTime::now() + Duration::from_secs(3600))
            .unwrap();

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

        let file = fs::File::options()
            .write(true)
            .open(workspace.path("x.txt"))
            .unwrap();
        let original_time = file.metadata().unwrap().modified().unwrap();
        file.set_modified(SystemTime::now() + Duration::from_secs(3600))
            .unwrap();
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
            workspace.batch_status(&result.batch_id),
            BatchStatus::PartiallyUndone
        );

        file.set_modified(original_time).unwrap();
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
            workspace.batch_status(&result.batch_id),
            BatchStatus::Undone
        );
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
