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
  seasonEpisode: /\bS\d{1,3}[ .-]?E\d{1,4}/i,
  crossEpisode: /\b\d{1,2}x\d{2,3}\b/i,
  year: /\b(19|20)\d{2}\b/,
};

const explicitEpisodePatterns = [
  /\bS(\d{1,3})[ .-]?E(\d{1,4})(?!\d)((?:-?(?:S\d{1,3})?E\d{1,4}|-\d{1,4}(?![\dA-Za-z]))*)/i,
  /\b(\d{1,2})x(\d{1,3})(?=$|[^\dA-Za-z]|x\d)((?:(?:[ .-]?\d{1,2}x\d{1,3}|-?x\d{1,3}|-\d{1,3})(?=$|[^\dA-Za-z]|x\d))*)/i,
];

const maximumEpisodesPerFile = 100;

const datePatterns = {
  yearFirst: /\b((?:19|20)\d{2})[.\- ](\d{2})[.\- ](\d{2})\b/,
  yearLast: /\b(\d{2})[.\- ](\d{2})[.\- ]((?:19|20)\d{2})\b/,
};

const deviceFileNames = [
  /^[A-Z]{2,5} ?[A-Z]?\d{3,}/,
  /^\d{8} \d{6}/,
  /\d{4}-\d{2}-\d{2} \d{2}[-.]\d{2}[-.]\d{2}/,
  /^Screen ?(?:Recording|Shot)\b/i,
];

const languageWords = new Set([
  'dutch',
  'french',
  'german',
  'italian',
  'spanish',
]);

const releaseTags = new Set([
  'dl',
  'dubbed',
  'internal',
  'limited',
  'multi',
  'proper',
  'readnfo',
  'repack',
  'rerip',
  'subbed',
  'vostfr',
]);

const genericFolderNames = new Set([
  'anime',
  'desktop',
  'documents',
  'downloads',
  'extras',
  'featurettes',
  'films',
  'media',
  'movies',
  'new folder',
  'sample',
  'samples',
  'shows',
  'tv',
  'tv shows',
  'untitled folder',
  'video',
  'videos',
]);

const seasonFolderPatterns = [
  /^(.*?)\b(?:season|series)\s*(\d{1,3})\b/i,
  /^(.*?)\bS(\d{1,3})\b/i,
];

const firstImplausibleSeason = 1900;

export function isVideoExtension(extension: string): boolean {
  return videoExtensions.has(extension.toLowerCase());
}

export function parseFileName(input: ParseInput): ParsedName | null {
  if (!isVideoExtension(input.extension)) return null;
  const text = input.stem.replace(/_/g, ' ');
  if (deviceFileNames.some(pattern => pattern.test(text))) return null;
  const parsed = withExplicitEpisodes(parseStem(input, text), text);
  return withFolderClues(parsed, input);
}

function parseStem(input: ParseInput, text: string): ParsedName {
  if (
    clues.groupPrefix.test(text) ||
    clues.checksum.test(text) ||
    clues.bareEpisode.test(text)
  )
    return parseWithAnitomy(input);
  if (clues.seasonEpisode.test(text) || findAirDate(text) !== null)
    return parseSceneEpisode(input.stem, text);
  if (clues.crossEpisode.test(text)) return parseWithAnitomy(input);
  if (clues.year.test(text)) return parseSceneFilm(input.stem);
  return parseWithAnitomy(input);
}

function withExplicitEpisodes(parsed: ParsedName, text: string): ParsedName {
  const explicit = explicitEpisodes(text);
  if (explicit === null) return parsed;
  const parserFoundEpisodes = parsed.episodes.length > 0;
  const textBefore = text
    .slice(0, explicit.index)
    .replace(clues.groupPrefix, '');
  return {
    ...parsed,
    name: (parserFoundEpisodes ? parsed.name : null) || cleanTitle(textBefore),
    season: explicit.season,
    episodes: explicit.episodes,
  };
}

function explicitEpisodes(
  text: string
): {season: number; episodes: Array<number>; index: number} | null {
  for (const pattern of explicitEpisodePatterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    const [, season = '', first = '', rest = ''] = match;
    if (Number(season) >= firstImplausibleSeason) return null;
    const numbers = [
      Number(first),
      ...Array.from(rest.matchAll(/[Ex-](\d+)(?![\dEx])/gi), found =>
        Number(found[1])
      ),
    ];
    const laterSeasons = Array.from(rest.matchAll(/S(\d+)E|(\d+)x/gi), found =>
      Number(found[1] ?? found[2])
    );
    const start = numbers[0] ?? 0;
    const end = numbers.at(-1) ?? start;
    const isOneRun =
      isIncreasing(numbers) &&
      laterSeasons.every(later => later === Number(season)) &&
      end - start < maximumEpisodesPerFile;
    return {
      season: Number(season),
      episodes: isOneRun ? numberRange(start, end) : [start],
      index: match.index,
    };
  }
  return null;
}

