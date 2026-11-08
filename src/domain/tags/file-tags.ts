import type {ParsedName} from '@/domain/parsing/parsed-name';
import type {TagValue, TagValues} from '@/domain/tags/tags';
import type {ScannedFile} from '@/ipc/contracts';

export function fileTagValues(file: ScannedFile): TagValues {
  return withoutEmpty({
    Original: text(file.stem),
    Ext: text(file.extension.replace(/^\./, '')),
    Folder: text(file.folderName),
    Created: file.createdMs === null ? undefined : date(file.createdMs),
    Modified: date(file.modifiedMs),
    Size: {kind: 'number', value: file.size},
  });
}

export function parsedTagValues(parsed: ParsedName | null): TagValues {
  if (parsed === null) return {};
  const [firstEpisode, ...laterEpisodes] = parsed.episodes;
  return withoutEmpty({
    Name: text(parsed.name),
    Year: number(parsed.year),
    Season: number(parsed.season),
    Episode:
      firstEpisode === undefined
        ? undefined
        : laterEpisodes.length === 0
          ? {kind: 'number', value: firstEpisode}
          : {kind: 'numbers', values: [firstEpisode, ...laterEpisodes]},
    'Air Date':
      parsed.airDate === null
        ? undefined
        : {kind: 'date', isoDate: parsed.airDate},
    'Episode Title': text(parsed.episodeTitle),
    Group: text(parsed.group),
    Resolution: text(parsed.resolution),
    CRC: text(parsed.crc),
    Version: number(parsed.version),
    Edition: text(parsed.edition),
  });
}

function text(value: string | null): TagValue | undefined {
  return value === null || value.trim() === ''
    ? undefined
    : {kind: 'text', text: value};
}

function number(value: number | null): TagValue | undefined {
  return value === null ? undefined : {kind: 'number', value};
}

function date(milliseconds: number): TagValue {
  const moment = new Date(milliseconds);
  const month = String(moment.getMonth() + 1).padStart(2, '0');
  const day = String(moment.getDate()).padStart(2, '0');
  return {kind: 'date', isoDate: `${moment.getFullYear()}-${month}-${day}`};
}

function withoutEmpty(values: Record<string, TagValue | undefined>): TagValues {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined)
  ) as TagValues;
}
