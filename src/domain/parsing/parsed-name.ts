export type ParserId = 'anitomy' | 'scene';

export type ParsedName = {
  parser: ParserId;
  name: string | null;
  year: number | null;
  season: number | null;
  episodes: Array<number>;
  airDate: string | null;
  episodeTitle: string | null;
  group: string | null;
  resolution: string | null;
  crc: string | null;
  version: number | null;
  edition: string | null;
  nameFromFolder: boolean;
};

export type ParseInput = {
  stem: string;
  extension: string;
  folderName: string;
  parentFolderName: string | null;
};

export function emptyParsedName(parser: ParserId): ParsedName {
  return {
    parser,
    name: null,
    year: null,
    season: null,
    episodes: [],
    airDate: null,
    episodeTitle: null,
    group: null,
    resolution: null,
    crc: null,
    version: null,
    edition: null,
    nameFromFolder: false,
  };
}
