use std::ffi::{OsStr, OsString};
use std::io;
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::path::{Path, PathBuf};
use std::thread;
use std::time::Duration;

use windows_sys::Win32::Foundation::{
    ERROR_ACCESS_DENIED, ERROR_ALREADY_EXISTS, ERROR_FILE_EXISTS, ERROR_FILE_NOT_FOUND,
    ERROR_FILENAME_EXCED_RANGE, ERROR_LOCK_VIOLATION, ERROR_MORE_DATA, ERROR_NOT_SAME_DEVICE,
    ERROR_PATH_NOT_FOUND, ERROR_SHARING_VIOLATION, ERROR_WRITE_PROTECT,
};
use windows_sys::Win32::Storage::FileSystem::{
    GetVolumeInformationW, GetVolumeNameForVolumeMountPointW, GetVolumePathNameW,
    GetVolumePathNamesForVolumeNameW, MOVE_FILE_FLAGS, MoveFileExW,
};
use windows_sys::Win32::System::Diagnostics::Debug::{
    GetErrorMode, SEM_FAILCRITICALERRORS, SetErrorMode,
};
use windows_sys::Win32::System::SystemServices::FILE_READ_ONLY_VOLUME;

use super::DriveLocation;
use crate::contracts::{ExclusiveRename, IdStability, RenameFailure, VolumeAccess, VolumeInfo};

const RETRY_DELAYS_MS: [u64; 3] = [250, 500, 1000];
const WITHOUT_REPLACE_EXISTING_OR_COPY_ALLOWED: MOVE_FILE_FLAGS = 0;

pub fn rename_no_overwrite(from: &Path, to: &Path) -> Result<(), RenameFailure> {
    let from_wide = wide(&extended_length(from));
    let to_wide = wide(&extended_length(to));

    let mut attempt = 0;
    loop {
        // SAFETY: both buffers are NUL-terminated and live until the call returns.
        let succeeded = unsafe {
            MoveFileExW(
                from_wide.as_ptr(),
                to_wide.as_ptr(),
                WITHOUT_REPLACE_EXISTING_OR_COPY_ALLOWED,
            )
        } != 0;
        if succeeded {
            return Ok(());
        }

        let error = io::Error::last_os_error();
        let code = error.raw_os_error().map(|code| code as u32);
        let retryable = matches!(
            code,
            Some(ERROR_SHARING_VIOLATION | ERROR_LOCK_VIOLATION | ERROR_ACCESS_DENIED)
        );
        if retryable && attempt < RETRY_DELAYS_MS.len() {
            thread::sleep(Duration::from_millis(RETRY_DELAYS_MS[attempt]));
            attempt += 1;
            continue;
        }

        return Err(match code {
            Some(ERROR_ALREADY_EXISTS | ERROR_FILE_EXISTS) => RenameFailure::TargetExists,
            Some(ERROR_FILE_NOT_FOUND | ERROR_PATH_NOT_FOUND) => RenameFailure::SourceMissing,
            Some(ERROR_SHARING_VIOLATION | ERROR_LOCK_VIOLATION) => RenameFailure::FileInUse,
            Some(ERROR_ACCESS_DENIED) => RenameFailure::PermissionDenied,
            Some(ERROR_WRITE_PROTECT) => RenameFailure::ReadOnlyVolume,
            Some(ERROR_NOT_SAME_DEVICE) => RenameFailure::DifferentVolume,
            Some(ERROR_FILENAME_EXCED_RANGE) => RenameFailure::NameTooLong,
            _ => super::other_failure(&error),
        });
    }
}

