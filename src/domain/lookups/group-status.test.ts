import {describe, expect, it} from 'vitest';

import {deriveLookups, type FileLookup} from '@/domain/lookups/derive-lookups';
import type {GroupStatus, ShowLookup} from '@/domain/lookups/group-status';
import {lookupGroups} from '@/domain/lookups/lookup-groups';
import type {LookupNote} from '@/domain/lookups/match-episodes';
import {
  readShowListing,
  type ShowListing,
  type TvShow,
} from '@/domain/lookups/tvmaze';
import {parseFileName} from '@/domain/parsing/parse-file-name';
import type {TagValue} from '@/domain/tags/tags';
import type {ScannedFile} from '@/ipc/contracts';

type ExpectedFile = {
  name?: string;
  season?: number;
  episode?: number;
  title?: string;
  notes?: Array<LookupNote['kind']>;
};

type LookupCase = {
  label: string;
  files: Array<string>;
  lookup: ShowLookup;
  status: GroupStatus['kind'];
  suggested?: number | null;
  expected?: Array<ExpectedFile>;
};

type EpisodeDetails = {title?: string; airDate?: string};

function show(id: number, name: string, premiered: string | null): TvShow {
  return {id, name, premiered, status: 'Ended', network: null, country: null};
}

function listing(
  {id, name, premiered}: TvShow,
  seasonLengths: Array<number>,
  details: Record<string, EpisodeDetails> = {}
): ShowListing {
  const episodes = seasonLengths.flatMap((length, index) =>
    Array.from({length}, (_, offset) => {
      const season = index + 1;
      const number = offset + 1;
      const label = `S${season}E${number}`;
      return {
        season,
        number,
        type: 'regular',
        name: details[label]?.title ?? `Title of ${label}`,
        airdate: details[label]?.airDate ?? '',
      };
    })
  );
  const read = readShowListing({id, name, premiered, _embedded: {episodes}}, 0);
  if (read === null) throw new Error(`Unreadable listing for ${name}`);
  return read;
}

function searched(
  candidates: Array<TvShow>,
  found: ShowListing | null
): ShowLookup {
  return {kind: 'searched', candidates, listing: found};
}

function picked(found: ShowListing): ShowLookup {
  return {kind: 'chosen', listing: found, namesakes: false, how: 'picked'};
}

const smallville = show(1, 'Smallville', '2001-10-16');
const smallvilleListing = listing(smallville, [21, 23], {
  S1E1: {title: 'Pilot'},
  S1E2: {title: 'Metamorphosis'},
  S1E3: {title: 'TBA'},
});
const doctorWho1963 = show(766, 'Doctor Who', '1963-11-23');
const doctorWho2005 = show(210, 'Doctor Who', '2005-03-26');
const doctorWho2023 = show(72724, 'Doctor Who', '2023-11-25');
const doctorWhoShows = [doctorWho1963, doctorWho2005, doctorWho2023];
const doctorWho2005Listing = listing(doctorWho2005, [13], {
  S1E1: {title: 'Rose'},
  S1E9: {title: 'The Empty Child (1)'},
  S1E10: {title: 'The Empty Child (2)'},
});
const doctorWho2023Listing = listing(doctorWho2023, [8], {
  S1E1: {title: 'Space Babies'},
  S1E2: {title: "The Devil's Chord"},
});
const shortShow = show(5, 'Short Show', '2015-01-01');
const shortShowListing = listing(shortShow, [6, 9]);
const frieren = show(69956, "Frieren: Beyond Journey's End", '2023-09-29');
const frierenSpinOff = show(
  80137,
  'Sousou no Frieren: ●● no Mahou',
  '2023-10-11'
);
const frierenListing = listing(frieren, [28, 10], {
  S1E5: {title: 'Phantoms of the Dead'},
  S2E1: {title: 'The Second Journey'},
});
const attackOnTitan = show(82, 'Attack on Titan', '2013-04-07');
const attackOnTitanListing = listing(attackOnTitan, [25, 12, 22, 30], {
  S3E12: {title: 'Night of the Battle to Retake the Wall'},
});
const lateShow = show(249, 'A Late Talk Show', '1996-07-22');
const lateShowListing = listing(lateShow, [3], {
  S1E1: {title: 'First Guest', airDate: '2026-11-04'},
  S1E2: {title: 'Second Guest', airDate: '2026-11-06'},
  S1E3: {title: 'Third Guest', airDate: '2026-11-06'},
});

