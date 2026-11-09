use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use uuid::Uuid;

use crate::contracts::{
    Plan, PlanProblem, PlanRequest, PlanStep, PlanWarning, PlannedRow, ProposedRename,
    RenameTarget, RowOutcome, StepRole, VolumeAccess, VolumeInfo,
};
use crate::names;
use crate::platform;

pub const WINDOWS_PATH_LIMIT: usize = 259;
const TEMPORARY_NAME_LIMIT: usize = 250;

pub trait FileProbe {
    fn exists(&mut self, path: &Path) -> bool;
    fn volume(&mut self, directory: &Path) -> Option<VolumeInfo>;
    fn directory_writable(&mut self, directory: &Path) -> bool;
}

#[derive(Default)]
pub struct DiskProbe {
    volumes: HashMap<PathBuf, Option<VolumeInfo>>,
    writable_directories: HashMap<PathBuf, bool>,
}

impl FileProbe for DiskProbe {
    fn exists(&mut self, path: &Path) -> bool {
        platform::path_present(path)
    }

    fn directory_writable(&mut self, directory: &Path) -> bool {
        *self
            .writable_directories
            .entry(directory.to_path_buf())
            .or_insert_with(|| platform::directory_writable(directory))
    }

    fn volume(&mut self, directory: &Path) -> Option<VolumeInfo> {
        self.volumes
            .entry(directory.to_path_buf())
            .or_insert_with(|| platform::volume_info(directory).ok())
            .clone()
    }
}

struct Candidate {
    row_id: String,
    companion_of: Option<String>,
    source_path: String,
    target_path: String,
    source_key: String,
    target_key: String,
    volume_id: String,
    unchanged: bool,
    problems: Vec<PlanProblem>,
    warnings: Vec<PlanWarning>,
}

impl Candidate {
    fn is_blocked(&self) -> bool {
        !self.problems.is_empty()
    }

    fn moves(&self) -> bool {
        !self.unchanged && !self.is_blocked()
    }

    fn group(&self) -> &String {
        self.companion_of.as_ref().unwrap_or(&self.row_id)
    }
}

pub fn plan(request: PlanRequest, probe: &mut impl FileProbe) -> Plan {
    let identifier = Uuid::now_v7();
    let plan_tag = identifier.simple().to_string()[24..].to_string();

    let mut candidates: Vec<Candidate> = request
        .renames
        .iter()
        .map(|rename| inspect(rename, probe))
        .collect();

    block_duplicates(&mut candidates);
    block_occupied_targets(&mut candidates, probe);
    block_companions_without_their_video(&mut candidates);
    cascade_blocks(&mut candidates);
    let steps = order_steps(&candidates, &plan_tag, probe);

    Plan {
        plan_id: identifier.to_string(),
        revision: request.revision,
        rows: candidates.into_iter().map(into_row).collect(),
        steps,
    }
}

fn inspect(rename: &ProposedRename, probe: &mut impl FileProbe) -> Candidate {
    let RenameTarget::SameFolder { name } = &rename.target;
    let source = Path::new(&rename.source);
    let directory = source.parent().map(Path::to_path_buf).unwrap_or_default();
    let target = directory.join(name);
    let source_name = source
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();

    let source_path = rename.source.clone();
    let target_path = target.to_string_lossy().into_owned();
    let unchanged = source_name == name;

    let mut problems = if unchanged {
        Vec::new()
    } else {
        names::validate_name(name)
    };
    let mut warnings = Vec::new();

    let length = target_path.encode_utf16().count();
    if length > WINDOWS_PATH_LIMIT {
        warnings.push(PlanWarning::PathTooLongForWindows {
            length,
            limit: WINDOWS_PATH_LIMIT,
        });
    }

    if !probe.exists(source) {
        problems.push(PlanProblem::SourceMissing);
    }

    let volume = probe.volume(&directory);
    match &volume {
        None => problems.push(PlanProblem::VolumeUnavailable),
        Some(volume) if volume.access == VolumeAccess::ReadOnly && !unchanged => {
            problems.push(PlanProblem::ReadOnlyVolume)
        }
        Some(_) if !unchanged && !probe.directory_writable(&directory) => {
            problems.push(PlanProblem::FolderNotWritable)
        }
        Some(_) => {}
    }

    Candidate {
        row_id: rename.row_id.clone(),
        companion_of: rename.companion_of.clone(),
        source_key: names::collision_key(&source_path),
        target_key: names::collision_key(&target_path),
        source_path,
        target_path,
        volume_id: volume.map(|volume| volume.id).unwrap_or_default(),
        unchanged,
        problems,
        warnings,
    }
}

