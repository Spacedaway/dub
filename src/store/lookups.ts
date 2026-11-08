import {toast} from 'sonner';

import {folderKey} from '@/domain/lookups/folder-key';
import {
  automaticCandidate,
  hasNamesakes,
  type GroupStatus,
  type ShowLookup,
} from '@/domain/lookups/group-status';
import type {LookupGroup} from '@/domain/lookups/lookup-groups';
import {matchGroupEpisodes} from '@/domain/lookups/match-episodes';
import {
  listingJson,
  readSearchResults,
  readShowListing,
  type ShowListing,
  type TvShow,
} from '@/domain/lookups/tvmaze';
import {comparableName} from '@/domain/text/comparable-name';
import * as cache from '@/ipc/cache-db';
import {errorMessage} from '@/ipc/command-error';
import * as tvmaze from '@/ipc/tvmaze';
import {useSession} from '@/store/session-store';

type StillWanted = () => boolean;

const listingMaxAgeMs = 7 * 24 * 60 * 60 * 1000;
const missingEpisodeMaxAgeMs = 60 * 60 * 1000;

const lookupsSetting = 'lookupsEnabled';

const latestRevisions = new Map<string, number>();
const running = new Map<string, number>();
const refreshedShows = new Set<number>();

export function followLookups(): () => void {
  startWaitingLookups();
  return useSession.subscribe((state, previous) => {
    if (state.lookups === previous.lookups) return;
    startWaitingLookups();
  });
}

export function chooseShow(
  group: LookupGroup,
  show: TvShow,
  candidates: Array<TvShow>
): Promise<void> {
  const namesakes = knownNamesakes(group, show, candidates);
  return runLookup(group.key, async stillWanted => {
    useSession.getState().setShowLookup(group.key, null);
    const listing = await showListing(show.id, stillWanted);
    if (listing === null)
      throw new Error(`TVmaze no longer lists ${show.name}.`);
    await remember(group, {showId: show.id, namesakes}, show);
    return {kind: 'chosen', listing, namesakes, how: 'picked'};
  });
}

export function declineShow(group: LookupGroup): Promise<void> {
  const previous = matchedShow(currentStatus(group));
  return runLookup(group.key, async () => {
    await remember(group, {showId: null, namesakes: false}, null);
    if (previous !== null) await forget(group, comparableName(previous.name));
    return {kind: 'declined'};
  });
}

export async function lookUpAgain(group: LookupGroup): Promise<void> {
  await forget(group, group.nameKey);
  return retryLookup(group);
}

export async function rememberAppliedShows(
  renamedPaths: Array<string>
): Promise<void> {
  const renamed = new Set(renamedPaths);
  const automatic = useSession
    .getState()
    .lookups.groups.flatMap(({group, status}) =>
      status.kind === 'matched' &&
      status.how === 'automatic' &&
      group.members.some(member => renamed.has(member.path))
        ? [{group, show: status.listing.show, namesakes: status.namesakes}]
        : []
    );
  await Promise.all(
    automatic.map(({group, show, namesakes}) =>
      remember(group, {showId: show.id, namesakes}, show)
    )
  );
}

export function retryLookup(group: LookupGroup): Promise<void> {
  tvmaze.forgetNetworkFailure();
  return runLookup(group.key, stillWanted => {
    useSession.getState().setShowLookup(group.key, null);
    return lookUp(group, stillWanted);
  });
}

export async function searchShows(query: string): Promise<Array<TvShow>> {
  tvmaze.forgetNetworkFailure();
  return readSearchResults(await tvmaze.searchShows(query, () => true));
}

export async function loadLookupsSetting(): Promise<void> {
  let enabled = true;
  try {
    enabled = (await cache.readSetting(lookupsSetting)) !== 'false';
  } catch (error) {
    console.warn("Couldn't read the lookups setting", error);
  }
  if (useSession.getState().lookupsEnabled === null)
    useSession.getState().setLookupsEnabled(enabled);
}

export async function switchLookups(enabled: boolean): Promise<void> {
  useSession.getState().setLookupsEnabled(enabled);
  try {
    await cache.writeSetting(lookupsSetting, String(enabled));
  } catch (error) {
    toast.warning(
      `Couldn't save the lookups setting, so it resets when Dub restarts: ${errorMessage(error)}`
    );
  }
}

function startWaitingLookups(): void {
  const {lookups, showLookups, lookupsEnabled} = useSession.getState();
  if (lookupsEnabled !== true) return;
  for (const {group, status} of lookups.groups) {
    if (running.has(group.key)) continue;
    if (status.kind === 'pending') {
      void runLookup(group.key, stillWanted => lookUp(group, stillWanted));
      continue;
    }
    const lookup = showLookups.get(group.key);
    const listing = lookup === undefined ? null : listingOf(lookup);
    if (
      lookup !== undefined &&
      listing !== null &&
      needsRefresh(group, listing)
    )
      void refresh(group, lookup, listing);
  }
}

async function lookUp(
  group: LookupGroup,
  stillWanted: StillWanted
): Promise<ShowLookup> {
  const remembered = await rememberedShow(group);
  if (remembered?.showId === null) return {kind: 'declined'};
  if (remembered !== null) {
    const listing = await showListing(remembered.showId, stillWanted);
    if (listing !== null) {
      return {
        kind: 'chosen',
        listing,
        namesakes: remembered.namesakes,
        how: 'remembered',
      };
    }
    await forget(group, group.nameKey);
  }

  const candidates = readSearchResults(
    await tvmaze.searchShows(group.query, stillWanted)
  );
  const candidate = automaticCandidate(group, candidates);
  const listing =
    candidate === null ? null : await showListing(candidate.id, stillWanted);
  return {kind: 'searched', candidates, listing};
}

