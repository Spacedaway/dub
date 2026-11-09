use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::error::CommandError;
use crate::journal::BatchVolume;
use crate::platform::{self, DriveLocation};

pub struct Drives {
    mounts: HashMap<String, Mount>,
    folder_volumes: HashMap<PathBuf, Option<String>>,
}

struct Mount {
    recorded: PathBuf,
    current: PathBuf,
}

impl Drives {
    pub fn as_recorded(volumes: &[BatchVolume]) -> Self {
        Self::with_mounts(
            volumes
                .iter()
                .map(|volume| (volume, PathBuf::from(&volume.mount_point))),
        )
    }

    pub fn find(volumes: &[BatchVolume]) -> Result<Self, CommandError> {
        let mut mounts = Vec::new();
        for volume in volumes {
            mounts.push((volume, current_mount(volume)?));
        }
        Ok(Self::with_mounts(mounts.into_iter()))
    }

    pub fn find_available(volumes: &[BatchVolume]) -> Self {
        Self::with_mounts(volumes.iter().map(|volume| {
            let mount = current_mount(volume).unwrap_or_else(|_| volume.mount_point.clone().into());
            (volume, mount)
        }))
    }

    fn with_mounts<'a>(mounts: impl Iterator<Item = (&'a BatchVolume, PathBuf)>) -> Self {
        Self {
            mounts: mounts
                .map(|(volume, current)| {
                    let recorded = PathBuf::from(&volume.mount_point);
                    (volume.volume_id.clone(), Mount { recorded, current })
                })
                .collect(),
            folder_volumes: HashMap::new(),
        }
    }

    pub fn translate(&self, volume_id: &str, path: &str) -> String {
        match self.mounts.get(volume_id) {
            Some(mount) => translate(Path::new(path), &mount.recorded, &mount.current)
                .to_string_lossy()
                .into_owned(),
            None => path.to_string(),
        }
    }

    pub fn current_volumes(&self, volumes: &[BatchVolume]) -> Vec<BatchVolume> {
        volumes
            .iter()
            .map(|volume| BatchVolume {
                mount_point: self.mounts.get(&volume.volume_id).map_or_else(
                    || volume.mount_point.clone(),
                    |mount| mount.current.to_string_lossy().into_owned(),
                ),
                ..volume.clone()
            })
            .collect()
    }

    pub fn holds(&mut self, volume_id: &str, path: &str) -> bool {
        if !platform::is_stable_volume_id(volume_id) {
            return true;
        }
        let folder = Path::new(path).parent().unwrap_or(Path::new(path));
        let current_id = self
            .folder_volumes
            .entry(folder.to_path_buf())
            .or_insert_with_key(|folder| {
                platform::volume_info(folder).ok().map(|volume| volume.id)
            });
        current_id.as_deref() == Some(volume_id)
    }
}

fn current_mount(volume: &BatchVolume) -> Result<PathBuf, CommandError> {
    let recorded = Path::new(&volume.mount_point);
    match platform::locate_volume(&volume.volume_id, recorded) {
        DriveLocation::Mounted(current) => Ok(current),
        DriveLocation::Untracked => Ok(recorded.to_path_buf()),
        DriveLocation::Missing => Err(CommandError::DriveNotConnected(volume.label.clone())),
        DriveLocation::MountedTwice => Err(CommandError::DriveMountedTwice(volume.label.clone())),
    }
}

pub fn translate(path: &Path, recorded_mount: &Path, current_mount: &Path) -> PathBuf {
    match path.strip_prefix(recorded_mount) {
        Ok(inside) if recorded_mount != current_mount => current_mount.join(inside),
        _ => path.to_path_buf(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn translate_matches_whole_components() {
        let recorded = Path::new("/Volumes/Media");
        let current = Path::new("/Volumes/Media 1");
        assert_eq!(
            translate(Path::new("/Volumes/Media/TV/a.mkv"), recorded, current),
            PathBuf::from("/Volumes/Media 1/TV/a.mkv")
        );
        assert_eq!(
            translate(
                Path::new("/Volumes/Media 2/a.mkv"),
                recorded,
                Path::new("/Users/me/mnt")
            ),
            PathBuf::from("/Volumes/Media 2/a.mkv")
        );
        assert_eq!(
            translate(
                Path::new("/Users/me/a.mkv"),
                Path::new("/System/Volumes/Data"),
                Path::new("/System/Volumes/Data")
            ),
            PathBuf::from("/Users/me/a.mkv")
        );
    }
}
