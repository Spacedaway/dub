use std::ffi::{CString, c_char, c_int, c_void};
use std::io;
use std::mem::{MaybeUninit, size_of};
use std::os::unix::ffi::OsStrExt;
use std::path::{Path, PathBuf};

use super::DriveLocation;
use crate::contracts::{ExclusiveRename, IdStability, RenameFailure, VolumeAccess, VolumeInfo};

pub fn rename_no_overwrite(from: &Path, to: &Path) -> Result<(), RenameFailure> {
    let from_c_string = c_string(from).map_err(|error| super::other_failure(&error))?;
    let to_c_string = c_string(to).map_err(|error| super::other_failure(&error))?;

    // SAFETY: both pointers come from CStrings that live until the call returns.
    let result = unsafe {
        libc::renamex_np(
            from_c_string.as_ptr(),
            to_c_string.as_ptr(),
            libc::RENAME_EXCL,
        )
    };
    if result == 0 {
        return Ok(());
    }

    let error = io::Error::last_os_error();
    match error.raw_os_error() {
        // The volume's RENAME_EXCL capability bit is unreliable, so only ENOTSUP means no support.
        Some(libc::ENOTSUP) => super::check_then_rename(from, to),
        Some(libc::EEXIST | libc::ENOTEMPTY) => Err(RenameFailure::TargetExists),
        Some(libc::ENOENT) => Err(RenameFailure::SourceMissing),
        Some(libc::EROFS) => Err(RenameFailure::ReadOnlyVolume),
        Some(libc::EXDEV) => Err(RenameFailure::DifferentVolume),
        Some(libc::EBUSY) => Err(RenameFailure::FileInUse),
        Some(libc::EACCES | libc::EPERM) => Err(RenameFailure::PermissionDenied),
        Some(libc::ENAMETOOLONG) => Err(RenameFailure::NameTooLong),
        _ => Err(super::other_failure(&error)),
    }
}

pub fn volume_info(path: &Path) -> io::Result<VolumeInfo> {
    let path_c_string = c_string(path)?;
    let mut statistics = MaybeUninit::<libc::statfs>::zeroed();
    // SAFETY: statfs fills the buffer it is given; the path pointer is valid for the call.
    if unsafe { libc::statfs(path_c_string.as_ptr(), statistics.as_mut_ptr()) } != 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: statfs succeeded, so the struct is initialised.
    let statistics = unsafe { statistics.assume_init() };

    let mount_point = text_from_c_characters(&statistics.f_mntonname);
    let mounted_from = text_from_c_characters(&statistics.f_mntfromname);
    let file_system = text_from_c_characters(&statistics.f_fstypename);
    let read_only = statistics.f_flags & (libc::MNT_RDONLY as u32) != 0;
    let attributes = volume_attributes(&mount_point).unwrap_or(VolumeAttributes {
        uuid: None,
        supports_exclusive_rename: false,
    });

    let (id, id_stability) = match attributes.uuid {
        Some(uuid) => (format!("uuid:{uuid}"), IdStability::Stable),
        None => (format!("mount:{mounted_from}"), IdStability::MountPathOnly),
    };

    Ok(VolumeInfo {
        id,
        label: volume_label(&mount_point),
        mount_point,
        file_system,
        access: if read_only {
            VolumeAccess::ReadOnly
        } else {
            VolumeAccess::ReadWrite
        },
        exclusive_rename: if attributes.supports_exclusive_rename {
            ExclusiveRename::Native
        } else {
            ExclusiveRename::CheckThenRename
        },
        id_stability,
    })
}

pub fn locate_volume(volume_id: &str, recorded_mount: &Path) -> DriveLocation {
    if !volume_id.starts_with("uuid:") {
        return DriveLocation::Untracked;
    }
    let holds_volume = |mount: &Path| volume_info(mount).is_ok_and(|volume| volume.id == volume_id);
    if holds_volume(recorded_mount) {
        return DriveLocation::Mounted(recorded_mount.to_path_buf());
    }
    let mut mounts = local_mount_points()
        .into_iter()
        .filter(|mount| holds_volume(mount));
    match (mounts.next(), mounts.next()) {
        (Some(mount), None) => DriveLocation::Mounted(mount),
        (Some(_), Some(_)) => DriveLocation::MountedTwice,
        (None, _) => DriveLocation::Missing,
    }
}

