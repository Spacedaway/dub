import {
  filenameParse,
  type Edition,
  type ParsedShow,
} from '@ctrl/video-filename-parser';
import {parse as parseAnimeName, type Element} from 'anitomy-ng';

import {
  emptyParsedName,
  type ParseInput,
  type ParsedName,
} from '@/domain/parsing/parsed-name';

const videoExtensions = new Set([
  '.3gp',
  '.avi',
  '.divx',
  '.flv',
  '.m2ts',
  '.m4v',
  '.mkv',
  '.mov',
  '.mp4',
  '.mpeg',
  '.mpg',
  '.mts',
  '.ogv',
  '.rmvb',
  '.ts',
  '.vob',
  '.webm',
  '.wmv',
]);

const clues = {
  groupPrefix: /^\s*\[[^\]]+\]/,
  checksum: /\[[0-9A-Fa-f]{8}\]/,
  bareEpisode: / - \d{1,4}(\.\d)?(v\d)?(?=$|[\s[(])/,
  seasonEpisode: /\bS\d{1,2}E\d{1,4}/i,
  crossEpisode: /\b\d{1,2}x\d{2,3}\b/i,
  airDate: /\b(19|20)\d{2}[.\-_ ](0[1-9]|1[0-2])[.\-_ ](0[1-9]|[12]\d|3[01])\b/,
  year: /\b(19|20)\d{2}\b/,
};

export function isVideoExtension(extension: string): boolean {
  return videoExtensions.has(extension.toLowerCase());
}

export function parseFileName(input: ParseInput): ParsedName | null {
  if (!isVideoExtension(input.extension)) return null;

  const {stem} = input;
  const parsed =
    clues.groupPrefix.test(stem) ||
    clues.checksum.test(stem) ||
    clues.bareEpisode.test(stem)
      ? parseWithAnitomy(input)
      : clues.seasonEpisode.test(stem) || clues.airDate.test(stem)
        ? parseSceneEpisode(stem)
        : clues.crossEpisode.test(stem)
          ? parseWithAnitomy(input)
          : clues.year.test(stem)
            ? parseSceneFilm(stem)
            : parseWithAnitomy(input);

  if (parsed.name === null || parsed.name === '') {
    const folderName = nameFromFolder(input.folderName);
    if (folderName !== '')
      return {...parsed, name: folderName, nameFromFolder: true};
  }
  return parsed;
}

function parseWithAnitomy({stem, extension}: ParseInput): ParsedName {
  const fileName = stem + extension;
  const elements = parseAnimeName(fileName);
  function first(kind: Element['kind']): string | null {
    return elements.find(element => element.kind === kind)?.value ?? null;
  }
  const parsed = emptyParsedName('anitomy');

  const type = first('type');
  const title = first('title');
  parsed.name = title === null ? null : removeTrailingType(title, type);
  parsed.year = toNumber(first('year'));
  parsed.season = toNumber(first('season'));
  parsed.episodes = episodeNumbers(fileName, elements);
  parsed.episodeTitle = first('episode_title');
  parsed.group = first('release_group');
  parsed.resolution = normaliseResolution(first('video_resolution'));
  parsed.crc = first('file_checksum')?.toUpperCase() ?? null;
  parsed.version = toNumber(first('release_version'));
  return parsed;
}

function removeTrailingType(title: string, type: string | null): string {
  if (type === null) return title;
  const escaped = type.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return title.replace(new RegExp(`\\s*-?\\s*${escaped}$`, 'i'), '').trim();
}

function episodeNumbers(
  fileName: string,
  elements: Array<Element>
): Array<number> {
  const episodes = elements.filter(element => element.kind === 'episode');
  const numbers = episodes
    .map(element => Number(element.value))
    .filter(value => Number.isFinite(value));
  const [firstEpisode, secondEpisode] = episodes;
  const [start, end] = numbers;
  if (
    numbers.length !== 2 ||
    !firstEpisode ||
    !secondEpisode ||
    start === undefined ||
    end === undefined
  ) {
    return numbers;
  }

  const characters = Array.from(fileName);
  const between = characters
    .slice(
      firstEpisode.position + Array.from(firstEpisode.value).length,
      secondEpisode.position
    )
    .join('');
  const isRange =
    /[-~]/.test(between) &&
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    end > start;
  return isRange
    ? Array.from({length: end - start + 1}, (_, index) => start + index)
    : numbers;
}

function parseSceneEpisode(stem: string): ParsedName {
  const result = filenameParse(stem, true) as ParsedShow;
  const parsed = emptyParsedName('scene');
  const {name, year} = splitTrailingYear(result.title);

  parsed.name = name;
  parsed.year = year ?? toNumber(result.year);
  parsed.season = result.seasons?.[0] ?? null;
  parsed.episodes = result.episodeNumbers ?? [];
  parsed.airDate = result.airDate ? localIsoDate(result.airDate) : null;
  parsed.episodeTitle = result.remainder?.trim() || null;
  parsed.group = plausibleGroup(result.group);
  parsed.resolution = normaliseResolution(result.resolution ?? null);
  return parsed;
}

function parseSceneFilm(stem: string): ParsedName {
  const result = filenameParse(stem, false);
  const parsed = emptyParsedName('scene');
  parsed.name = result.title || null;
  parsed.year = toNumber(result.year);
  parsed.group = plausibleGroup(result.group);
  parsed.resolution = normaliseResolution(result.resolution ?? null);
  parsed.edition = editionLabel(stem, result.edition);
  return parsed;
}

function splitTrailingYear(title: string): {
  name: string | null;
  year: number | null;
} {
  const match = /^(.*?)[\s.]*\(?((?:19|20)\d{2})\)?$/.exec(title.trim());
  if (match?.[1]) return {name: match[1].trim(), year: Number(match[2])};
  return {name: title.trim() || null, year: null};
}

function localIsoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function plausibleGroup(group: string | null | undefined): string | null {
  if (!group || /^(DL|E\d+)$/i.test(group)) return null;
  return group;
}

function editionLabel(stem: string, edition: Edition): string | null {
  const spelled =
    /\b(Final Cut|Director'?s Cut|Extended(?: Edition| Cut)?|Theatrical(?: Cut)?|Remastered|Unrated|IMAX)\b/i.exec(
      stem.replace(/[._]/g, ' ')
    );
  if (spelled?.[1]) return spelled[1];
  if (edition.directors) return "Director's Cut";
  if (edition.extended) return 'Extended';
  if (edition.theatrical) return 'Theatrical';
  if (edition.remastered) return 'Remastered';
  if (edition.unrated) return 'Unrated';
  if (edition.imax) return 'IMAX';
  return null;
}

function normaliseResolution(resolution: string | null): string | null {
  if (resolution === null) return null;
  const height =
    /(\d{3,4})p$/i.exec(resolution)?.[1] ??
    /\d{3,4}x(\d{3,4})/i.exec(resolution)?.[1];
  return height ? `${height}p` : resolution;
}

function nameFromFolder(folderName: string): string {
  return folderName
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/[._]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toNumber(text: string | null | undefined): number | null {
  if (text === null || text === undefined || text === '') return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}