function refresh(
  group: LookupGroup,
  lookup: ShowLookup,
  {show}: ShowListing
): Promise<void> {
  refreshedShows.add(show.id);
  return runLookup(group.key, async stillWanted => {
    const listing = await showListing(
      show.id,
      stillWanted,
      missingEpisodeMaxAgeMs
    );
    return listing === null ? null : withListing(lookup, listing);
  });
}

function needsRefresh(group: LookupGroup, listing: ShowListing): boolean {
  if (refreshedShows.has(listing.show.id)) return false;
  if (Date.now() - listing.fetchedAt < missingEpisodeMaxAgeMs) return false;
  const matches = matchGroupEpisodes(group.members, listing);
  return [...matches.values()].some(match => match.missing);
}

async function runLookup(
  groupKey: string,
  work: (stillWanted: StillWanted) => Promise<ShowLookup | null>
): Promise<void> {
  const revision = (latestRevisions.get(groupKey) ?? 0) + 1;
  latestRevisions.set(groupKey, revision);
  running.set(groupKey, revision);
  function stillWanted(): boolean {
    return (
      latestRevisions.get(groupKey) === revision &&
      useSession
        .getState()
        .lookups.groups.some(({group}) => group.key === groupKey)
    );
  }

  try {
    const lookup = await work(stillWanted);
    if (lookup !== null && stillWanted())
      useSession.getState().setShowLookup(groupKey, lookup);
  } catch (error) {
    if (stillWanted()) {
      useSession.getState().setShowLookup(groupKey, {
        kind: 'failed',
        message: errorMessage(error),
      });
    }
  } finally {
    if (running.get(groupKey) === revision) running.delete(groupKey);
  }
}

async function showListing(
  showId: number,
  stillWanted: StillWanted,
  maxAgeMs = listingMaxAgeMs
): Promise<ShowListing | null> {
  const cached = await cachedListing(showId);
  if (cached !== null && Date.now() - cached.fetchedAt < maxAgeMs)
    return cached;

  let json: unknown;
  try {
    json = await tvmaze.requestShow(showId, stillWanted);
  } catch (error) {
    if (cached !== null) return cached;
    throw error;
  }
  if (json === null) return null;
  const listing = readShowListing(json, Date.now());
  if (listing === null) return cached;
  void storeListing(listing);
  return listing;
}

async function cachedListing(showId: number): Promise<ShowListing | null> {
  try {
    const cached = await cache.readCachedShow(showId);
    return cached === null
      ? null
      : readShowListing(JSON.parse(cached.body), cached.fetchedAt);
  } catch (error) {
    console.warn(`Couldn't read show ${showId} from the cache`, error);
    return null;
  }
}

async function storeListing(listing: ShowListing): Promise<void> {
  try {
    await cache.writeCachedShow(listing.show.id, {
      body: JSON.stringify(listingJson(listing)),
      fetchedAt: listing.fetchedAt,
    });
  } catch (error) {
    console.warn(`Couldn't cache show ${listing.show.id}`, error);
  }
}

async function rememberedShow(
  group: LookupGroup
): Promise<cache.RememberedShow | null> {
  try {
    return await cache.readRememberedShow(parsedNameKey(group));
  } catch (error) {
    console.warn(`Couldn't read the choice for ${group.query}`, error);
    return null;
  }
}

async function remember(
  group: LookupGroup,
  choice: cache.RememberedShow,
  alsoNamed: TvShow | null
): Promise<void> {
  const parsed = parsedNameKey(group);
  const nameKeys = new Set([parsed.nameKey]);
  if (alsoNamed !== null) nameKeys.add(comparableName(alsoNamed.name));
  try {
    for (const nameKey of nameKeys)
      await cache.rememberShow({...parsed, nameKey}, choice);
  } catch (error) {
    toast.warning(
      `Couldn't save the choice for ${group.query}: ${errorMessage(error)}`
    );
  }
}

async function forget(group: LookupGroup, nameKey: string): Promise<void> {
  try {
    await cache.forgetShow({...parsedNameKey(group), nameKey});
  } catch (error) {
    console.warn(`Couldn't forget the choice for ${group.query}`, error);
  }
}

function knownNamesakes(
  group: LookupGroup,
  show: TvShow,
  candidates: Array<TvShow>
): boolean {
  const lookup = useSession.getState().showLookups.get(group.key);
  if (
    lookup?.kind === 'chosen' &&
    lookup.listing.show.id === show.id &&
    lookup.namesakes
  )
    return true;
  const searched = lookup?.kind === 'searched' ? lookup.candidates : [];
  const shows = new Map(
    [...candidates, ...searched].map(candidate => [candidate.id, candidate])
  );
  return hasNamesakes(show, [...shows.values()]);
}

function parsedNameKey(group: LookupGroup): cache.FolderShowKey {
  const volume = useSession.getState().volumes.get(group.volumeId);
  return {...folderKey(group.showFolder, volume), nameKey: group.nameKey};
}

function currentStatus(group: LookupGroup): GroupStatus | undefined {
  return useSession
    .getState()
    .lookups.groups.find(view => view.group.key === group.key)?.status;
}

function matchedShow(status: GroupStatus | undefined): TvShow | null {
  return status?.kind === 'matched' ? status.listing.show : null;
}

function listingOf(lookup: ShowLookup): ShowListing | null {
  switch (lookup.kind) {
    case 'searched':
    case 'chosen':
      return lookup.listing;
    case 'declined':
    case 'failed':
      return null;
  }
}

function withListing(lookup: ShowLookup, listing: ShowListing): ShowLookup {
  switch (lookup.kind) {
    case 'searched':
    case 'chosen':
      return {...lookup, listing};
    case 'declined':
    case 'failed':
      return lookup;
  }
}