function isIncreasing(numbers: Array<number>): boolean {
  return numbers.every(
    (value, index) => index === 0 || value > (numbers[index - 1] ?? value)
  );
}

function numberRange(start: number, end: number): Array<number> {
  return Array.from({length: end - start + 1}, (_, index) => start + index);
}

type FoundDate = {isoDate: string; index: number; end: number};

function findAirDate(text: string): FoundDate | null {
  const yearFirst = datePatterns.yearFirst.exec(text);
  if (yearFirst) {
    const [matched, year = '', second = '', third = ''] = yearFirst;
    const isoDate =
      validDate(year, second, third) ?? validDate(year, third, second);
    if (isoDate !== null) return foundDate(isoDate, yearFirst.index, matched);
  }
  const yearLast = datePatterns.yearLast.exec(text);
  if (yearLast) {
    const [matched, first = '', second = '', year = ''] = yearLast;
    const isoDate =
      validDate(year, second, first) ?? validDate(year, first, second);
    if (isoDate !== null) return foundDate(isoDate, yearLast.index, matched);
  }
  return null;
}

function foundDate(isoDate: string, index: number, matched: string): FoundDate {
  return {isoDate, index, end: index + matched.length};
}

function validDate(year: string, month: string, day: string): string | null {
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  const isValid =
    date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day);
  return isValid ? `${year}-${month}-${day}` : null;
}

function withFolderClues(
  parsed: ParsedName,
  {folderName, parentFolderName}: ParseInput
): ParsedName {
  if (parsed.name !== null && parsed.name.trim() !== '') return parsed;

  const seasonFolder = readSeasonFolder(folderName);
  if (seasonFolder === null) {
    const name = usableFolderName(folderName);
    return {...parsed, name, nameFromFolder: name !== null};
  }
  const name =
    seasonFolder.name ??
    (parentFolderName === null ? null : usableFolderName(parentFolderName));
  const season =
    parsed.season ?? (parsed.episodes.length > 0 ? seasonFolder.season : null);
  return {...parsed, name, season, nameFromFolder: name !== null};
}

export function readSeasonFolder(
  folderName: string
): {name: string | null; season: number} | null {
  const cleaned = cleanFolderName(folderName);
  if (/^specials?$/i.test(cleaned)) return {name: null, season: 0};
  for (const pattern of seasonFolderPatterns) {
    const match = pattern.exec(cleaned);
    if (match) {
      return {
        name: usableFolderName(match[1] ?? ''),
        season: Number(match[2]),
      };
    }
  }
  return null;
}

function usableFolderName(folderName: string): string | null {
  const cleaned = cleanFolderName(folderName);
  if (cleaned === '' || genericFolderNames.has(cleaned.toLowerCase()))
    return null;
  return cleaned;
}

function cleanFolderName(folderName: string): string {
  return tidyWords(folderName.replace(/\[[^\]]*\]|\([^)]*\)/g, ' '));
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
  const {name, year} = nameAndYear(
    title === null ? null : removeTrailingType(title, type),
    first('year')
  );
  parsed.name = name;
  parsed.year = year;
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
  const allEpisodes = elements.filter(element => element.kind === 'episode');
  const outsideParentheses = allEpisodes.filter(
    element => !isInParentheses(fileName, element)
  );
  const episodes =
    outsideParentheses.length > 0 ? outsideParentheses : allEpisodes;
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
  return isRange ? numberRange(start, end) : numbers;
}

function isInParentheses(fileName: string, element: Element): boolean {
  const characters = Array.from(fileName);
  const end = element.position + Array.from(element.value).length;
  return characters[element.position - 1] === '(' && characters[end] === ')';
}

