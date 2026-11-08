import {readSeasonFolder} from '@/domain/parsing/parse-file-name';
import type {ParsedName} from '@/domain/parsing/parsed-name';
import {classifyFile, type FileKind} from '@/domain/suggestions/classify-file';
import {comparableName} from '@/domain/text/comparable-name';
import type {ScannedFile} from '@/ipc/contracts';

export type EpisodeKind = Extract<
  FileKind,
  'tvEpisode' | 'datedEpisode' | 'numberedEpisode'
>;

export type GroupMember = {
  path: string;
  parsed: ParsedName;
  kind: EpisodeKind;
  folderSeason: number | null;
};

export type LookupGroup = {
  key: string;
  showFolder: string;
  volumeId: string;
  nameKey: string;
  query: string;
  members: Array<GroupMember>;
  years: Array<number>;
  automaticAllowed: boolean;
};

export function lookupGroups(
  files: Array<ScannedFile>,
  parsedNames: ReadonlyMap<string, ParsedName | null>
): Array<LookupGroup> {
  const groups = new Map<string, LookupGroup>();
  for (const file of files) {
    const parsed = parsedNames.get(file.path) ?? null;
    const kind = classifyFile(parsed);
    if (parsed === null || parsed.name === null || !isEpisodeKind(kind))
      continue;
    const nameKey = comparableName(parsed.name);
    if (nameKey === '') continue;

    const showFolder = showFolderOf(file);
    const key = `${showFolder}\u0000${nameKey}`;
    const group = groups.get(key) ?? {
      key,
      showFolder,
      volumeId: file.volumeId,
      nameKey,
      query: parsed.name,
      members: [],
      years: [],
      automaticAllowed: true,
    };
    group.members.push({
      path: file.path,
      parsed,
      kind,
      folderSeason: readSeasonFolder(file.folderName)?.season ?? null,
    });
    if (parsed.year !== null && !group.years.includes(parsed.year))
      group.years.push(parsed.year);
    if (kind === 'numberedEpisode') group.automaticAllowed = false;
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function showFolderOf(file: ScannedFile): string {
  const isSeasonFolder = readSeasonFolder(file.folderName) !== null;
  if (!isSeasonFolder || !file.directory.endsWith(file.folderName))
    return file.directory;
  const parent = file.directory
    .slice(0, file.directory.length - file.folderName.length)
    .replace(/(?<=.)[\\/]+$/, '');
  return parent === '' ? file.directory : parent;
}

function isEpisodeKind(kind: FileKind): kind is EpisodeKind {
  return (
    kind === 'tvEpisode' ||
    kind === 'datedEpisode' ||
    kind === 'numberedEpisode'
  );
}