const lookupCases: Array<LookupCase> = [
  {
    label: 'a unique exact name with every episode listed is accepted',
    files: [
      '/tv/Smallville/Season 1/Smallville.S01E01.720p.HDTV.x264-GRP.mkv',
      '/tv/Smallville/Season 1/Smallville.S01E02.720p.HDTV.x264-GRP.mkv',
    ],
    lookup: searched([smallville], smallvilleListing),
    status: 'matched',
    expected: [
      {name: 'Smallville', title: 'Pilot', notes: []},
      {name: 'Smallville', title: 'Metamorphosis', notes: []},
    ],
  },
  {
    label: 'a matching title from the file is accepted',
    files: ['/tv/Smallville.S01E01.Pilot.720p.HDTV.x264-GRP.mkv'],
    lookup: searched([smallville], smallvilleListing),
    status: 'matched',
  },
  {
    label: 'a namesake with no premiere date does not count',
    files: ['/tv/Smallville.S01E01.720p.HDTV.x264-GRP.mkv'],
    lookup: searched(
      [smallville, show(9, 'Smallville', null)],
      smallvilleListing
    ),
    status: 'matched',
  },
  {
    label: 'shows sharing the exact name are unsure without a year',
    files: ['/tv/Doctor.Who.S01E01.720p.HDTV.x264-GRP.mkv'],
    lookup: searched(doctorWhoShows, doctorWho2005Listing),
    status: 'unsure',
    suggested: null,
    expected: [{name: undefined, title: undefined, notes: ['chooseShow']}],
  },
  {
    label: 'a year in the file picks one namesake, and the name keeps the year',
    files: ['/tv/Doctor.Who.2005.S01E01.720p.HDTV.x264-GRP.mkv'],
    lookup: searched(doctorWhoShows, doctorWho2005Listing),
    status: 'matched',
    expected: [{name: 'Doctor Who (2005)', title: 'Rose'}],
  },
  {
    label: 'a file without a year among namesakes is unsure',
    files: [
      '/tv/Doctor.Who.2005.S01E02.720p.HDTV.x264-GRP.mkv',
      '/tv/Doctor.Who.S01E01.720p.WEB.h264-GRP.mkv',
    ],
    lookup: searched(doctorWhoShows, doctorWho2005Listing),
    status: 'unsure',
    suggested: doctorWho2005.id,
  },
  {
    label: 'mixed years in one folder are unsure',
    files: [
      '/tv/Doctor.Who.1963.S01E01.720p.HDTV.x264-GRP.mkv',
      '/tv/Doctor.Who.2005.S01E01.720p.HDTV.x264-GRP.mkv',
    ],
    lookup: searched(doctorWhoShows, doctorWho2005Listing),
    status: 'unsure',
    suggested: null,
  },
  {
    label: 'numbered episodes are never accepted without asking',
    files: [
      "/anime/[SubsPlease] Frieren - Beyond Journey's End - 05 (1080p) [A1B2C3D4].mkv",
    ],
    lookup: searched([frieren], frierenListing),
    status: 'unsure',
    suggested: frieren.id,
  },
  {
    label: 'a romaji name with no exact match is unsure',
    files: [
      '/anime/[SubsPlease] Sousou no Frieren - 05 (1080p) [A1B2C3D4].mkv',
    ],
    lookup: searched([frierenSpinOff, frieren], null),
    status: 'unsure',
    suggested: null,
  },
  {
    label: 'an episode missing from the listing is unsure',
    files: [
      '/tv/Smallville.S01E01.720p.HDTV.x264-GRP.mkv',
      '/tv/Smallville.S01E30.720p.HDTV.x264-GRP.mkv',
    ],
    lookup: searched([smallville], smallvilleListing),
    status: 'unsure',
    suggested: smallville.id,
  },
  {
    label: 'a match found only through absolute numbering is unsure',
    files: ['/tv/Attack.on.Titan.S03E49.720p.HDTV.x264-GRP.mkv'],
    lookup: searched([attackOnTitan], attackOnTitanListing),
    status: 'unsure',
    suggested: attackOnTitan.id,
  },
  {
    label: 'a title from the file that disagrees is unsure',
    files: ['/tv/Smallville.S01E01.Metamorphosis.720p.HDTV.x264-GRP.mkv'],
    lookup: searched([smallville], smallvilleListing),
    status: 'unsure',
  },
  {
    label: 'a folder of specials is unsure',
    files: ['/tv/Smallville/Specials/Smallville.S00E01.720p.HDTV.x264-GRP.mkv'],
    lookup: searched([smallville], smallvilleListing),
    status: 'unsure',
  },
  {
    label: 'a nearby air date alone is unsure',
    files: ['/tv/A.Late.Talk.Show.2026.11.03.720p.WEB.h264-GRP.mkv'],
    lookup: searched([lateShow], lateShowListing),
    status: 'unsure',
  },
  {
    label: 'no search results is not found',
    files: ['/tv/Smallville.S01E01.720p.HDTV.x264-GRP.mkv'],
    lookup: searched([], null),
    status: 'notFound',
    expected: [{notes: ['notFound']}],
  },
  {
    label: 'a remembered show whose year differs from the file is unsure',
    files: ['/tv/Doctor.Who.2023.S01E01.720p.HDTV.x264-GRP.mkv'],
    lookup: {
      kind: 'chosen',
      listing: doctorWho2005Listing,
      namesakes: true,
      how: 'remembered',
    },
    status: 'unsure',
    suggested: doctorWho2005.id,
  },
  {
    label: 'a picked show corrects absolute numbers inside a season',
    files: ['/anime/[Group] Shingeki no Kyojin S3 - 49 [1080p].mkv'],
    lookup: picked(attackOnTitanListing),
    status: 'matched',
    expected: [
      {
        name: 'Attack on Titan',
        season: 3,
        episode: 12,
        title: 'Night of the Battle to Retake the Wall',
        notes: ['numbersDiffer'],
      },
    ],
  },
  {
    label: 'a season with listed files is never read as absolute',
    files: [
      '/tv/Short.Show.S02E09.720p.HDTV.x264-GRP.mkv',
      '/tv/Short.Show.S02E10.720p.HDTV.x264-GRP.mkv',
    ],
    lookup: picked(shortShowListing),
    status: 'matched',
    expected: [
      {season: 2, episode: 9, notes: []},
      {season: 2, episode: 10, title: undefined, notes: ['notListed']},
    ],
  },
  {
    label: 'a picked show leaves files with another year alone',
    files: [
      '/tv/Doctor.Who.2005.S01E01.720p.HDTV.x264-GRP.mkv',
      '/tv/Doctor.Who.2023.S01E02.720p.HDTV.x264-GRP.mkv',
    ],
    lookup: picked(doctorWho2023Listing),
    status: 'matched',
    expected: [
      {name: undefined, title: undefined, notes: ['yearDiffers']},
      {name: 'Doctor Who', title: "The Devil's Chord", notes: []},
    ],
  },
  {
    label: 'an episode outside its season is not listed',
    files: ['/tv/Smallville.S01E30.720p.HDTV.x264-GRP.mkv'],
    lookup: picked(smallvilleListing),
    status: 'matched',
    expected: [
      {name: 'Smallville', season: 1, title: undefined, notes: ['notListed']},
    ],
  },
  {
    label: 'an air date one day out matches when only one episode is near',
    files: ['/tv/A.Late.Talk.Show.2026.11.03.720p.WEB.h264-GRP.mkv'],
    lookup: picked(lateShowListing),
    status: 'matched',
    expected: [{title: 'First Guest', notes: ['nearbyDate']}],
  },
  {
    label: 'two episodes on one date give no title',
    files: ['/tv/A.Late.Talk.Show.2026.11.06.720p.WEB.h264-GRP.mkv'],
    lookup: picked(lateShowListing),
    status: 'matched',
    expected: [{title: undefined, notes: ['sharedDate']}],
  },
  {
    label: 'numbered episodes keep their number past the first season',
    files: ['/anime/[SubsPlease] Frieren - 29 (1080p) [A1B2C3D4].mkv'],
    lookup: picked(frierenListing),
    status: 'matched',
    expected: [
      {
        name: "Frieren: Beyond Journey's End",
        episode: 29,
        title: 'The Second Journey',
        notes: ['numbersDiffer'],
      },
    ],
  },
  {
    label: 'numbered episodes in the first season need no note',
    files: ['/anime/[SubsPlease] Frieren - 05 (1080p) [A1B2C3D4].mkv'],
    lookup: picked(frierenListing),
    status: 'matched',
    expected: [{title: 'Phantoms of the Dead', notes: []}],
  },
  {
    label: 'a numbered episode in a different season folder gets no title',
    files: ['/anime/Frieren/Season 2/[SubsPlease] Frieren - 01 (1080p).mkv'],
    lookup: picked(frierenListing),
    status: 'matched',
    expected: [{title: undefined, notes: ['seasonFolderDiffers']}],
  },
  {
    label: 'two parts of one story share a title',
    files: ['/tv/Doctor.Who.2005.S01E09E10.720p.HDTV.x264-GRP.mkv'],
    lookup: picked(doctorWho2005Listing),
    status: 'matched',
    expected: [{title: 'The Empty Child'}],
  },
  {
    label: 'two different episodes join their titles',
    files: ['/tv/Smallville.S01E01E02.720p.HDTV.x264-GRP.mkv'],
    lookup: picked(smallvilleListing),
    status: 'matched',
    expected: [{title: 'Pilot & Metamorphosis'}],
  },
  {
    label: 'a placeholder title leaves the title to the file',
    files: ['/tv/Smallville.S01E03.Hothead.720p.HDTV.x264-GRP.mkv'],
    lookup: picked(smallvilleListing),
    status: 'matched',
    expected: [{name: 'Smallville', title: undefined, notes: []}],
  },
];