function parseSceneEpisode(stem: string, text: string): ParsedName {
  const result = filenameParse(stem, true) as ParsedShow;
  const parsed = emptyParsedName('scene');
  const seasonEpisode = clues.seasonEpisode.exec(text);
  const airDate = seasonEpisode ? null : findAirDate(text);
  const numbersEnd = seasonEpisode
    ? seasonEpisode.index + seasonEpisode[0].length
    : (airDate?.end ?? text.length);
  const remainder = cleanRemainder(
    textFoundIn(result.remainder, text.slice(numbersEnd))
  );
  parsed.episodeTitle = remainder.text;
  parsed.version = remainder.version;
  parsed.resolution = normaliseResolution(result.resolution ?? null);

  if (airDate) {
    parsed.name = cleanTitle(text.slice(0, airDate.index));
    parsed.airDate = airDate.isoDate;
    return parsed;
  }

  const {name, year} = splitTrailingYear(result.title);
  const season = result.seasons?.[0] ?? null;
  const isPlausibleSeason = season === null || season < firstImplausibleSeason;
  parsed.name = name;
  parsed.year = year ?? toNumber(result.year);
  parsed.season = isPlausibleSeason ? season : null;
  parsed.episodes = isPlausibleSeason ? (result.episodeNumbers ?? []) : [];
  parsed.group = plausibleGroup(result.group);
  return parsed;
}

function parseSceneFilm(stem: string): ParsedName {
  const result = filenameParse(stem, false);
  const parsed = emptyParsedName('scene');
  const {name, year} = nameAndYear(result.title || null, result.year);
  parsed.name = name;
  parsed.year = year;
  parsed.group = plausibleGroup(result.group);
  parsed.resolution = normaliseResolution(result.resolution ?? null);
  parsed.edition = editionLabel(stem, result.edition);
  return parsed;
}

function splitTrailingYear(title: string): {
  name: string | null;
  year: number | null;
} {
  const match = /^(.*?)[\s.]*[[(]?((?:19|20)\d{2})[\])]?[\s-]*$/.exec(title);
  if (match?.[1]) return nameAndYear(cleanTitle(match[1]), match[2]);
  return {name: cleanTitle(title), year: null};
}

function nameAndYear(
  name: string | null,
  yearText: string | null | undefined
): {name: string | null; year: number | null} {
  const year = toNumber(yearText);
  if (year === null || year <= new Date().getFullYear() + 1)
    return {name, year};
  return {name: name === null ? String(year) : `${name} ${year}`, year: null};
}

function textFoundIn(
  text: string | undefined,
  searched: string
): string | undefined {
  if (text === undefined) return undefined;
  const found = tidyWords(searched).toLowerCase();
  return found.includes(tidyWords(text).toLowerCase()) ? text : undefined;
}

function cleanRemainder(remainder: string | undefined): {
  text: string | null;
  version: number | null;
} {
  let version: number | null = null;
  const words: Array<string> = [];
  for (const word of (remainder ?? '').split(/\s+/)) {
    const versionMatch = /^v(\d+)$/i.exec(word);
    if (versionMatch) version = Number(versionMatch[1]);
    else if (word !== '') words.push(word);
  }
  while (words.length > 0 && isReleaseTag(words[0] ?? '')) words.shift();
  let trimmedTag = false;
  while (words.length > 0) {
    const last = words.at(-1) ?? '';
    const isTag = isReleaseTag(last);
    if (!isTag && !(trimmedTag && languageWords.has(last.toLowerCase()))) break;
    trimmedTag ||= isTag;
    words.pop();
  }
  const text = withoutUnmatchedBrackets(words.join(' ')).trim();
  return {text: text === '' ? null : text, version};
}

function isReleaseTag(word: string): boolean {
  return releaseTags.has(word.toLowerCase()) && !/^[A-Z][a-z]+$/.test(word);
}

function withoutUnmatchedBrackets(text: string): string {
  let result = text;
  if (occurrences(text, '(') !== occurrences(text, ')'))
    result = result.replace(/[()]/g, '');
  if (occurrences(text, '[') !== occurrences(text, ']'))
    result = result.replace(/[[\]]/g, '');
  return result;
}

function occurrences(text: string, character: string): number {
  return text.split(character).length - 1;
}

function cleanTitle(text: string): string | null {
  return tidyWords(withoutUnmatchedBrackets(text)) || null;
}

function tidyWords(text: string): string {
  return text
    .replace(/[._]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s-]+|[\s-]+$/g, '');
}

function plausibleGroup(group: string | null | undefined): string | null {
  if (!group || /^(DL|E?\d+)$/i.test(group)) return null;
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

function toNumber(text: string | null | undefined): number | null {
  if (text === null || text === undefined || text === '') return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}