fn block_duplicates(candidates: &mut [Candidate]) {
    let duplicate_targets = other_rows_sharing_key(candidates, |candidate| {
        (!candidate.unchanged).then_some(&candidate.target_key)
    });
    let duplicate_sources =
        other_rows_sharing_key(candidates, |candidate| Some(&candidate.source_key));

    for (index, candidate) in candidates.iter_mut().enumerate() {
        if let Some(others) = duplicate_targets.get(&index) {
            candidate.problems.push(PlanProblem::DuplicateTarget {
                other_row_ids: others.clone(),
            });
        }
        if let Some(others) = duplicate_sources.get(&index) {
            candidate.problems.push(PlanProblem::DuplicateSource {
                other_row_ids: others.clone(),
            });
        }
    }
}

fn other_rows_sharing_key(
    candidates: &[Candidate],
    key: impl Fn(&Candidate) -> Option<&String>,
) -> HashMap<usize, Vec<String>> {
    let mut groups: HashMap<&String, Vec<usize>> = HashMap::new();
    for (index, candidate) in candidates.iter().enumerate() {
        if let Some(key) = key(candidate) {
            groups.entry(key).or_default().push(index);
        }
    }

    let mut duplicates = HashMap::new();
    for indices in groups.values().filter(|indices| indices.len() > 1) {
        for &index in indices {
            let others = indices
                .iter()
                .filter(|other| **other != index)
                .map(|other| candidates[*other].row_id.clone())
                .collect();
            duplicates.insert(index, others);
        }
    }
    duplicates
}

fn block_occupied_targets(candidates: &mut [Candidate], probe: &mut impl FileProbe) {
    let moving_sources: HashSet<String> = candidates
        .iter()
        .filter(|candidate| !candidate.unchanged)
        .map(|candidate| candidate.source_key.clone())
        .collect();
    let staying_sources: HashSet<String> = candidates
        .iter()
        .filter(|candidate| candidate.unchanged)
        .map(|candidate| candidate.source_key.clone())
        .collect();

    for candidate in candidates.iter_mut() {
        if candidate.unchanged || candidate.target_key == candidate.source_key {
            continue;
        }
        let occupied = staying_sources.contains(&candidate.target_key)
            || (!moving_sources.contains(&candidate.target_key)
                && probe.exists(Path::new(&candidate.target_path)));
        if occupied {
            candidate.problems.push(PlanProblem::TargetExists);
        }
    }
}

fn block_companions_without_their_video(candidates: &mut [Candidate]) {
    let videos: HashSet<String> = candidates
        .iter()
        .filter(|candidate| candidate.companion_of.is_none())
        .map(|candidate| candidate.row_id.clone())
        .collect();

    for candidate in candidates.iter_mut() {
        if let Some(video) = &candidate.companion_of
            && !videos.contains(video)
        {
            candidate.problems.push(PlanProblem::GroupBlocked {
                row_id: video.clone(),
            });
        }
    }
}

fn cascade_blocks(candidates: &mut [Candidate]) {
    loop {
        let blocked_sources = first_blocked_row_by(candidates, |candidate| &candidate.source_key);
        let blocked_groups = first_blocked_row_by(candidates, Candidate::group);

        let mut changed = false;
        for candidate in candidates.iter_mut() {
            if !candidate.moves() {
                continue;
            }
            let problem = if let Some(blocker) = blocked_sources.get(&candidate.target_key) {
                PlanProblem::BlockedByRow {
                    row_id: blocker.clone(),
                }
            } else if let Some(blocker) = blocked_groups.get(candidate.group()) {
                PlanProblem::GroupBlocked {
                    row_id: blocker.clone(),
                }
            } else {
                continue;
            };
            candidate.problems.push(problem);
            changed = true;
        }
        if !changed {
            break;
        }
    }
}

