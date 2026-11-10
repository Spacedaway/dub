use std::path::Path;

use tauri::ipc::Channel;
use tauri::{State, Window};

use crate::contracts::{
    BatchProgress, BatchRequest, BatchResult, BatchStep, ExecuteRequest, ExportPresetRequest,
    HistoryRequest, JournalEntry, Plan, PlanRequest, ScanRequest, ScanResponse, VolumeInfo,
    VolumeInfoRequest,
};
use crate::error::CommandError;
use crate::executor::{self, BatchGate};
use crate::journal::{self, JournalPath};
use crate::planner::{self, DiskProbe};
use crate::platform;
use crate::preset_files;
use crate::scan;

#[tauri::command]
pub async fn scan(request: ScanRequest) -> Result<ScanResponse, CommandError> {
    run_blocking(move || Ok(scan::scan(request))).await
}

#[tauri::command]
pub async fn volume_info(request: VolumeInfoRequest) -> Result<Vec<VolumeInfo>, CommandError> {
    run_blocking(move || {
        request
            .paths
            .iter()
            .map(|path| platform::volume_info(Path::new(path)).map_err(CommandError::from))
            .collect()
    })
    .await
}

#[tauri::command]
pub async fn plan(request: PlanRequest) -> Result<Plan, CommandError> {
    run_blocking(move || Ok(planner::plan(request, &mut DiskProbe::default()))).await
}

#[tauri::command]
pub async fn execute(
    gate: State<'_, BatchGate>,
    journal: State<'_, JournalPath>,
    request: ExecuteRequest,
    on_progress: Channel<BatchProgress>,
) -> Result<BatchResult, CommandError> {
    let gate = gate.inner().clone();
    let journal = journal.inner().clone();
    run_blocking(move || {
        let ExecuteRequest::Plan { plan } = request;
        executor::execute(&gate, &journal, plan, |event| {
            let _ = on_progress.send(event);
        })
    })
    .await
}

#[tauri::command]
pub async fn undo(
    gate: State<'_, BatchGate>,
    journal: State<'_, JournalPath>,
    request: BatchRequest,
    on_progress: Channel<BatchProgress>,
) -> Result<BatchResult, CommandError> {
    let gate = gate.inner().clone();
    let journal = journal.inner().clone();
    run_blocking(move || {
        executor::undo(&gate, &journal, &request.batch_id, |event| {
            let _ = on_progress.send(event);
        })
    })
    .await
}

#[tauri::command]
pub async fn resume(
    gate: State<'_, BatchGate>,
    journal: State<'_, JournalPath>,
    request: BatchRequest,
    on_progress: Channel<BatchProgress>,
) -> Result<BatchResult, CommandError> {
    let gate = gate.inner().clone();
    let journal = journal.inner().clone();
    run_blocking(move || {
        executor::resume(&gate, &journal, &request.batch_id, |event| {
            let _ = on_progress.send(event);
        })
    })
    .await
}

#[tauri::command]
pub async fn history(
    journal: State<'_, JournalPath>,
    request: HistoryRequest,
) -> Result<Vec<JournalEntry>, CommandError> {
    let journal = journal.inner().clone();
    run_blocking(move || Ok(journal::history(&journal.open()?, request.limit)?)).await
}

#[tauri::command]
pub async fn batch_steps(
    journal: State<'_, JournalPath>,
    request: BatchRequest,
) -> Result<Vec<BatchStep>, CommandError> {
    let journal = journal.inner().clone();
    run_blocking(move || Ok(journal::batch_steps(&journal.open()?, &request.batch_id)?)).await
}

#[tauri::command]
pub async fn export_preset(
    window: Window,
    request: ExportPresetRequest,
) -> Result<bool, CommandError> {
    run_blocking(move || preset_files::export(&window, &request.file_name, &request.contents)).await
}

#[tauri::command]
pub async fn import_preset(window: Window) -> Result<Option<String>, CommandError> {
    run_blocking(move || preset_files::import(&window)).await
}

async fn run_blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, CommandError> + Send + 'static,
) -> Result<T, CommandError> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| CommandError::Internal(error.to_string()))?
}
