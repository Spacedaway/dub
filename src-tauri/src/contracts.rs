use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanRequest {
    pub paths: Vec<String>,
    pub folders: FolderDepth,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FolderDepth {
    TopLevel,
    Recursive,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResponse {
    pub files: Vec<ScannedFile>,
    pub volumes: Vec<VolumeInfo>,
    pub problems: Vec<ScanProblem>,
    pub junk_skipped: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedFile {
    pub path: String,
    pub directory: String,
    pub name: String,
    pub stem: String,
    pub extension: String,
    pub folder_name: String,
    pub parent_folder_name: Option<String>,
    pub size: u64,
    pub modified_ms: i64,
    pub created_ms: Option<i64>,
    pub volume_id: String,
    pub access: FileAccess,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FileAccess {
    Writable,
    ReadOnlyVolume,
    FolderNotWritable,
}

#[derive(Debug, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ScanProblem {
    NotUnicode { lossy_path: String },
    Unreadable { path: String, message: String },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VolumeInfoRequest {
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VolumeInfo {
    pub id: String,
    pub mount_point: String,
    pub label: String,
    pub file_system: String,
    pub access: VolumeAccess,
    pub exclusive_rename: ExclusiveRename,
    pub id_stability: IdStability,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum VolumeAccess {
    ReadWrite,
    ReadOnly,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ExclusiveRename {
    Native,
    CheckThenRename,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum IdStability {
    Stable,
    MountPathOnly,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanRequest {
    pub revision: u64,
    pub renames: Vec<ProposedRename>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposedRename {
    pub row_id: String,
    pub source: String,
    pub target: RenameTarget,
    pub companion_of: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum RenameTarget {
    SameFolder { name: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub plan_id: String,
    pub revision: u64,
    pub rows: Vec<PlannedRow>,
    pub steps: Vec<PlanStep>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedRow {
    pub row_id: String,
    pub outcome: RowOutcome,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum RowOutcome {
    Ready {
        target_path: String,
        warnings: Vec<PlanWarning>,
    },
    Blocked {
        problems: Vec<PlanProblem>,
        warnings: Vec<PlanWarning>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum PlanProblem {
    EmptyName,
    InvalidCharacters { characters: Vec<String> },
    ReservedName { reserved: String },
    EndsWithDotOrSpace,
    StartsWithDot,
    NotNormalised,
    NameTooLong { length: usize, limit: usize },
    DuplicateTarget { other_row_ids: Vec<String> },
    DuplicateSource { other_row_ids: Vec<String> },
    TargetExists,
    BlockedByRow { row_id: String },
    GroupBlocked { row_id: String },
    SourceMissing,
    ReadOnlyVolume,
    VolumeUnavailable,
    FolderNotWritable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum PlanWarning {
    PathTooLongForWindows { length: usize, limit: usize },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanStep {
    pub position: u32,
    pub row_id: String,
    pub group_id: String,
    pub role: StepRole,
    pub from: String,
    pub to: String,
    pub volume_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StepRole {
    Direct,
    ToTemporary,
    FromTemporary,
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ExecuteRequest {
    Plan { plan: Plan },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoRequest {
    pub batch_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "event",
    content = "data",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum BatchProgress {
    Started { batch_id: String, total_steps: u32 },
    StepDone { position: u32, row_id: String },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchResult {
    pub batch_id: String,
    pub kind: BatchKind,
    pub outcome: BatchOutcome,
    pub completed_steps: u32,
    pub total_steps: u32,
    pub skipped: Vec<SkippedStep>,
    pub touched_paths: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BatchKind {
    Rename,
    Undo,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum BatchOutcome {
    Completed,
    Stopped {
        position: u32,
        row_id: String,
        failure: RenameFailure,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum RenameFailure {
    TargetExists,
    SourceMissing,
    FileInUse,
    PermissionDenied,
    ReadOnlyVolume,
    DifferentVolume,
    NameTooLong,
    Other {
        message: String,
        os_code: Option<i32>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkippedStep {
    pub position: u32,
    pub row_id: String,
    pub reason: SkipReason,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SkipReason {
    FileChanged,
    FileMissing,
    OriginalNameTaken,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryRequest {
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalEntry {
    pub batch_id: String,
    pub kind: BatchKind,
    pub created_at: i64,
    pub status: BatchStatus,
    pub total_steps: u32,
    pub done_steps: u32,
    pub undoes_batch_id: Option<String>,
    pub undo: UndoAvailability,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BatchStatus {
    Running,
    Completed,
    Stopped,
    Interrupted,
    Undone,
    PartiallyUndone,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum UndoAvailability {
    Available,
    AlreadyUndone,
    NotUndoable,
}