function scanned(path: string): ScannedFile {
  const parts = path.split('/');
  const name = parts.at(-1) ?? path;
  const dot = name.lastIndexOf('.');
  return {
    path,
    directory: parts.slice(0, -1).join('/'),
    name,
    stem: name.slice(0, dot),
    extension: name.slice(dot),
    folderName: parts.at(-2) ?? '',
    parentFolderName: parts.at(-3) ?? null,
    size: 1,
    modifiedMs: 0,
    createdMs: null,
    volumeId: 'uuid:TEST',
    access: 'writable',
  };
}

function described(lookup: FileLookup | undefined): ExpectedFile {
  if (lookup?.kind !== 'resolved') throw new Error('Expected a resolved file');
  const {tags, notes} = lookup;
  return {
    name: textOf(tags.Name),
    season: numberOf(tags.Season),
    episode: numberOf(tags.Episode),
    title: textOf(tags['Episode Title']),
    notes: notes.map(note => note.kind),
  };
}

function textOf(value: TagValue | undefined): string | undefined {
  return value?.kind === 'text' ? value.text : undefined;
}

function numberOf(value: TagValue | undefined): number | undefined {
  return value?.kind === 'number' ? value.value : undefined;
}

function check({
  files: paths,
  lookup,
  status,
  suggested,
  expected,
}: LookupCase) {
  const files = paths.map(scanned);
  const parsedNames = new Map(
    files.map(file => [file.path, parseFileName(file)])
  );
  const groups = lookupGroups(files, parsedNames);
  expect(groups).toHaveLength(1);
  const groupKey = groups[0]?.key ?? '';

  const lookups = deriveLookups(
    files,
    parsedNames,
    new Map([[groupKey, lookup]]),
    true
  );
  const [view] = lookups.groups;
  expect(view?.status.kind).toBe(status);
  if (suggested !== undefined && view?.status.kind === 'unsure')
    expect(view.status.suggested?.id ?? null).toBe(suggested);
  expected?.forEach((file, index) => {
    const path = paths[index] ?? '';
    expect(described(lookups.files.get(path))).toMatchObject(file);
  });
}

describe('TVmaze matching', () => {
  for (const lookupCase of lookupCases)
    it(lookupCase.label, () => check(lookupCase));
});
