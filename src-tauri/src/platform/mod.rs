use std::io;
use std::path::{Path, PathBuf};

use crate::contracts::{RenameFailure, VolumeInfo};

#[cfg_attr(
    windows,
    expect(dead_code, reason = "Windows doesn't look drives up yet")
)]
pub enum DriveLocation {
    Mounted(PathBuf),
    Missing,
    MountedTwice,
    Untracked,
}

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
use macos as native;

#[cfg(windows)]
mod windows;
#[cfg(windows)]
use windows as native;

#[cfg(not(any(target_os = "macos", windows)))]
mod fallback;
#[cfg(not(any(target_os = "macos", windows)))]
use fallback as native;

pub fn rename_no_overwrite(from: &Path, to: &Path) -> Result<(), RenameFailure> {
    native::rename_no_overwrite(from, to)
}

pub fn volume_info(path: &Path) -> io::Result<VolumeInfo> {
    native::volume_info(path)
}

pub fn directory_writable(directory: &Path) -> bool {
    native::directory_writable(directory)
}

pub fn path_present(path: &Path) -> bool {
    std::fs::symlink_metadata(path).is_ok()
}

#[cfg(target_os = "macos")]
pub fn locate_volume(volume_id: &str, recorded_mount: &Path) -> DriveLocation {
    native::locate_volume(volume_id, recorded_mount)
}

#[cfg(not(target_os = "macos"))]
pub fn locate_volume(_volume_id: &str, _recorded_mount: &Path) -> DriveLocation {
    DriveLocation::Untracked
}

pub fn is_stable_volume_id(volume_id: &str) -> bool {
    volume_id.starts_with("uuid:") || volume_id.starts_with(r"\\?\Volume{")
}

#[cfg(not(windows))]
fn check_then_rename(from: &Path, to: &Path) -> Result<(), RenameFailure> {
    if path_present(to) {
        return Err(RenameFailure::TargetExists);
    }
    std::fs::rename(from, to).map_err(|error| other_failure(&error))
}

fn other_failure(error: &io::Error) -> RenameFailure {
    match error.kind() {
        io::ErrorKind::NotFound => RenameFailure::SourceMissing,
        io::ErrorKind::AlreadyExists => RenameFailure::TargetExists,
        io::ErrorKind::PermissionDenied => RenameFailure::PermissionDenied,
        _ => RenameFailure::Other {
            message: error.to_string(),
            os_code: error.raw_os_error(),
        },
    }
}
