use std::collections::{HashMap, HashSet};
use std::fs::{self, Metadata};
use std::path::{Path, PathBuf};

use crate::contracts::{
    FileAccess, FolderDepth, ScanProblem, ScanRequest, ScanResponse, ScannedFile, VolumeAccess,
    VolumeInfo,
};
use crate::journal::milliseconds_since_epoch;
use crate::platform;

const SYSTEM_JUNK: [&str; 3] = [".DS_Store", "Thumbs.db", "desktop.ini"];

pub fn scan(request: ScanRequest) -> ScanResponse {
    let mut collector = Collector::default();
    for path in &request.paths {
        collector.visit_dropped(Path::new(path), request.folders);
    }
    collector.finish()
}

#[derive(Default)]
struct Collector {
    files: Vec<ScannedFile>,
    seen: HashSet<PathBuf>,
    volumes_by_directory: HashMap<PathBuf, Option<VolumeInfo>>,
    problems: Vec<ScanProblem>,
    junk_skipped: u32,
}

impl Collector {
    fn visit_dropped(&mut self, path: &Path, depth: FolderDepth) {
        match fs::symlink_metadata(path) {
            Err(error) => self.unreadable(path, &error.to_string()),
            Ok(metadata) if metadata.is_dir() => self.visit_directory(path, depth),
            Ok(metadata) if !is_system_junk(path) => self.add_file(path, &metadata),
            Ok(_) => self.junk_skipped += 1,
        }
    }

    fn visit_directory(&mut self, directory: &Path, depth: FolderDepth) {
        let entries = match fs::read_dir(directory) {
            Ok(entries) => entries,
            Err(error) => return self.unreadable(directory, &error.to_string()),
        };

        let mut files = Vec::new();
        let mut subdirectories = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            if is_hidden_in_folder(&path) {
                self.junk_skipped += 1;
                continue;
            }
            match fs::symlink_metadata(&path) {
                Ok(metadata) if metadata.is_dir() => subdirectories.push(path),
                Ok(metadata) => files.push((path, metadata)),
                Err(error) => self.unreadable(&path, &error.to_string()),
            }
        }

        files.sort_by(|left, right| left.0.cmp(&right.0));
        for (path, metadata) in files {
            self.add_file(&path, &metadata);
        }
        if depth == FolderDepth::Recursive {
            subdirectories.sort();
            for subdirectory in subdirectories {
                self.visit_directory(&subdirectory, depth);
            }
        }
    }

    fn add_file(&mut self, path: &Path, metadata: &Metadata) {
        if !self.seen.insert(path.to_path_buf()) {
            return;
        }
        let (Some(path_text), Some(name), Some(directory)) = (
            path.to_str(),
            path.file_name().and_then(|name| name.to_str()),
            path.parent(),
        ) else {
            self.problems.push(ScanProblem::NotUnicode {
                lossy_path: path.to_string_lossy().into_owned(),
            });
            return;
        };
        let Some(directory_text) = directory.to_str() else {
            self.problems.push(ScanProblem::NotUnicode {
                lossy_path: path.to_string_lossy().into_owned(),
            });
            return;
        };

        let Some(volume) = self.volume_for(directory) else {
            return self.unreadable(path, "the drive holding this file couldn't be read");
        };
        let access = if volume.access == VolumeAccess::ReadOnly {
            FileAccess::ReadOnlyVolume
        } else if !platform::directory_writable(directory) {
            FileAccess::FolderNotWritable
        } else {
            FileAccess::Writable
        };

        let (stem, extension) = split_name(name);
        self.files.push(ScannedFile {
            path: path_text.to_string(),
            directory: directory_text.to_string(),
            name: name.to_string(),
            stem: stem.to_string(),
            extension: extension.to_string(),
            folder_name: file_name_text(directory).unwrap_or_default(),
            parent_folder_name: directory.parent().and_then(file_name_text),
            size: metadata.len(),
            modified_ms: metadata
                .modified()
                .map(milliseconds_since_epoch)
                .unwrap_or(0),
            created_ms: metadata.created().ok().map(milliseconds_since_epoch),
            volume_id: volume.id,
            access,
        });
    }

    fn volume_for(&mut self, directory: &Path) -> Option<VolumeInfo> {
        self.volumes_by_directory
            .entry(directory.to_path_buf())
            .or_insert_with(|| platform::volume_info(directory).ok())
            .clone()
    }

    fn unreadable(&mut self, path: &Path, message: &str) {
        self.problems.push(ScanProblem::Unreadable {
            path: path.to_string_lossy().into_owned(),
            message: message.to_string(),
        });
    }

    fn finish(self) -> ScanResponse {
        let mut volumes: Vec<VolumeInfo> = Vec::new();
        for volume in self.volumes_by_directory.into_values().flatten() {
            if !volumes.iter().any(|known| known.id == volume.id) {
                volumes.push(volume);
            }
        }
        ScanResponse {
            files: self.files,
            volumes,
            problems: self.problems,
            junk_skipped: self.junk_skipped,
        }
    }
}

fn split_name(name: &str) -> (&str, &str) {
    match name.rfind('.') {
        Some(index) if index > 0 => name.split_at(index),
        _ => (name, ""),
    }
}

fn file_name_text(path: &Path) -> Option<String> {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(str::to_string)
}

fn is_system_junk(path: &Path) -> bool {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy())
        .unwrap_or_default();
    SYSTEM_JUNK
        .iter()
        .any(|junk| junk.eq_ignore_ascii_case(&name))
}

fn is_hidden_in_folder(path: &Path) -> bool {
    is_system_junk(path)
        || path
            .file_name()
            .is_some_and(|name| name.to_string_lossy().starts_with('.'))
}
