use std::io;
use std::path::Path;

use super::DriveLocation;
use crate::contracts::{ExclusiveRename, IdStability, RenameFailure, VolumeAccess, VolumeInfo};

pub fn rename_no_overwrite(from: &Path, to: &Path) -> Result<(), RenameFailure> {
    super::check_then_rename(from, to)
}

pub fn volume_info(path: &Path) -> io::Result<VolumeInfo> {
    std::fs::metadata(path)?;
    Ok(VolumeInfo {
        id: "unknown".to_string(),
        mount_point: "/".to_string(),
        label: "Disk".to_string(),
        file_system: "unknown".to_string(),
        access: VolumeAccess::ReadWrite,
        exclusive_rename: ExclusiveRename::CheckThenRename,
        id_stability: IdStability::MountPathOnly,
    })
}

pub fn directory_writable(_directory: &Path) -> bool {
    true
}

pub fn locate_volume(_volume_id: &str, _recorded_mount: &Path) -> DriveLocation {
    DriveLocation::Untracked
}
