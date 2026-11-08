import type {ParsedName} from '@/domain/parsing/parsed-name';

export type FileKind =
  | 'tvEpisode'
  | 'datedEpisode'
  | 'numberedEpisode'
  | 'film'
  | 'generic';

export function classifyFile(parsed: ParsedName | null): FileKind {
  if (parsed === null || parsed.name === null) return 'generic';
  if (parsed.season !== null && parsed.episodes.length > 0) return 'tvEpisode';
  if (parsed.airDate !== null) return 'datedEpisode';
  if (parsed.episodes.length > 0) return 'numberedEpisode';
  if (parsed.year !== null && parsed.season === null && !parsed.nameFromFolder)
    return 'film';
  return 'generic';
}
