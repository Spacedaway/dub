import type {ParsedName} from '@/domain/parsing/parsed-name';

export type ParserCase = {
  fileName: string;
  folderName?: string;
  expected: Partial<Omit<ParsedName, 'parser'>> | null;
  knownFailure?: string;
};

export const parserCases: Array<ParserCase> = [
  {
    fileName: '[SubsPlease] Sousou no Frieren - 05 (1080p) [A1B2C3D4].mkv',
    expected: {
      name: 'Sousou no Frieren',
      episodes: [5],
      group: 'SubsPlease',
      resolution: '1080p',
      crc: 'A1B2C3D4',
    },
  },
  {
    fileName:
      '[TaigaSubs]_Toradora!_(2008)_-_01v2_-_Tiger_and_Dragon_[1280x720_H.264_FLAC][1234ABCD].mkv',
    expected: {
      name: 'Toradora!',
      year: 2008,
      season: null,
      episodes: [1],
      version: 2,
      episodeTitle: 'Tiger and Dragon',
    },
  },
  {
    fileName: '[Erai-raws] 86 - Eighty Six - 01 [1080p].mkv',
    expected: {name: '86 - Eighty Six', episodes: [1]},
  },
  {
    fileName: '[Judas] Kimetsu no Yaiba - 12.5 [1080p].mkv',
    expected: {name: 'Kimetsu no Yaiba', episodes: [12.5]},
  },
  {
    fileName: '[Group] Show Name - 01-03 [BD 1080p].mkv',
    expected: {name: 'Show Name', episodes: [1, 2, 3]},
  },
  {
    fileName: '[Group] Show Name - OVA [1080p].mkv',
    expected: {name: 'Show Name', episodes: []},
  },
  {
    fileName: 'Frieren - 05 [1080p].mkv',
    folderName: 'Frieren (01-12) [Batch]',
    expected: {name: 'Frieren', episodes: [5]},
  },
  {
    fileName: '01.mkv',
    folderName: 'Cowboy Bebop',
    expected: {name: 'Cowboy Bebop', episodes: [1], nameFromFolder: true},
  },
  {
    fileName: '[HorribleSubs] Shingeki no Kyojin S3 - 49 [720p].mkv',
    expected: {name: 'Shingeki no Kyojin', season: 3, episodes: [49]},
  },

  {
    fileName: 'The.Office.US.S09E06.HDTV.XviD-AFG.avi',
    expected: {name: 'The Office US', season: 9, episodes: [6], group: 'AFG'},
  },
  {
    fileName: 'Smallville.S01E01.Pilot.720p.BluRay.x264-REWARD.mkv',
    expected: {
      name: 'Smallville',
      season: 1,
      episodes: [1],
      resolution: '720p',
    },
  },
  {
    fileName: 'Doctor.Who.2005.S01E01.Rose.1080p.WEB-DL.mkv',
    expected: {name: 'Doctor Who', year: 2005, season: 1, episodes: [1]},
  },
  {
    fileName: 'Show.Name.1x02.Episode.Title.mkv',
    expected: {name: 'Show Name', season: 1, episodes: [2]},
  },
  {
    fileName: '9-1-1.S01E01.720p.HDTV.x264-AVS.mkv',
    expected: {name: '9-1-1', season: 1, episodes: [1]},
  },
  {
    fileName: 'Game.of.Thrones.S01E01E02.1080p.mkv',
    expected: {name: 'Game of Thrones', season: 1, episodes: [1, 2]},
  },
  {
    fileName: 'Show.Name.S01E01-E03.mkv',
    expected: {name: 'Show Name', season: 1, episodes: [1, 2, 3], group: null},
  },
  {
    fileName: 'Show Name - S00E05 - Special Title.mkv',
    expected: {name: 'Show Name', season: 0, episodes: [5]},
  },
  {
    fileName: 'The.Daily.Show.2026.11.05.Guest.720p.WEB.h264-GRP.mkv',
    expected: {name: 'The Daily Show', airDate: '2026-11-05'},
  },

  {
    fileName: '2001.A.Space.Odyssey.1968.1080p.BluRay.x264.mkv',
    expected: {name: '2001 A Space Odyssey', year: 1968, episodes: []},
  },
  {
    fileName: '2001 A Space Odyssey (1968).mkv',
    expected: {name: '2001 A Space Odyssey', year: 1968, episodes: []},
  },
  {
    fileName: 'Blade.Runner.2049.2017.2160p.UHD.BluRay.x265-TERMiNAL.mkv',
    expected: {name: 'Blade Runner 2049', year: 2017, resolution: '2160p'},
  },
  {
    fileName: '1917.2019.1080p.WEB-DL.mkv',
    expected: {name: '1917', year: 2019},
  },
  {
    fileName: 'Arrival.2016.1080p.BluRay.x264-SPARKS.mkv',
    expected: {name: 'Arrival', year: 2016},
  },
  {
    fileName: 'This.is.40.2012.PROPER.UNRATED.720p.BluRay.x264-Felony.mkv',
    expected: {name: 'This is 40', year: 2012},
  },
  {
    fileName: 'Blade Runner (1982) Final Cut.mkv',
    expected: {name: 'Blade Runner', year: 1982, edition: 'Final Cut'},
  },

  {
    fileName: 'Episode 12.mkv',
    folderName: 'Planet Earth II',
    expected: {name: 'Planet Earth II', episodes: [12], nameFromFolder: true},
  },
  {fileName: 'IMG_2034.JPG', expected: null},
];
