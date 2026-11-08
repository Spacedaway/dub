import {isVideoExtension} from '@/domain/parsing/parse-file-name';
import type {ScannedFile} from '@/ipc/contracts';

export function findCompanions(
  files: Array<ScannedFile>
): ReadonlyMap<string, string> {
  return pairCompanions(
    files.filter(isVideo),
    files.filter(file => !isVideo(file))
  );
}

export function orderCompanionsAfterVideos(
  files: Array<ScannedFile>,
  companions: ReadonlyMap<string, string>
): Array<ScannedFile> {
  const companionsByVideo = new Map<string, Array<ScannedFile>>();
  for (const file of files) {
    const video = companions.get(file.path);
    if (video === undefined) continue;
    companionsByVideo.set(video, [
      ...(companionsByVideo.get(video) ?? []),
      file,
    ]);
  }
  return files.flatMap(file =>
    companions.has(file.path)
      ? []
      : [file, ...(companionsByVideo.get(file.path) ?? [])]
  );
}

function pairCompanions(
  videos: Array<ScannedFile>,
  candidates: Array<ScannedFile>
): Map<string, string> {
  const videosByStem = new Map<string, string>();
  for (const video of videos) {
    const key = stemKey(video.directory, video.stem);
    if (!videosByStem.has(key)) videosByStem.set(key, video.path);
  }

  const pairs = new Map<string, string>();
  for (const candidate of candidates) {
    const video = longestMatchingVideo(candidate, videosByStem);
    if (video !== undefined) pairs.set(candidate.path, video);
  }
  return pairs;
}

function longestMatchingVideo(
  candidate: ScannedFile,
  videosByStem: ReadonlyMap<string, string>
): string | undefined {
  const name = candidate.name.normalize('NFC');
  for (let end = name.length - 1; end > 0; end -= 1) {
    if (name[end] !== '.' && name[end] !== '-') continue;
    const video = videosByStem.get(
      stemKey(candidate.directory, name.slice(0, end))
    );
    if (video !== undefined) return video;
  }
  return undefined;
}

function stemKey(directory: string, stem: string): string {
  return `${directory}\0${stem.normalize('NFC').toLowerCase()}`;
}

function isVideo(file: ScannedFile): boolean {
  return isVideoExtension(file.extension);
}
