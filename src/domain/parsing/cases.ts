import type {ParsedName} from '@/domain/parsing/parsed-name';

export type ParserCase = {
  fileName: string;
  folderName?: string;
  parentFolderName?: string | null;
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

  {
    fileName: '[Group] 3x3 Eyes - 05 [720p].mkv',
    knownFailure: 'anitomy reads the 3x3 in the title as season 3, episode 3',
    expected: {name: '3x3 Eyes', season: null, episodes: [5]},
  },
  {fileName: 'IMG_0042.MOV', expected: null},
  {fileName: 'IMG_E0042.MOV', expected: null},
  {
    fileName: '2024-01-15 18-30-22.mkv',
    folderName: 'OBS Recordings',
    expected: null,
  },
  {fileName: 'video_2024-01-15_18-30-22.mp4', expected: null},
  {
    fileName: 'Show.1x05.x264-LOL.mkv',
    expected: {name: 'Show', season: 1, episodes: [5]},
  },
  {fileName: 'Show 1x05 x265.mkv', expected: {season: 1, episodes: [5]}},
  {
    fileName: 'Show 1x01x02.mkv',
    expected: {name: 'Show', season: 1, episodes: [1, 2]},
  },
  {
    fileName: 'Olympics 4x100m Relay Final.mp4',
    expected: {season: null, episodes: []},
  },
  {fileName: 'Show.S01E01-S02E03.mkv', expected: {season: 1, episodes: [1]}},
  {fileName: 'Show S01E01-E9999.mkv', expected: {season: 1, episodes: [1]}},
  {fileName: 'Show 03.04.2024.mkv', expected: {airDate: '2024-04-03'}},
  {fileName: 'Show 03-04-2024.mkv', expected: {airDate: '2024-04-03'}},
  {fileName: 'Show.2024.02.31.mkv', expected: {airDate: null}},
  {
    fileName: 'Show - S02E05 - Internal Affairs.mkv',
    expected: {episodeTitle: 'Internal Affairs'},
  },
  {
    fileName: 'Law.and.Order.S05E10.Internal.Affairs.720p.HDTV.x264-GRP.mkv',
    expected: {name: 'Law and Order', episodeTitle: 'Internal Affairs'},
  },
  {
    fileName: 'Show - S01E03 - French Mistake.mkv',
    expected: {episodeTitle: 'French Mistake'},
  },
  {
    fileName: 'Show.S01E05.German.DL.720p.mkv',
    expected: {episodeTitle: null},
  },
  {fileName: 'VID_20240101_123456.mp4', expected: null},
  {fileName: '20240101_123456.mp4', expected: null},
  {fileName: 'Screen Recording 2024-01-01 at 10.00.00.mov', expected: null},
  {
    fileName: 'Birthday 2019-07-04.mp4',
    expected: {
      name: 'Birthday',
      airDate: '2019-07-04',
      episodeTitle: null,
      season: null,
      episodes: [],
    },
  },
  {
    fileName: 'Show.Name.S01E05.PROPER.720p.HDTV.x264-GRP.mkv',
    expected: {name: 'Show Name', episodes: [5], episodeTitle: null},
  },
  {
    fileName: 'Show.Name.S01E05.mkv',
    expected: {name: 'Show Name', episodes: [5], episodeTitle: null},
  },
  {
    fileName: 'Show.Name.S01E05v2.720p.mkv',
    expected: {episodes: [5], version: 2, episodeTitle: null},
  },
  {
    fileName: 'Show.Name.S01E05.Episode.Title.REPACK.720p.mkv',
    expected: {episodes: [5], episodeTitle: 'Episode Title'},
  },
  {
    fileName: 'Blade Runner 2049.mkv',
    expected: {name: 'Blade Runner 2049', year: null},
  },
  {
    fileName: '01.mkv',
    folderName: 'Downloads',
    expected: {name: null, episodes: [1], nameFromFolder: false},
  },

  {
    fileName: '01.mkv',
    folderName: 'Season 1',
    parentFolderName: 'Cowboy Bebop',
    expected: {
      name: 'Cowboy Bebop',
      season: 1,
      episodes: [1],
      nameFromFolder: true,
    },
  },
  {
    fileName: '05.mkv',
    folderName: 'Season 02 (2005)',
    parentFolderName: 'Doctor Who (2005) [1080p]',
    expected: {name: 'Doctor Who', season: 2, episodes: [5]},
  },
  {
    fileName: 'S03E05.mkv',
    folderName: 'Season 02',
    parentFolderName: 'Show',
    expected: {name: 'Show', season: 3, episodes: [5]},
  },
  {
    fileName: '03.mkv',
    folderName: 'Specials',
    parentFolderName: 'Show',
    expected: {name: 'Show', season: 0, episodes: [3]},
  },
  {
    fileName: 'Episode 3.mkv',
    folderName: 'Planet Earth Series 2',
    expected: {name: 'Planet Earth', season: 2, episodes: [3]},
  },
  {
    fileName: '01.mkv',
    folderName: 'Show.Name.S01.1080p.BluRay.x264-GRP',
    expected: {name: 'Show Name', season: 1, episodes: [1]},
  },
  {
    fileName: '[SubsPlease] Frieren - 29 (1080p).mkv',
    folderName: 'Season 2',
    parentFolderName: 'Frieren',
    expected: {name: 'Frieren', season: null, episodes: [29]},
  },
  {
    fileName: '01.mkv',
    folderName: 'Season 1',
    parentFolderName: 'Downloads',
    expected: {name: null, season: 1, episodes: [1]},
  },
  {
    fileName: '01.mkv',
    folderName: 'Extras',
    parentFolderName: 'Season 1',
    expected: {name: null, season: null, episodes: [1]},
  },

  {
    fileName: 'Series.Title.S03E06.DVDRip.XviD-WiDE.mkv',
    expected: {name: 'Series Title', season: 3, episodes: [6]},
  },
  {
    knownFailure: 'a bare 103 is read as absolute episode 103, not S01E03',
    fileName: 'Series.and.a.Title.103.720p.HDTV.X264-DIMENSION.mkv',
    expected: {name: 'Series and a Title', season: 1, episodes: [3]},
  },
  {
    knownFailure: 'a bare 1013 is read as absolute episode 1013, not S10E13',
    fileName: 'Series.and.a.Title.1013.720p.HDTV.X264-DIMENSION.mkv',
    expected: {name: 'Series and a Title', season: 10, episodes: [13]},
  },
  {
    fileName: 'Series.Title.4x05.HDTV.XviD-LOL.mkv',
    expected: {name: 'Series Title', season: 4, episodes: [5]},
  },
  {
    fileName: 'Series.Title.2010.S02E14.HDTV.XviD-LOL.mkv',
    expected: {name: 'Series Title', year: 2010, season: 2, episodes: [14]},
  },
  {
    fileName: 'Series Title 0 S01E19 720p WEB DL DD5 1 H 264 NT.mkv',
    expected: {name: 'Series Title 0', season: 1, episodes: [19]},
  },
  {
    fileName: 'Series Title - S02E21 - 94 Meetings - 720p TV.mkv',
    expected: {name: 'Series Title', season: 2, episodes: [21]},
  },
  {
    fileName:
      '24-7 Series - Title - Road to the Sonarr - S01E03 - Episode 3.mkv',
    expected: {
      name: '24-7 Series - Title - Road to the Sonarr',
      season: 1,
      episodes: [3],
    },
  },
  {
    fileName: 'Series.Title.Inc.S03E19.DVDRip."XviD"-OSiTV.mkv',
    expected: {name: 'Series Title Inc', season: 3, episodes: [19]},
  },
  {
    fileName: 'Series Title-0 (2010) - 1x05 - Missing Title.mkv',
    expected: {name: 'Series Title-0', year: 2010, season: 1, episodes: [5]},
  },
  {
    fileName: 'Series Title - S06E13 - 5 to 9 [DVD].mkv',
    expected: {name: 'Series Title', season: 6, episodes: [13]},
  },
  {
    knownFailure: 'a bare 525 is read as absolute episode 525, not S05E25',
    fileName: 'Series.Title.525.mkv',
    expected: {name: 'Series Title', season: 5, episodes: [25]},
  },
  {
    knownFailure: "Part01 isn't read as an episode",
    fileName:
      '24 7 Series-Title - Road to the Sonarr Part01 720p HDTV x264 ORENJI.mkv',
    expected: {
      name: '24 7 Series-Title - Road to the Sonarr',
      season: 1,
      episodes: [1],
    },
  },
  {
    fileName: 'S6E02-Unwrapped-(Playing With Food) - [DarkData].mkv',
    expected: {name: null, season: 6, episodes: [2]},
  },
  {
    fileName: '01x04 - Halloween, Part 1 - 720p WEB-DL.mkv',
    expected: {name: null, season: 1, episodes: [4]},
  },
  {
    fileName: 'series.s03.e05.ws.dvdrip.xvid-m00tv.mkv',
    expected: {name: 'series', season: 3, episodes: [5]},
  },
  {
    knownFailure: "a bare 416 after a year isn't split into S04E16",
    fileName: 'series.2009.416.hdtv-lol.mkv',
    expected: {name: 'series', year: 2009, season: 4, episodes: [16]},
  },
  {
    knownFailure: 'seasons of 1900 or more are treated as dates, on purpose',
    fileName: 'Series Title - S1936E18 - I Love to Singa.mkv',
    expected: {name: 'Series Title', season: 1936, episodes: [18]},
  },
  {
    fileName: 'Series_Title!_-_7x6_-_The_Scarlett_Getter_[SDTV].mkv',
    expected: {name: 'Series Title!', season: 7, episodes: [6]},
  },
  {
    fileName: 'Top Series - 07x03 - 2005.11.70.mkv',
    expected: {name: 'Top Series', season: 7, episodes: [3]},
  },
  {
    fileName: 'Series.S04E09.Swan.Song.1080p.WEB-DL.DD5.1.H.264-ECI.mkv',
    expected: {name: 'Series', season: 4, episodes: [9]},
  },
  {
    fileName: 'S08E20 50-50 Carla [DVD].mkv',
    expected: {name: null, season: 8, episodes: [20]},
  },
  {
    fileName: 'Developers & Coders S02E10 6-50 to SLC [SDTV].mkv',
    expected: {name: 'Developers & Coders', season: 2, episodes: [10]},
  },
  {
    fileName: 'Series.Hunters.Galatic.S05E607.720p.hdtv.x264.mkv',
    expected: {name: 'Series Hunters Galatic', season: 5, episodes: [607]},
  },
  {fileName: '1x04.mkv', expected: {name: null, season: 1, episodes: [4]}},
  {
    knownFailure: 'seasons of 1900 or more are treated as dates, on purpose',
    fileName: '2009x09 [SDTV].avi',
    expected: {name: null, season: 2009, episodes: [9]},
  },
  {
    fileName: 'Series_Title.19x06.720p_HDTV_x264-FoV.mkv',
    expected: {name: 'Series Title', season: 19, episodes: [6]},
  },
  {
    fileName: 'The_Series_US_s06e19_04.28.2014_hdtv.x264.Poke.mp4',
    expected: {name: 'The Series US', season: 6, episodes: [19]},
  },
  {
    fileName:
      'Series Title [2022] [S25E13] [PL] [720p] [WEB-DL-CZRG] [x264].mkv',
    expected: {name: 'Series Title', year: 2022, season: 25, episodes: [13]},
  },
  {
    fileName: 'SeriesTitle-S16E08-10426008-0.mkv',
    expected: {name: 'SeriesTitle', season: 16, episodes: [8]},
  },
  {
    fileName: '[Judas] Series Title (2024) - S01E14.mkv',
    expected: {name: 'Series Title', year: 2024, season: 1, episodes: [14]},
  },
  {
    knownFailure: 'the Chinese title before the English one is kept',
    fileName:
      '我的人间烟火.Fireworks.Series.S01E01.2023.V2.1080p.WEB-DL.H264.AAC-SeeWEB.mkv',
    expected: {name: 'Fireworks Series', season: 1, episodes: [1]},
  },
  {
    fileName:
      'Series S093E081 1080p ALL4 WEB-DL AAC2 0 H 264-JJUNAHJAMESON.mkv',
    expected: {name: 'Series', season: 93, episodes: [81]},
  },
  {
    fileName: 'Series - S3E10 - Episode #3.10 - rus 720p WEBDL (LostFilm).mkv',
    expected: {name: 'Series', season: 3, episodes: [10]},
  },
  {
    fileName: 'Series.S03E01-06.DUAL.BDRip.XviD.AC3.-HELLYWOOD.mkv',
    expected: {name: 'Series', season: 3, episodes: [1, 2, 3, 4, 5, 6]},
  },
  {
    fileName: 'Series.Title.2x04.2x05.720p.BluRay-FUTV.mkv',
    expected: {name: 'Series Title', season: 2, episodes: [4, 5]},
  },
  {
    fileName: 'S02E03-04-05.720p.BluRay-FUTV.mkv',
    expected: {name: null, season: 2, episodes: [3, 4, 5]},
  },
  {
    fileName: 'Series.Kings.S02E09-E10.HDTV.x264-ASAP.mkv',
    expected: {name: 'Series Kings', season: 2, episodes: [9, 10]},
  },
  {
    fileName: 'Series Kings - 2x9-2x10 - Served Code [SDTV].mkv',
    expected: {name: 'Series Kings', season: 2, episodes: [9, 10]},
  },
  {
    fileName: 'Series.S01E91-E100.mkv',
    expected: {
      name: 'Series',
      season: 1,
      episodes: [91, 92, 93, 94, 95, 96, 97, 98, 99, 100],
    },
  },
  {
    knownFailure: "compressed S01E07E08 (10708) isn't split",
    fileName: 'Series.10708.hdtv-lol.mp4',
    expected: {name: 'Series', season: 1, episodes: [7, 8]},
  },
  {
    knownFailure: "compressed S01E09E10 (010910) isn't split",
    fileName: 'E.010910.HDTVx264REPACKLOL.mp4',
    expected: {name: 'E', season: 1, episodes: [9, 10]},
  },
  {
    fileName: 'Series Title.S6E1-S6E2.Episode Name.1080p.WEB-DL.mkv',
    expected: {name: 'Series Title', season: 6, episodes: [1, 2]},
  },
  {
    fileName: 'Series Title.S6.E1E3.Episode Name.1080p.WEB-DL.mkv',
    expected: {name: 'Series Title', season: 6, episodes: [1, 2, 3]},
  },
  {
    fileName:
      '[AqusiQ-TorrentS.pl]The.Name.of.the.Series.S01E05-06.PL.2160p-Ralf[shogho].mkv',
    expected: {name: 'The Name of the Series', season: 1, episodes: [5, 6]},
  },
  {
    fileName: 'Series Title - [02x01-02] - Episode 1.mkv',
    expected: {name: 'Series Title', season: 2, episodes: [1, 2]},
  },
  {
    knownFailure: "Spanish Temporada/Cap markers aren't recognised",
    fileName: 'Series falls - Temporada 1 [HDTV][Cap.111_120].mkv',
    expected: {
      name: 'Series falls',
      season: 1,
      episodes: [11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
    },
  },
  {
    fileName: 'Series Title - S15E06-07 - City Sushi HDTV-720p.mkv',
    expected: {name: 'Series Title', season: 15, episodes: [6, 7]},
  },
  {
    fileName: '1x01-x03 - Episode Title.HDTV-720p.mkv',
    expected: {name: null, season: 1, episodes: [1, 2, 3]},
  },
  {
    fileName: '[SubDESU]_Show_One_07_(1280x720_x264-AAC)_[6B7FD717].mkv',
    expected: {name: 'Show One', season: null, episodes: [7]},
  },
  {
    fileName: '[Chihiro]_Show!!_-_06_[848x480_H.264_AAC][859EEAFA].mkv',
    expected: {name: 'Show!!', season: null, episodes: [6]},
  },
  {
    fileName: '[Commie]_Some_Anime_Show_-_11_[65F220B4].mkv',
    expected: {name: 'Some Anime Show', season: null, episodes: [11]},
  },
  {
    fileName: '[HorribleSubs] Some Anime Show - 13 [1080p].mkv',
    expected: {name: 'Some Anime Show', season: null, episodes: [13]},
  },
  {
    fileName: '[Doremi].Some.Anime.Show.8.Go!.31.[1280x720].[C65D4B1F].mkv',
    expected: {name: 'Some Anime Show 8 Go!', season: null, episodes: [31]},
  },
  {
    fileName: '[K-F] Some Anime Show S10E14 214.mkv',
    expected: {name: 'Some Anime Show', season: 10, episodes: [14]},
  },
  {
    knownFailure: 'the absolute number before 10x14 stays in the name',
    fileName: '[K-F] Some Anime Show 214 10x14.mkv',
    expected: {name: 'Some Anime Show', season: 10, episodes: [14]},
  },
  {
    fileName: 'Some Anime Show - 031 - The Resolution to Kill [Lunar].avi',
    expected: {name: 'Some Anime Show', season: null, episodes: [31]},
  },
  {
    knownFailure: 'anitomy reads the episode as part of the title',
    fileName: '[ACX]Some Anime Show 01 Role Play [Kosaka] [9C57891E].mkv',
    expected: {name: 'Some Anime Show', season: null, episodes: [1]},
  },
  {
    fileName: '[SFW-sage] Some Anime Show S3 - 12 [720p][D07C91FC].mkv',
    expected: {name: 'Some Anime Show', season: 3, episodes: [12]},
  },
  {
    fileName:
      '[Underwater-FFF] No Series Title No Life - 01 (720p) [27AAA0A0].mkv',
    expected: {name: 'No Series Title No Life', season: null, episodes: [1]},
  },
  {
    fileName: '[DeadFish] Series Title - 09v2 [720p][AAC].mkv',
    expected: {name: 'Series Title', season: null, episodes: [9], version: 2},
  },
  {
    fileName: '[S-T-D] Series Title! - 06 (1280x720 10bit AAC) [59B3F2EA].mkv',
    expected: {name: 'Series Title!', season: null, episodes: [6]},
  },
  {
    fileName: 'Initial_Series_Title_-_01(DVD)_-_(Central_Anime)[5AF6F1E4].mkv',
    expected: {name: 'Initial Series Title', season: null, episodes: [1]},
  },
  {
    fileName: 'Series Title - 001 - Fairy Tail.mkv',
    expected: {name: 'Series Title', season: null, episodes: [1]},
  },
  {
    fileName: 'Series Title - 100 - Mest.mkv',
    expected: {name: 'Series Title', season: null, episodes: [100]},
  },
  {
    fileName: '[Exiled-Destiny] Series Title Ep01 (D2201EC5).mkv',
    expected: {name: 'Series Title', season: null, episodes: [1]},
  },
  {
    fileName: '[Hatsuyuki]Series_Title-01[1280x720][122E6EF8].mkv',
    expected: {name: 'Series Title', season: null, episodes: [1]},
  },
  {
    knownFailure:
      'an episode title starting with a number is read as the episode',
    fileName: '[CBM]_Series_Title_-_11_-_511_Kinderheim_[6C70C4E4].mkv',
    expected: {name: 'Series Title', season: null, episodes: [11]},
  },
  {
    fileName: '[HorribleSubs] Series Title 2 - 05 [720p].mkv',
    expected: {name: 'Series Title 2', season: null, episodes: [5]},
  },
  {
    fileName: '[DRONE]Series.Title.100.mkv',
    expected: {name: 'Series Title', season: null, episodes: [100]},
  },
  {
    fileName: '[RlsGrp]Series.Title.2010.S01E01.001.HDTV-720p.x264-DTS.mkv',
    expected: {name: 'Series Title', year: 2010, season: 1, episodes: [1]},
  },
  {
    knownFailure: "an episode in curly braces isn't recognised",
    fileName: 'Series Title (2010) {01} Episode Title (1).hdtv-720p.mkv',
    expected: {name: 'Series Title', year: 2010, season: null, episodes: [1]},
  },
  {
    fileName:
      '[Hatsuyuki] Series Title (2014) - 017 (115) [1280x720][B2CFBC0F].mkv',
    expected: {name: 'Series Title', year: 2014, season: null, episodes: [17]},
  },
  {
    fileName:
      'Series Title (2014) - 39 (137) [v2][720p.HDTV][Unison Fansub].mkv',
    expected: {name: 'Series Title', year: 2014, season: null, episodes: [39]},
  },
  {
    fileName: '[HorribleSubs] Series Title 21 - 101 [480p].mkv',
    expected: {name: 'Series Title 21', season: null, episodes: [101]},
  },
  {
    fileName: '[Cthuyuu].Series.Title.-.03.[720p.H264.AAC][8AD82C3A].mkv',
    expected: {name: 'Series Title', season: null, episodes: [3]},
  },
  {
    fileName: 'Series Title EP06 720p x265 AOZ.mp4',
    expected: {name: 'Series Title', season: null, episodes: [6]},
  },
  {
    fileName: '[Shark-Raws] Series Title #957 (NBN 1280x720 x264 AAC).mp4',
    expected: {name: 'Series Title', season: null, episodes: [957]},
  },
  {
    fileName: 'Series Title S3 -  15 VOSTFR [720p].mkv',
    expected: {name: 'Series Title', season: 3, episodes: [15]},
  },
  {
    fileName: '[BakeSubs] 86 - 01 [1080p][D40A9E55].mkv',
    expected: {name: '86', season: null, episodes: [1]},
  },
  {
    fileName: 'Anime Title S21 1000.mkv',
    expected: {name: 'Anime Title', season: 21, episodes: [1000]},
  },
  {
    fileName: '[HatSubs] Anime Title 1004 [E63F2984].mkv',
    expected: {name: 'Anime Title', season: null, episodes: [1004]},
  },
  {
    fileName: '[SubsPlease] Anime Title 100 S3 - 01 (1080p) [5A493522].mkv',
    expected: {name: 'Anime Title 100', season: 3, episodes: [1]},
  },
  {
    fileName:
      '[DameDesuYo] Another Anime With Special Naming (Season 2) - 33 (1280x720 10bit EAC3) [42A12A76].mkv',
    expected: {
      name: 'Another Anime With Special Naming',
      season: 2,
      episodes: [33],
    },
  },
  {
    fileName:
      '[SubsPlease] Anime Title 300-nen, With Even More Title - 01 (1080p) [8DE44442].mkv',
    expected: {
      name: 'Anime Title 300-nen, With Even More Title',
      season: null,
      episodes: [1],
    },
  },
  {
    knownFailure: "the Turkish B\u00f6l\u00fcm marker isn't recognised",
    fileName:
      'Different show 1. Bölüm (23.10.2023) 720p WebDL AAC H.264 - TURG.mkv',
    expected: {name: 'Different show', season: null, episodes: [1]},
  },
  {
    fileName:
      '[Dae-P9] Anime Series - 05 - S01E05 - Marrying by Contesting (BD 1080p HEVC FLAC AAC) [Dual Audio] [5BCD56B8].mkv',
    expected: {name: 'Anime Series', season: 1, episodes: [5]},
  },
  {
    fileName:
      '[Kaleido-subs] Animation - 12 (S01E12) - (WEB 1080p HEVC x265 10-bit E-AC3 2.0) [1ADD8F6D].mkv',
    expected: {name: 'Animation', season: 1, episodes: [12]},
  },
  {
    fileName: 'Series Title Kai Episodio 13 Audio Latino.mkv',
    expected: {name: 'Series Title Kai', season: null, episodes: [13]},
  },
  {
    fileName: 'Series Title 2011 04 18 Emma Roberts HDTV XviD BFF.mkv',
    expected: {name: 'Series Title', airDate: '2011-04-18'},
  },
  {
    fileName: 'A.Late.Talk.Show.2010.10.11.Johnny.Knoxville.iTouch-MW.mkv',
    expected: {name: 'A Late Talk Show', airDate: '2010-10-11'},
  },
  {
    fileName: 'A Late Talk Show - 2011-04-12 - Gov. Deval Patrick.mkv',
    expected: {name: 'A Late Talk Show', airDate: '2011-04-12'},
  },
  {
    fileName: '2011.01.10 - A Late Talk Show- HD TV.mkv',
    expected: {airDate: '2011-01-10'},
  },
  {
    fileName:
      'A Late Talk Show - 2011-06-16 - Larry David, "Bachelorette" Ashley Hebert, Pitbull with Ne-Yo.mkv',
    expected: {name: 'A Late Talk Show', airDate: '2011-06-16'},
  },
  {
    fileName: '2020.A.Late.Talk.Show.2012.13.02.PDTV.XviD-C4TV.mkv',
    expected: {name: '2020 A Late Talk Show', airDate: '2012-02-13'},
  },
  {
    fileName: '2020.A.Late.Talk.Show.2011.12.02.PDTV.XviD-C4TV.mkv',
    expected: {name: '2020 A Late Talk Show', airDate: '2011-12-02'},
  },
  {
    fileName: 'Series Title - 2013-10-30 - Episode Title (1) [HDTV-720p].mkv',
    expected: {name: 'Series Title', airDate: '2013-10-30'},
  },
  {
    fileName: 'The_Series_US_04.28.2014_hdtv.x264.Poke.mp4',
    expected: {name: 'The Series US', airDate: '2014-04-28'},
  },
  {
    knownFailure: "six-digit YYMMDD dates aren't recognised",
    fileName: 'A_Late_Talk_Show_140722_720p_HDTV_x264-YesTV.mkv',
    expected: {name: 'A Late Talk Show', airDate: '2014-07-22'},
  },
  {
    fileName: 'Tree_Series_2018_06_22_Seth_Meyers_720p_HEVC_x265-MeGusta.mkv',
    expected: {name: 'Tree Series', airDate: '2018-06-22'},
  },
  {
    knownFailure: "eight-digit YYYYMMDD dates aren't recognised",
    fileName: '20161024- Exotic Payback.21x41_720.mkv',
    expected: {airDate: '2016-10-24'},
  },
  {
    fileName: '2019_08_20_1080_all.mp4',
    expected: {name: null, airDate: '2019-08-20'},
  },
  {
    fileName: 'Series Title - 30-04-2024 HDTV 1080p H264 AAC.mkv',
    expected: {name: 'Series Title', airDate: '2024-04-30'},
  },
  {
    fileName: 'Series.Title.13.02.2025.1080i.HDTV.MPA2.0.H.264.mkv',
    expected: {name: 'Series Title', airDate: '2025-02-13'},
  },
];