pub fn volume_info(path: &Path) -> io::Result<VolumeInfo> {
    let path_wide = wide(path.as_os_str());

    let mut root = vec![0u16; 1024];
    // SAFETY: the buffers are valid and their lengths are passed alongside them.
    if unsafe { GetVolumePathNameW(path_wide.as_ptr(), root.as_mut_ptr(), root.len() as u32) } == 0
    {
        return Err(io::Error::last_os_error());
    }
    let root_text = text_from_wide(&root);

    let mut volume_name = vec![0u16; 64];
    // SAFETY: as above.
    let has_volume_name = unsafe {
        GetVolumeNameForVolumeMountPointW(
            root.as_ptr(),
            volume_name.as_mut_ptr(),
            volume_name.len() as u32,
        )
    } != 0;

    let mut label = vec![0u16; 261];
    let mut file_system = vec![0u16; 261];
    let mut serial_number = 0u32;
    let mut maximum_component_length = 0u32;
    let mut flags = 0u32;
    // SAFETY: as above; the out-parameters point at live locals.
    let has_information = unsafe {
        GetVolumeInformationW(
            root.as_ptr(),
            label.as_mut_ptr(),
            label.len() as u32,
            &mut serial_number,
            &mut maximum_component_length,
            &mut flags,
            file_system.as_mut_ptr(),
            file_system.len() as u32,
        )
    } != 0;
    if !has_information {
        return Err(io::Error::last_os_error());
    }

    // A card reader keeps one volume GUID for every card put in it; the serial tells cards apart.
    let (id, id_stability) = if has_volume_name {
        (
            format!("{}#{serial_number:08X}", text_from_wide(&volume_name)),
            IdStability::Stable,
        )
    } else {
        (format!("root:{root_text}"), IdStability::MountPathOnly)
    };

    let label_text = text_from_wide(&label);
    Ok(VolumeInfo {
        id,
        label: if label_text.is_empty() {
            root_text.clone()
        } else {
            label_text
        },
        mount_point: root_text,
        file_system: text_from_wide(&file_system),
        access: if flags & FILE_READ_ONLY_VOLUME != 0 {
            VolumeAccess::ReadOnly
        } else {
            VolumeAccess::ReadWrite
        },
        exclusive_rename: ExclusiveRename::Native,
        id_stability,
    })
}

pub fn locate_volume(volume_id: &str, recorded_mount: &Path) -> DriveLocation {
    if !super::is_stable_volume_id(volume_id) {
        return DriveLocation::Untracked;
    }
    let Some((volume_name, _)) = volume_id.split_once('#') else {
        return DriveLocation::Missing;
    };
    let mounts = mount_paths(volume_name);
    let chosen = mounts
        .iter()
        .find(|mount| mount.as_path() == recorded_mount)
        .or_else(|| mounts.iter().find(|mount| mount.parent().is_none()))
        .or(mounts.first());
    match chosen {
        Some(mount) if volume_info(mount).is_ok_and(|volume| volume.id == volume_id) => {
            DriveLocation::Mounted(mount.clone())
        }
        _ => DriveLocation::Missing,
    }
}

fn mount_paths(volume_name: &str) -> Vec<PathBuf> {
    let volume_name_wide = wide(OsStr::new(volume_name));
    let mut buffer = vec![0u16; 1024];
    for _ in 0..2 {
        let mut needed = 0u32;
        // SAFETY: the name is NUL-terminated, the buffer's length is passed with it, and `needed` is a live local.
        let succeeded = unsafe {
            GetVolumePathNamesForVolumeNameW(
                volume_name_wide.as_ptr(),
                buffer.as_mut_ptr(),
                buffer.len() as u32,
                &mut needed,
            )
        } != 0;
        if succeeded {
            return buffer
                .split(|unit| *unit == 0)
                .take_while(|path| !path.is_empty())
                .map(|path| PathBuf::from(OsString::from_wide(path)))
                .collect();
        }
        if io::Error::last_os_error().raw_os_error() != Some(ERROR_MORE_DATA as i32) {
            break;
        }
        buffer = vec![0u16; needed as usize];
    }
    Vec::new()
}

pub fn silence_missing_disk_prompts() {
    // SAFETY: both calls only read and set this process's error-mode flags.
    unsafe { SetErrorMode(GetErrorMode() | SEM_FAILCRITICALERRORS) };
}

pub fn directory_writable(_directory: &Path) -> bool {
    true
}

// \\?\ switches off Windows' path normalisation, so `absolute` has to normalise it first.
fn extended_length(path: &Path) -> OsString {
    let absolute = std::path::absolute(path).unwrap_or_else(|_| path.to_path_buf());
    let text = absolute.as_os_str().to_string_lossy();
    if text.starts_with(r"\\?\") {
        return absolute.into_os_string();
    }
    if let Some(share) = text.strip_prefix(r"\\") {
        return OsString::from(format!(r"\\?\UNC\{share}"));
    }
    OsString::from(format!(r"\\?\{text}"))
}

fn wide(text: &OsStr) -> Vec<u16> {
    text.encode_wide().chain(std::iter::once(0)).collect()
}

fn text_from_wide(buffer: &[u16]) -> String {
    let length = buffer
        .iter()
        .position(|unit| *unit == 0)
        .unwrap_or(buffer.len());
    OsString::from_wide(&buffer[..length])
        .to_string_lossy()
        .into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_system_drive_from_another_letter() {
        let root = PathBuf::from(format!(r"{}\", std::env::var("SystemDrive").unwrap()));
        let id = volume_info(&root).unwrap().id;
        assert!(matches!(
            locate_volume(&id, Path::new(r"Q:\")),
            DriveLocation::Mounted(mount) if mount == root
        ));
    }
}
