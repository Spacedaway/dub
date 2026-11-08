import type {GroupMember, LookupGroup} from '@/domain/lookups/lookup-groups';
import {matchGroupEpisodes} from '@/domain/lookups/match-episodes';
import {
  premiereYear,
  type ShowListing,
  type TvShow,
} from '@/domain/lookups/tvmaze';
import {comparableName} from '@/domain/text/comparable-name';

export type ShowLookup =
  | {kind: 'searched'; candidates: Array<TvShow>; listing: ShowListing | null}
  | {
      kind: 'chosen';
      listing: ShowListing;
      namesakes: boolean;
      how: 'picked' | 'remembered';
    }
  | {kind: 'declined'}
  | {kind: 'failed'; message: string};

export type GroupStatus =
  | {kind: 'pending'}
  | {
      kind: 'matched';
      listing: ShowListing;
      namesakes: boolean;
      how: 'automatic' | 'picked' | 'remembered';
    }
  | {kind: 'unsure'; candidates: Array<TvShow>; suggested: TvShow | null}
  | {kind: 'notFound'}
  | {kind: 'declined'}
  | {kind: 'failed'; message: string};

export function automaticCandidate(
  group: LookupGroup,
  candidates: Array<TvShow>
): TvShow | null {
  if (!group.automaticAllowed) return null;
  const namesakesNeedYears =
    sameNamed(group.nameKey, candidates).length > 1 &&
    group.members.some(member => member.parsed.year === null);
  return namesakesNeedYears ? null : soleExactCandidate(group, candidates);
}

export function hasNamesakes(show: TvShow, candidates: Array<TvShow>): boolean {
  return sameNamed(comparableName(show.name), candidates).length > 1;
}

export function groupStatus(
  group: LookupGroup,
  lookup: ShowLookup | undefined
): GroupStatus {
  if (lookup === undefined) return {kind: 'pending'};
  switch (lookup.kind) {
    case 'declined':
      return {kind: 'declined'};
    case 'failed':
      return {kind: 'failed', message: lookup.message};
    case 'chosen':
      return chosenStatus(group, lookup);
    case 'searched':
      return searchedStatus(group, lookup.candidates, lookup.listing);
  }
}

function searchedStatus(
  group: LookupGroup,
  candidates: Array<TvShow>,
  listing: ShowListing | null
): GroupStatus {
  if (candidates.length === 0) return {kind: 'notFound'};
  const candidate = automaticCandidate(group, candidates);
  if (
    candidate !== null &&
    listing?.show.id === candidate.id &&
    passesGate(group, listing)
  ) {
    return {
      kind: 'matched',
      listing,
      namesakes: hasNamesakes(candidate, candidates),
      how: 'automatic',
    };
  }
  return {
    kind: 'unsure',
    candidates,
    suggested: soleExactCandidate(group, candidates),
  };
}

function chosenStatus(
  group: LookupGroup,
  lookup: Extract<ShowLookup, {kind: 'chosen'}>
): GroupStatus {
  const {show} = lookup.listing;
  const year = premiereYear(show);
  const yearConflicts =
    lookup.how === 'remembered' && group.years.some(parsed => parsed !== year);
  if (yearConflicts)
    return {kind: 'unsure', candidates: [show], suggested: show};
  return {
    kind: 'matched',
    listing: lookup.listing,
    namesakes: lookup.namesakes,
    how: lookup.how,
  };
}

function soleExactCandidate(
  group: LookupGroup,
  candidates: Array<TvShow>
): TvShow | null {
  if (group.years.length > 1) return null;
  const [year] = group.years;
  const exact = sameNamed(group.nameKey, candidates).filter(
    show => year === undefined || premiereYear(show) === year
  );
  return exact.length === 1 ? (exact[0] ?? null) : null;
}

function sameNamed(nameKey: string, candidates: Array<TvShow>): Array<TvShow> {
  return candidates.filter(
    show => show.premiered !== null && comparableName(show.name) === nameKey
  );
}

function passesGate(group: LookupGroup, listing: ShowListing): boolean {
  const matches = matchGroupEpisodes(group.members, listing);
  const results = group.members.flatMap(member => {
    const match = matches.get(member.path);
    return match === undefined ? [] : [{member, match}];
  });
  const counted = results.filter(({member}) => countsForGate(member));
  const exactCount = counted.filter(({match}) => match.exact).length;
  if (exactCount === 0 || exactCount < counted.length) return false;

  const titled = results.flatMap(({member, match}) =>
    member.parsed.episodeTitle !== null && match.title !== null
      ? [{parsed: member.parsed.episodeTitle, listed: match.title}]
      : []
  );
  return (
    titled.length === 0 ||
    titled.some(
      ({parsed, listed}) => comparableName(parsed) === comparableName(listed)
    )
  );
}

function countsForGate({kind, parsed}: GroupMember): boolean {
  if (kind === 'datedEpisode') return true;
  return (
    kind === 'tvEpisode' &&
    (parsed.season ?? 0) > 0 &&
    parsed.episodes.every(Number.isInteger)
  );
}
