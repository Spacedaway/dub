import type {VolumeInfo} from '@/ipc/contracts';

export type FolderKey = {volumeId: string; folder: string};

export function folderKey(
  folder: string,
  volume: VolumeInfo | undefined
): FolderKey {
  const path = portablePath(folder);
  if (volume?.idStability !== 'stable') return {volumeId: '', folder: path};

  const mountPoint = portablePath(volume.mountPoint).replace(/\/+$/, '');
  const ignoresCase = /^[A-Za-z]:/.test(mountPoint);
  const comparable = ignoresCase ? path.toLowerCase() : path;
  const prefix = ignoresCase ? mountPoint.toLowerCase() : mountPoint;
  const isInside =
    prefix !== '' &&
    (comparable === prefix || comparable.startsWith(`${prefix}/`));
  return {
    volumeId: volume.id,
    folder: isInside ? path.slice(mountPoint.length) || '/' : path,
  };
}

function portablePath(path: string): string {
  return path.normalize('NFC').replace(/\\/g, '/');
}
