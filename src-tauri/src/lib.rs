mod commands;
mod contracts;
mod error;
mod executor;
mod journal;
mod names;
mod planner;
mod platform;
mod scan;

use tauri::Manager;

use crate::executor::BatchGate;
use crate::journal::JournalPath;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let directory = app.path().app_local_data_dir()?;
            std::fs::create_dir_all(&directory)?;
            let journal = JournalPath(directory.join("journal.db"));
            journal::recover(&journal)?;
            app.manage(journal);
            app.manage(BatchGate::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::scan,
            commands::volume_info,
            commands::plan,
            commands::execute,
            commands::undo,
            commands::history,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
