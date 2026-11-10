mod commands;
mod contracts;
mod drives;
mod error;
mod executor;
mod journal;
mod names;
mod planner;
mod platform;
mod preset_files;
mod scan;

use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

use crate::executor::BatchGate;
use crate::journal::JournalPath;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    platform::silence_missing_disk_prompts();
    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::new()
                .add_migrations("sqlite:cache.db", cache_migrations())
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
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
            commands::resume,
            commands::history,
            commands::batch_steps,
            commands::export_preset,
            commands::import_preset,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn cache_migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "lookups",
            sql: include_str!("../migrations/0001_lookups.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "presets",
            sql: include_str!("../migrations/0002_presets.sql"),
            kind: MigrationKind::Up,
        },
    ]
}