fn first_blocked_row_by(
    candidates: &[Candidate],
    key: impl Fn(&Candidate) -> &String,
) -> HashMap<String, String> {
    let mut rows = HashMap::new();
    for candidate in candidates
        .iter()
        .filter(|candidate| candidate.is_blocked() && !candidate.unchanged)
    {
        rows.entry(key(candidate).clone())
            .or_insert_with(|| candidate.row_id.clone());
    }
    rows
}

fn order_steps(
    candidates: &[Candidate],
    plan_tag: &str,
    probe: &mut impl FileProbe,
) -> Vec<PlanStep> {
    let movers: Vec<usize> = (0..candidates.len())
        .filter(|index| candidates[*index].moves())
        .collect();

    let by_source: HashMap<&str, usize> = movers
        .iter()
        .map(|index| (candidates[*index].source_key.as_str(), *index))
        .collect();

    let waits_for: HashMap<usize, usize> = movers
        .iter()
        .filter_map(|index| {
            by_source
                .get(candidates[*index].target_key.as_str())
                .map(|blocker| (*index, *blocker))
        })
        .collect();
    let waited_on: HashSet<usize> = waits_for.values().copied().collect();

    let mut taken_keys: HashSet<String> = candidates
        .iter()
        .flat_map(|candidate| [candidate.source_key.clone(), candidate.target_key.clone()])
        .collect();
    let mut builder = StepBuilder::default();
    let mut visited = HashSet::new();

    for &start in movers.iter().filter(|index| !waited_on.contains(index)) {
        let mut chain = vec![start];
        while let Some(next) = waits_for.get(chain.last().unwrap()) {
            chain.push(*next);
        }
        for &index in chain.iter().rev() {
            visited.insert(index);
            let candidate = &candidates[index];
            builder.push(
                candidate,
                StepRole::Direct,
                &candidate.source_path,
                &candidate.target_path,
            );
        }
    }

    for &start in &movers {
        if visited.contains(&start) {
            continue;
        }
        let mut cycle = vec![start];
        let mut current = waits_for[&start];
        while current != start {
            cycle.push(current);
            current = waits_for[&current];
        }
        visited.extend(cycle.iter().copied());

        let first = &candidates[start];
        let temporary = temporary_path(first, plan_tag, &mut taken_keys, probe);
        builder.push(first, StepRole::ToTemporary, &first.source_path, &temporary);
        for &index in cycle[1..].iter().rev() {
            let candidate = &candidates[index];
            builder.push(
                candidate,
                StepRole::Direct,
                &candidate.source_path,
                &candidate.target_path,
            );
        }
        builder.push(
            first,
            StepRole::FromTemporary,
            &temporary,
            &first.target_path,
        );
    }

    builder.steps
}

#[derive(Default)]
struct StepBuilder {
    steps: Vec<PlanStep>,
}

impl StepBuilder {
    fn push(&mut self, candidate: &Candidate, role: StepRole, from: &str, to: &str) {
        self.steps.push(PlanStep {
            position: self.steps.len() as u32 + 1,
            row_id: candidate.row_id.clone(),
            group_id: candidate.group().clone(),
            role,
            from: from.to_string(),
            to: to.to_string(),
            volume_id: candidate.volume_id.clone(),
        });
    }
}

fn temporary_path(
    candidate: &Candidate,
    plan_tag: &str,
    taken_keys: &mut HashSet<String>,
    probe: &mut impl FileProbe,
) -> String {
    let source = Path::new(&candidate.source_path);
    let directory = source.parent().unwrap_or(Path::new(""));
    let original = names::safe_fragment(
        source
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default(),
    );

    for counter in 1.. {
        // Trim after truncating: the cut can land just after a dot or space.
        let full = format!("dub-tmp-{plan_tag}-{counter}-{original}");
        let name = truncate_utf16(&full, TEMPORARY_NAME_LIMIT)
            .trim_end_matches(['.', ' '])
            .to_string();
        let path = directory.join(&name).to_string_lossy().into_owned();
        let key = names::collision_key(&path);
        if !taken_keys.contains(&key) && !probe.exists(Path::new(&path)) {
            taken_keys.insert(key);
            return path;
        }
    }
    unreachable!("the counter is unbounded")
}

fn truncate_utf16(text: &str, limit: usize) -> String {
    let mut length = 0;
    text.chars()
        .take_while(|character| {
            length += character.len_utf16();
            length <= limit
        })
        .collect()
}

