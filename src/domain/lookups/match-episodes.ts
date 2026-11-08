import type {GroupMember} from '@/domain/lookups/lookup-groups';
import type {ShowListing, TvEpisode} from '@/domain/lookups/tvmaze';
import type {ParsedName} from '@/domain/parsing/parsed-name';

export type LookupNote =
  | {kind: 'numbersDiffer'; inFile: string; onTvmaze: string}
  | {kind: 'notListed'; episode: string}
  | {kind: 'nearbyDate'; airDate: string}
  | {kind: 'sharedDate'; airDate: string}
  | {kind: 'unnumberedSpecial'}
  | {kind: 'seasonFolderDiffers'; folderSeason: number; onTvmaze: string}
  | {kind: 'yearDiffers'; inFile: number; premiered: number | null}
  | {kind: 'chooseShow'}
  | {kind: 'notFound'}
  | {kind: 'lookupFailed'; message: string};

export type EpisodeMatch = {
  title: string | null;
  exact: boolean;
  missing: boolean;
  numbers: {season: number; episodes: Array<number>} | null;
  notes: Array<LookupNote>;
};

type MatchDetails = Partial<
  Pick<EpisodeMatch, 'exact' | 'missing' | 'numbers'>
>;

const partSuffix =
  /\s*(?:\(\d+\)|,?\s+Part\s+(?:\d+|One|Two|Three|Four|I{1,3}|IV))$/i;

const dayMs = 24 * 60 * 60 * 1000;

export function matchGroupEpisodes(
  members: Array<GroupMember>,
  listing: ShowListing
): ReadonlyMap<string, EpisodeMatch> {
  const strict = members.map(member => ({
    member,
    match: matchEpisodes(member, listing, false),
  }));
  const listedSeasons = new Set(
    strict.flatMap(({member, match}) =>
      member.kind === 'tvEpisode' && match.exact ? [member.parsed.season] : []
    )
  );
  return new Map(
    strict.map(({member, match}) => {
      const mayReadAbsolute =
        member.kind === 'tvEpisode' &&
        !match.exact &&
        !listedSeasons.has(member.parsed.season);
      return [
        member.path,
        mayReadAbsolute ? matchEpisodes(member, listing, true) : match,
      ];
    })
  );
}

function matchEpisodes(
  member: GroupMember,
  listing: ShowListing,
  mayReadAbsolute: boolean
): EpisodeMatch {
  switch (member.kind) {
    case 'tvEpisode':
      return matchSeasonEpisodes(
        member.parsed,
        listing.episodes,
        mayReadAbsolute
      );
    case 'datedEpisode':
      return matchAirDate(member.parsed.airDate ?? '', listing.episodes);
    case 'numberedEpisode':
      return matchAbsoluteEpisodes(member, listing.episodes);
  }
}

export function seasonEpisodeLabel(
  season: number,
  episodes: Array<number>
): string {
  return `S${pad(season)}E${episodes.map(pad).join('-E')}`;
}

function matchSeasonEpisodes(
  parsed: ParsedName,
  episodes: Array<TvEpisode>,
  mayReadAbsolute: boolean
): EpisodeMatch {
  const season = parsed.season ?? 0;
  const numbers = parsed.episodes;
  if (season === 0 || !numbers.every(Number.isInteger))
    return unmatched({kind: 'unnumberedSpecial'});

  const listed = numbers.map(number =>
    episodes.find(
      episode => episode.season === season && episode.number === number
    )
  );
  if (listed.every(isDefined)) return matched(listed, [], {exact: true});

  const inFile = seasonEpisodeLabel(season, numbers);
  const absolute = numbers.map(number => episodes[number - 1]);
  if (
    !mayReadAbsolute ||
    !absolute.every(isDefined) ||
    absolute.some(episode => episode.season !== season)
  )
    return unmatched({kind: 'notListed', episode: inFile});

  const mapped = absolute.map(episode => episode.number);
  const onTvmaze = seasonEpisodeLabel(season, mapped);
  return matched(absolute, [{kind: 'numbersDiffer', inFile, onTvmaze}], {
    missing: true,
    numbers: {season, episodes: mapped},
  });
}

function matchAirDate(
  airDate: string,
  episodes: Array<TvEpisode>
): EpisodeMatch {
  const sameDay = episodes.filter(episode => episode.airDate === airDate);
  if (sameDay.length === 1) return matched(sameDay, [], {exact: true});
  if (sameDay.length > 1) return unmatched({kind: 'sharedDate', airDate});

  const nearby = episodes.filter(
    episode =>
      episode.airDate !== null && daysApart(episode.airDate, airDate) === 1
  );
  const [only] = nearby;
  if (nearby.length === 1 && only?.airDate) {
    return matched(nearby, [{kind: 'nearbyDate', airDate: only.airDate}], {
      missing: true,
    });
  }
  return unmatched({kind: 'notListed', episode: airDate});
}

function matchAbsoluteEpisodes(
  {parsed, folderSeason}: GroupMember,
  episodes: Array<TvEpisode>
): EpisodeMatch {
  const numbers = parsed.episodes;
  if (!numbers.every(Number.isInteger))
    return unmatched({kind: 'unnumberedSpecial'});

  const listed = numbers.map(number => episodes[number - 1]);
  if (!listed.every(isDefined)) {
    return unmatched({
      kind: 'notListed',
      episode: `Episode ${numbers.join('-')}`,
    });
  }

  const onTvmaze = listed
    .map(episode => seasonEpisodeLabel(episode.season, [episode.number]))
    .join(', ');
  if (
    folderSeason !== null &&
    listed.some(episode => episode.season !== folderSeason)
  )
    return unmatched({kind: 'seasonFolderDiffers', folderSeason, onTvmaze});

  const isSameNumbering = listed.every(
    (episode, index) =>
      episode.season === 1 && episode.number === numbers[index]
  );
  const inFile = `Episode ${numbers.join('-')}`;
  return matched(
    listed,
    isSameNumbering ? [] : [{kind: 'numbersDiffer', inFile, onTvmaze}]
  );
}

function matched(
  episodes: Array<TvEpisode>,
  notes: Array<LookupNote>,
  {exact = false, missing = false, numbers = null}: MatchDetails = {}
): EpisodeMatch {
  return {title: joinedTitle(episodes), exact, missing, numbers, notes};
}

function unmatched(note: LookupNote): EpisodeMatch {
  return {
    title: null,
    exact: false,
    missing: note.kind === 'notListed',
    numbers: null,
    notes: [note],
  };
}

function joinedTitle(episodes: Array<TvEpisode>): string | null {
  const titles = episodes.map(episode => episode.title);
  if (!titles.every(isDefined)) return null;
  const [first, ...rest] = titles;
  if (first === undefined || rest.length === 0) return first ?? null;

  const shared = first.replace(partSuffix, '');
  const isOneStory =
    shared !== '' &&
    rest.every(title => title.replace(partSuffix, '') === shared);
  return isOneStory ? shared : titles.join(' & ');
}

function daysApart(left: string, right: string): number {
  return Math.abs(Date.parse(left) - Date.parse(right)) / dayMs;
}

function pad(number: number): string {
  return String(number).padStart(2, '0');
}

function isDefined<Value>(value: Value | null | undefined): value is Value {
  return value !== null && value !== undefined;
}
