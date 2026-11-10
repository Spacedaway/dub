use std::fs::{self, File};
use std::io::Read;
use std::path::Path;

use tauri::{Runtime, Window};
use tauri_plugin_dialog::{DialogExt, FileDialogBuilder, FilePath};

use crate::error::CommandError;

const MAX_PRESET_BYTES: u64 = 1024 * 1024;

pub fn export<R: Runtime>(
    window: &Window<R>,
    file_name: &str,
    contents: &str,
) -> Result<bool, CommandError> {
    let Some(picked) = preset_dialog(window)
        .set_file_name(file_name)
        .blocking_save_file()
    else {
        return Ok(false);
    };
    fs::write(local_path(&picked)?, contents)?;
    Ok(true)
}

pub fn import<R: Runtime>(window: &Window<R>) -> Result<Option<String>, CommandError> {
    let Some(picked) = preset_dialog(window).blocking_pick_file() else {
        return Ok(None);
    };
    read_capped(local_path(&picked)?).map(Some)
}

fn preset_dialog<R: Runtime>(window: &Window<R>) -> FileDialogBuilder<R> {
    window
        .dialog()
        .file()
        .set_parent(window)
        .add_filter("Dub preset", &["json"])
}

fn local_path(picked: &FilePath) -> Result<&Path, CommandError> {
    picked
        .as_path()
        .ok_or_else(|| CommandError::Internal("the dialog returned a URL, not a path".into()))
}

fn read_capped(path: &Path) -> Result<String, CommandError> {
    if !fs::metadata(path)?.is_file() {
        return Err(CommandError::UnreadablePreset(
            "that isn't a file, so it can't be a Dub preset".into(),
        ));
    }
    let mut bytes = Vec::new();
    File::open(path)?
        .take(MAX_PRESET_BYTES + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_PRESET_BYTES {
        return Err(CommandError::UnreadablePreset(
            "the file is larger than 1 MB, so it isn't a Dub preset".into(),
        ));
    }
    String::from_utf8(bytes).map_err(|_| {
        CommandError::UnreadablePreset("the file isn't text, so it isn't a Dub preset".into())
    })
}
