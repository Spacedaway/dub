import type {ParsedName} from '@/domain/parsing/parsed-name';
import {classifyFile} from '@/domain/suggestions/classify-file';
import {templateTags} from '@/domain/templates/parse-template';
import type {Template} from '@/domain/templates/template';
import {comparableName} from '@/domain/text/comparable-name';
import type {ScannedFile} from '@/ipc/contracts';

export type EpisodeFlag =
  | {kind: 'gapBefore'; from: number; to: number}
  | {kind: 'duplicateEpisode'; episodes: Array<number>}
  | {kind: 'decimalEpisode'; episode: number};

type EpisodeFile = {path: string; episodes: Array<number>};

export function episodeFlags(
  files: Array<ScannedFile>,
  parsedNames: ReadonlyMap<string, ParsedName | null>
): ReadonlyMap<string, Array<EpisodeFlag>> {
  const flags = new Map<string, Array<EpisodeFlag>>();
  for (const group of episodeGroups(files, parsedNames)) {
    for (const file of group) {
      for (const episode of file.episodes) {
        if (!Number.isInteger(episode))
          append(flags, file.path, {kind: 'decimalEpisode', episode});
      }
    }
    for (const [path, episodes] of sharedEpisodes(group))
      append(flags, path, {kind: 'duplicateEpisode', episodes});
    for (const [path, gap] of gaps(group))
      append(flags, path, {kind: 'gapBefore', ...gap});
  }
  return flags;
}

export function counterIgnoresEpisodes(
  template: Template,
  parsedNames: ReadonlyMap<string, ParsedName | null>
): boolean {
  const tags = new Set(templateTags(template.nodes).map(node => node.tag));
  if (!tags.has('Inc') || tags.has('Episode')) return false;
  return Array.from(parsedNames.values()).some(
    parsed => parsed !== null && parsed.episodes.length > 0
  );
}

function episodeGroups(
  files: Array<ScannedFile>,
  parsedNames: ReadonlyMap<string, ParsedName | null>
): Iterable<Array<EpisodeFile>> {
  const groups = new Map<string, Array<EpisodeFile>>();
  for (const file of files) {
    const parsed = parsedNames.get(file.path) ?? null;
    const kind = classifyFile(parsed);
    if (parsed === null || parsed.season === 0) continue;
    if (kind !== 'tvEpisode' && kind !== 'numberedEpisode') continue;

    const key = [
      file.directory,
      kind,
      comparableName(parsed.name ?? ''),
      parsed.season ?? '',
    ].join('\u0000');
    append(groups, key, {path: file.path, episodes: parsed.episodes});
  }
  return groups.values();
}

function sharedEpisodes(group: Array<EpisodeFile>): Map<string, Array<number>> {
  const pathsByEpisode = new Map<number, Set<string>>();
  for (const file of group) {
    for (const episode of file.episodes) {
      const paths = pathsByEpisode.get(episode) ?? new Set();
      pathsByEpisode.set(episode, paths.add(file.path));
    }
  }

  const shared = new Map<string, Array<number>>();
  for (const [episode, paths] of pathsByEpisode) {
    if (paths.size < 2) continue;
    for (const path of paths) append(shared, path, episode);
  }
  return shared;
}

function gaps(
  group: Array<EpisodeFile>
): Map<string, {from: number; to: number}> {
  const ranges = group
    .map(file => {
      const whole = file.episodes.filter(episode => Number.isInteger(episode));
      return {
        path: file.path,
        low: Math.min(...whole),
        high: Math.max(...whole),
      };
    })
    .filter(range => Number.isFinite(range.low))
    .sort((left, right) => left.low - right.low);

  const found = new Map<string, {from: number; to: number}>();
  let highestSoFar: number | null = null;
  for (const range of ranges) {
    if (highestSoFar !== null && range.low > highestSoFar + 1)
      found.set(range.path, {from: highestSoFar + 1, to: range.low - 1});
    highestSoFar = Math.max(highestSoFar ?? range.high, range.high);
  }
  return found;
}

function append<Key, Value>(
  map: Map<Key, Array<Value>>,
  key: Key,
  value: Value
): void {
  const values = map.get(key);
  if (values === undefined) map.set(key, [value]);
  else values.push(value);
}
