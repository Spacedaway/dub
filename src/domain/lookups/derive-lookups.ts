import {
  groupStatus,
  type GroupStatus,
  type ShowLookup,
} from '@/domain/lookups/group-status';
import {
  lookupGroups,
  type GroupMember,
  type LookupGroup,
} from '@/domain/lookups/lookup-groups';
import {
  matchGroupEpisodes,
  type EpisodeMatch,
  type LookupNote,
} from '@/domain/lookups/match-episodes';
import {premiereYear} from '@/domain/lookups/tvmaze';
import type {ParsedName} from '@/domain/parsing/parsed-name';
import {parsedTagValues} from '@/domain/tags/file-tags';
import type {TagName, TagValues} from '@/domain/tags/tags';
import type {ScannedFile} from '@/ipc/contracts';

export type FileLookup =
  | {kind: 'pending'}
  | {kind: 'resolved'; tags: TagValues; notes: Array<LookupNote>};

export type GroupView = {group: LookupGroup; status: GroupStatus};

export type Lookups = {
  groups: Array<GroupView>;
  files: ReadonlyMap<string, FileLookup>;
  pendingCount: number;
};

export const noLookups: Lookups = {
  groups: [],
  files: new Map(),
  pendingCount: 0,
};

const lookupTags = [
  'Name',
  'Year',
  'Season',
  'Episode',
  'Episode Title',
] as const satisfies Array<TagName>;

export function deriveLookups(
  files: Array<ScannedFile>,
  parsedNames: ReadonlyMap<string, ParsedName | null>,
  showLookups: ReadonlyMap<string, ShowLookup>,
  enabled: boolean | null
): Lookups {
  if (enabled === false) return noLookups;

  const groups = lookupGroups(files, parsedNames).map(group => ({
    group,
    status:
      enabled === null
        ? ({kind: 'pending'} as const)
        : groupStatus(group, showLookups.get(group.key)),
  }));
  const fileLookups = new Map<string, FileLookup>();
  for (const {group, status} of groups) {
    const matches =
      status.kind === 'matched'
        ? matchGroupEpisodes(group.members, status.listing)
        : new Map<string, EpisodeMatch>();
    for (const member of group.members) {
      const lookup = fileLookup(
        group,
        member,
        status,
        matches.get(member.path)
      );
      fileLookups.set(member.path, lookup);
    }
  }
  return {
    groups,
    files: fileLookups,
    pendingCount: groups.filter(({status}) => status.kind === 'pending').length,
  };
}

function fileLookup(
  group: LookupGroup,
  member: GroupMember,
  status: GroupStatus,
  match: EpisodeMatch | undefined
): FileLookup {
  switch (status.kind) {
    case 'pending':
      return {kind: 'pending'};
    case 'matched':
      return match === undefined
        ? {kind: 'pending'}
        : matchedLookup(group, member, status, match);
    case 'unsure':
      return resolved({kind: 'chooseShow'});
    case 'notFound':
      return resolved({kind: 'notFound'});
    case 'failed':
      return resolved({kind: 'lookupFailed', message: status.message});
    case 'declined':
      return {kind: 'resolved', tags: {}, notes: []};
  }
}

function matchedLookup(
  group: LookupGroup,
  member: GroupMember,
  {listing, namesakes}: Extract<GroupStatus, {kind: 'matched'}>,
  match: EpisodeMatch
): FileLookup {
  const year = premiereYear(listing.show);
  const fileYear = member.parsed.year;
  if (group.years.length > 1 && fileYear !== null && fileYear !== year)
    return resolved({kind: 'yearDiffers', inFile: fileYear, premiered: year});

  const name =
    namesakes && year !== null
      ? `${listing.show.name} (${year})`
      : listing.show.name;
  const values = parsedTagValues({
    ...member.parsed,
    ...match.numbers,
    name,
    year,
    episodeTitle: match.title,
  });
  const tags: TagValues = {};
  for (const tag of lookupTags) {
    const value = values[tag];
    if (value !== undefined) tags[tag] = value;
  }
  return {kind: 'resolved', tags, notes: match.notes};
}

function resolved(note: LookupNote): FileLookup {
  return {kind: 'resolved', tags: {}, notes: [note]};
}