fn local_mount_points() -> Vec<PathBuf> {
    // SAFETY: a null buffer asks only for the number of mounted file systems.
    let count = unsafe { libc::getfsstat(std::ptr::null_mut(), 0, libc::MNT_NOWAIT) };
    if count <= 0 {
        return Vec::new();
    }
    let capacity = count as usize + 8;
    let mut buffer: Vec<libc::statfs> = Vec::with_capacity(capacity);
    // SAFETY: the buffer has room for `capacity` entries, and its size in bytes is passed with it.
    let filled = unsafe {
        libc::getfsstat(
            buffer.as_mut_ptr(),
            (capacity * size_of::<libc::statfs>()) as c_int,
            libc::MNT_NOWAIT,
        )
    };
    if filled <= 0 {
        return Vec::new();
    }
    // SAFETY: getfsstat initialised the first `filled` entries, and never more than `capacity`.
    unsafe { buffer.set_len((filled as usize).min(capacity)) };

    buffer
        .iter()
        .filter(|mount| mount.f_flags & libc::MNT_LOCAL as u32 != 0)
        // Reading an autofs trigger's attributes can block on the network.
        .filter(|mount| text_from_c_characters(&mount.f_fstypename) != "autofs")
        .map(|mount| PathBuf::from(text_from_c_characters(&mount.f_mntonname)))
        .collect()
}

pub fn directory_writable(directory: &Path) -> bool {
    let Ok(directory_c_string) = c_string(directory) else {
        return false;
    };
    // SAFETY: the pointer comes from a CString that lives until the call returns.
    unsafe { libc::access(directory_c_string.as_ptr(), libc::W_OK) == 0 }
}

struct VolumeAttributes {
    uuid: Option<String>,
    supports_exclusive_rename: bool,
}

// getattrlist returns the requested attributes in ascending bit order.
#[repr(C, packed(4))]
struct VolumeAttributeBuffer {
    length: u32,
    capabilities: libc::vol_capabilities_attr_t,
    uuid: [u8; 16],
}

fn volume_attributes(mount_point: &str) -> io::Result<VolumeAttributes> {
    let mount_point_c_string = CString::new(mount_point)?;
    let mut request = libc::attrlist {
        bitmapcount: libc::ATTR_BIT_MAP_COUNT,
        reserved: 0,
        commonattr: 0,
        volattr: libc::ATTR_VOL_INFO | libc::ATTR_VOL_CAPABILITIES | libc::ATTR_VOL_UUID,
        dirattr: 0,
        fileattr: 0,
        forkattr: 0,
    };
    let mut buffer = MaybeUninit::<VolumeAttributeBuffer>::zeroed();

    // SAFETY: the request and buffer are valid for the call and the size matches the buffer.
    let result = unsafe {
        libc::getattrlist(
            mount_point_c_string.as_ptr(),
            (&raw mut request).cast::<c_void>(),
            buffer.as_mut_ptr().cast::<c_void>(),
            size_of::<VolumeAttributeBuffer>(),
            0,
        )
    };
    if result != 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: getattrlist succeeded; the buffer was zeroed, so any unwritten bytes are zero.
    let buffer = unsafe { buffer.assume_init() };

    let capabilities = buffer.capabilities;
    let uuid = buffer.uuid;

    let interfaces = libc::VOL_CAPABILITIES_INTERFACES;
    let flag = libc::VOL_CAP_INT_RENAME_EXCL;
    let supports_exclusive_rename = capabilities.valid[interfaces] & flag != 0
        && capabilities.capabilities[interfaces] & flag != 0;

    Ok(VolumeAttributes {
        uuid: format_uuid(&uuid),
        supports_exclusive_rename,
    })
}

fn format_uuid(bytes: &[u8; 16]) -> Option<String> {
    if bytes.iter().all(|byte| *byte == 0) {
        return None;
    }
    let hex: String = bytes.iter().map(|byte| format!("{byte:02X}")).collect();
    Some(format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    ))
}

fn volume_label(mount_point: &str) -> String {
    match mount_point {
        "/" | "/System/Volumes/Data" => "Internal disk".to_string(),
        _ => Path::new(mount_point)
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| mount_point.to_string()),
    }
}

fn c_string(path: &Path) -> io::Result<CString> {
    CString::new(path.as_os_str().as_bytes())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "path contains a NUL byte"))
}

fn text_from_c_characters(characters: &[c_char]) -> String {
    let bytes: Vec<u8> = characters
        .iter()
        .take_while(|character| **character != 0)
        .map(|character| *character as u8)
        .collect();
    String::from_utf8_lossy(&bytes).into_owned()
}