fn into_row(candidate: Candidate) -> PlannedRow {
    let outcome = if candidate.is_blocked() {
        RowOutcome::Blocked {
            problems: candidate.problems,
            warnings: candidate.warnings,
        }
    } else {
        RowOutcome::Ready {
            target_path: candidate.target_path,
            warnings: candidate.warnings,
        }
    };
    PlannedRow {
        row_id: candidate.row_id,
        outcome,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contracts::{ExclusiveRename, IdStability};

    struct FakeDisk {
        files: HashSet<String>,
        folder_writable: bool,
    }

    impl FakeDisk {
        fn with_files(names: &[&str]) -> Self {
            Self {
                files: names
                    .iter()
                    .map(|name| names::collision_key(&path(name)))
                    .collect(),
                folder_writable: true,
            }
        }
    }

    impl FileProbe for FakeDisk {
        fn exists(&mut self, path: &Path) -> bool {
            self.files
                .contains(&names::collision_key(&path.to_string_lossy()))
        }

        fn directory_writable(&mut self, _directory: &Path) -> bool {
            self.folder_writable
        }

        fn volume(&mut self, _directory: &Path) -> Option<VolumeInfo> {
            Some(VolumeInfo {
                id: "uuid:TEST".to_string(),
                mount_point: "/".to_string(),
                label: "Test".to_string(),
                file_system: "apfs".to_string(),
                access: VolumeAccess::ReadWrite,
                exclusive_rename: ExclusiveRename::Native,
                id_stability: IdStability::Stable,
            })
        }
    }

    fn path(name: &str) -> String {
        Path::new("/media")
            .join(name)
            .to_string_lossy()
            .into_owned()
    }

    fn rename(from: &str, to: &str) -> ProposedRename {
        ProposedRename {
            row_id: from.to_string(),
            source: path(from),
            target: RenameTarget::SameFolder {
                name: to.to_string(),
            },
            companion_of: None,
        }
    }

    fn companion(from: &str, to: &str, video: &str) -> ProposedRename {
        ProposedRename {
            companion_of: Some(video.to_string()),
            ..rename(from, to)
        }
    }

    fn group_blocked(row_id: &str) -> Vec<PlanProblem> {
        vec![PlanProblem::GroupBlocked {
            row_id: row_id.to_string(),
        }]
    }

    fn run(disk: &mut FakeDisk, renames: Vec<ProposedRename>) -> Plan {
        plan(
            PlanRequest {
                revision: 1,
                renames,
            },
            disk,
        )
    }

    fn moves(plan: &Plan) -> Vec<(String, String)> {
        let short = |full: &str| {
            let name = Path::new(full)
                .file_name()
                .unwrap()
                .to_string_lossy()
                .into_owned();
            if name.starts_with("dub-tmp-") {
                "tmp".to_string()
            } else {
                name
            }
        };
        plan.steps
            .iter()
            .map(|step| (short(&step.from), short(&step.to)))
            .collect()
    }

    fn pair(from: &str, to: &str) -> (String, String) {
        (from.to_string(), to.to_string())
    }

    fn problems(plan: &Plan, row_id: &str) -> Vec<PlanProblem> {
        let row = plan.rows.iter().find(|row| row.row_id == row_id).unwrap();
        match &row.outcome {
            RowOutcome::Blocked { problems, .. } => problems.clone(),
            RowOutcome::Ready { .. } => Vec::new(),
        }
    }

    #[test]
    fn duplicate_targets_block_every_row_involved() {
        let mut disk = FakeDisk::with_files(&["a.mkv", "b.mkv"]);
        let plan = run(
            &mut disk,
            vec![rename("a.mkv", "c.mkv"), rename("b.mkv", "C.mkv")],
        );
        assert!(plan.steps.is_empty());
        assert_eq!(
            problems(&plan, "a.mkv"),
            vec![PlanProblem::DuplicateTarget {
                other_row_ids: vec!["b.mkv".to_string()]
            }]
        );
        assert_eq!(
            problems(&plan, "b.mkv"),
            vec![PlanProblem::DuplicateTarget {
                other_row_ids: vec!["a.mkv".to_string()]
            }]
        );
    }

    #[test]
    fn existing_file_outside_the_batch_blocks_the_target() {
        let mut disk = FakeDisk::with_files(&["a.mkv", "b.mkv"]);
        let plan = run(&mut disk, vec![rename("a.mkv", "B.MKV")]);
        assert_eq!(problems(&plan, "a.mkv"), vec![PlanProblem::TargetExists]);
    }

    #[test]
    fn a_file_staying_put_blocks_the_target() {
        let mut disk = FakeDisk::with_files(&["a.mkv", "b.mkv"]);
        let plan = run(
            &mut disk,
            vec![rename("a.mkv", "b.mkv"), rename("b.mkv", "b.mkv")],
        );
        assert_eq!(problems(&plan, "a.mkv"), vec![PlanProblem::TargetExists]);
        assert!(problems(&plan, "b.mkv").is_empty());
    }

    #[test]
    fn chains_run_from_the_far_end() {
        let mut disk = FakeDisk::with_files(&["a.mkv", "b.mkv", "c.mkv"]);
        let plan = run(
            &mut disk,
            vec![
                rename("a.mkv", "b.mkv"),
                rename("b.mkv", "c.mkv"),
                rename("c.mkv", "d.mkv"),
            ],
        );
        assert_eq!(
            moves(&plan),
            vec![
                pair("c.mkv", "d.mkv"),
                pair("b.mkv", "c.mkv"),
                pair("a.mkv", "b.mkv")
            ]
        );
    }

    #[test]
    fn swaps_use_a_temporary_name() {
        let mut disk = FakeDisk::with_files(&["a.mkv", "b.mkv"]);
        let plan = run(
            &mut disk,
            vec![rename("a.mkv", "b.mkv"), rename("b.mkv", "a.mkv")],
        );
        assert_eq!(
            moves(&plan),
            vec![
                pair("a.mkv", "tmp"),
                pair("b.mkv", "a.mkv"),
                pair("tmp", "b.mkv")
            ]
        );
        let roles: Vec<StepRole> = plan.steps.iter().map(|step| step.role).collect();
        assert_eq!(
            roles,
            vec![
                StepRole::ToTemporary,
                StepRole::Direct,
                StepRole::FromTemporary
            ]
        );
    }

    #[test]
    fn three_way_cycles_use_one_temporary_name() {
        let mut disk = FakeDisk::with_files(&["a.mkv", "b.mkv", "c.mkv"]);
        let plan = run(
            &mut disk,
            vec![
                rename("a.mkv", "b.mkv"),
                rename("b.mkv", "c.mkv"),
                rename("c.mkv", "a.mkv"),
            ],
        );
        assert_eq!(
            moves(&plan),
            vec![
                pair("a.mkv", "tmp"),
                pair("c.mkv", "a.mkv"),
                pair("b.mkv", "c.mkv"),
                pair("tmp", "b.mkv"),
            ]
        );
    }

    #[test]
    fn case_only_renames_go_through_a_temporary_name() {
        let mut disk = FakeDisk::with_files(&["smallville.mkv"]);
        let plan = run(&mut disk, vec![rename("smallville.mkv", "Smallville.mkv")]);
        assert_eq!(
            moves(&plan),
            vec![pair("smallville.mkv", "tmp"), pair("tmp", "Smallville.mkv")]
        );
    }

    #[test]
    fn blocks_cascade_to_rows_waiting_on_a_blocked_row() {
        let mut disk = FakeDisk::with_files(&["a.mkv", "b.mkv", "taken.mkv"]);
        let plan = run(
            &mut disk,
            vec![rename("a.mkv", "taken.mkv"), rename("b.mkv", "a.mkv")],
        );
        assert!(plan.steps.is_empty());
        assert_eq!(problems(&plan, "a.mkv"), vec![PlanProblem::TargetExists]);
        assert_eq!(
            problems(&plan, "b.mkv"),
            vec![PlanProblem::BlockedByRow {
                row_id: "a.mkv".to_string()
            }]
        );
    }

    #[test]
    fn a_blocked_companion_blocks_its_video_and_the_other_companions() {
        let mut disk = FakeDisk::with_files(&["a.mkv", "a.en.srt", "a.en.forced.srt", "b.en.srt"]);
        let plan = run(
            &mut disk,
            vec![
                rename("a.mkv", "b.mkv"),
                companion("a.en.srt", "b.en.srt", "a.mkv"),
                companion("a.en.forced.srt", "b.en.forced.srt", "a.mkv"),
            ],
        );
        assert!(plan.steps.is_empty());
        assert_eq!(problems(&plan, "a.en.srt"), vec![PlanProblem::TargetExists]);
        assert_eq!(problems(&plan, "a.mkv"), group_blocked("a.en.srt"));
        assert_eq!(
            problems(&plan, "a.en.forced.srt"),
            group_blocked("a.en.srt")
        );
    }

    #[test]
    fn a_blocked_video_blocks_its_companions() {
        let mut disk = FakeDisk::with_files(&["a.mkv", "b.mkv", "a.en.srt"]);
        let plan = run(
            &mut disk,
            vec![
                rename("a.mkv", "c.mkv"),
                rename("b.mkv", "c.mkv"),
                companion("a.en.srt", "c.en.srt", "a.mkv"),
            ],
        );
        assert!(plan.steps.is_empty());
        assert_eq!(problems(&plan, "a.en.srt"), group_blocked("a.mkv"));
    }

    #[test]
    fn a_companion_sent_without_its_video_is_blocked() {
        let mut disk = FakeDisk::with_files(&["a.mkv", "a.en.srt"]);
        let plan = run(&mut disk, vec![companion("a.en.srt", "b.en.srt", "a.mkv")]);
        assert!(plan.steps.is_empty());
        assert_eq!(problems(&plan, "a.en.srt"), group_blocked("a.mkv"));
    }

    #[test]
    fn group_blocks_and_row_blocks_cascade_into_each_other() {
        let mut disk =
            FakeDisk::with_files(&["a.mkv", "a.en.srt", "b.mkv", "b.nfo", "taken.en.srt"]);
        let plan = run(
            &mut disk,
            vec![
                rename("a.mkv", "taken.mkv"),
                companion("a.en.srt", "taken.en.srt", "a.mkv"),
                rename("b.mkv", "a.mkv"),
                companion("b.nfo", "a.nfo", "b.mkv"),
            ],
        );
        assert!(plan.steps.is_empty());
        assert_eq!(problems(&plan, "a.mkv"), group_blocked("a.en.srt"));
        assert_eq!(
            problems(&plan, "b.mkv"),
            vec![PlanProblem::BlockedByRow {
                row_id: "a.mkv".to_string()
            }]
        );
        assert_eq!(problems(&plan, "b.nfo"), group_blocked("b.mkv"));
    }

    #[test]
    fn invalid_names_are_blocked_not_changed() {
        let mut disk = FakeDisk::with_files(&["a.mkv"]);
        let plan = run(&mut disk, vec![rename("a.mkv", "Re:Zero.mkv")]);
        assert_eq!(
            problems(&plan, "a.mkv"),
            vec![PlanProblem::InvalidCharacters {
                characters: vec![":".to_string()]
            }]
        );
    }

    #[test]
    fn unwritable_folders_are_blocked() {
        let mut disk = FakeDisk::with_files(&["a.mkv"]);
        disk.folder_writable = false;
        let plan = run(&mut disk, vec![rename("a.mkv", "b.mkv")]);
        assert_eq!(
            problems(&plan, "a.mkv"),
            vec![PlanProblem::FolderNotWritable]
        );
    }

    #[test]
    fn temporary_names_never_end_in_a_dot_after_truncation() {
        let kept_from_original = TEMPORARY_NAME_LIMIT - "dub-tmp-12345678-1-".len();
        let original = format!(
            "{}.{}.mkv",
            "a".repeat(kept_from_original - 1),
            "b".repeat(20)
        );
        let swapped = format!(
            "{}.{}.mkv",
            "c".repeat(kept_from_original - 1),
            "d".repeat(20)
        );
        let mut disk = FakeDisk::with_files(&[&original, &swapped]);
        let plan = run(
            &mut disk,
            vec![rename(&original, &swapped), rename(&swapped, &original)],
        );
        let temporary = Path::new(&plan.steps[0].to)
            .file_name()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        assert!(
            names::validate_name(&temporary).is_empty(),
            "{temporary:?} should be valid"
        );
    }
}
