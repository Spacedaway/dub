export type TvShow = {
  id: number;
  name: string;
  premiered: string | null;
  status: string | null;
  network: string | null;
  country: string | null;
};

export type TvEpisode = {
  season: number;
  number: number;
  title: string | null;
  airDate: string | null;
};

export type ShowListing = {
  show: TvShow;
  episodes: Array<TvEpisode>;
  fetchedAt: number;
};

type JsonObject = Record<string, unknown>;

const placeholderTitles = /^(?:TBA|TBD|Episode \d+)$/i;

export function readSearchResults(json: unknown): Array<TvShow> {
  if (!Array.isArray(json)) return [];
  return json.flatMap(result => {
    const show = isObject(result) ? readShow(result.show) : null;
    return show === null ? [] : [show];
  });
}

export function readShowListing(
  json: unknown,
  fetchedAt: number
): ShowListing | null {
  const show = readShow(json);
  if (show === null || !isObject(json)) return null;
  const embedded = isObject(json._embedded) ? json._embedded : {};
  const episodes = Array.isArray(embedded.episodes)
    ? embedded.episodes.flatMap(episode => {
        const read = readEpisode(episode);
        return read === null ? [] : [read];
      })
    : [];
  episodes.sort(
    (left, right) => left.season - right.season || left.number - right.number
  );
  return {show, episodes, fetchedAt};
}

export function listingJson({show, episodes}: ShowListing): JsonObject {
  return {
    id: show.id,
    name: show.name,
    premiered: show.premiered,
    status: show.status,
    network: {name: show.network, country: {code: show.country}},
    _embedded: {
      episodes: episodes.map(episode => ({
        season: episode.season,
        number: episode.number,
        name: episode.title,
        airdate: episode.airDate,
      })),
    },
  };
}

export function premiereYear(show: TvShow): number | null {
  const year = Number(show.premiered?.slice(0, 4));
  return Number.isInteger(year) && year > 0 ? year : null;
}

function readShow(json: unknown): TvShow | null {
  if (!isObject(json)) return null;
  const {id, name} = json;
  if (typeof id !== 'number' || typeof name !== 'string') return null;
  const channel = isObject(json.network)
    ? json.network
    : isObject(json.webChannel)
      ? json.webChannel
      : {};
  const country = isObject(channel.country) ? channel.country : {};
  return {
    id,
    name,
    premiered: isoDate(json.premiered),
    status: text(json.status),
    network: text(channel.name),
    country: text(country.code),
  };
}

function readEpisode(json: unknown): TvEpisode | null {
  if (!isObject(json)) return null;
  const {season, number} = json;
  if (!isWholeNumber(season) || !isWholeNumber(number)) return null;
  if (json.type !== undefined && json.type !== 'regular') return null;
  const title = text(json.name);
  return {
    season,
    number,
    title: title === null || placeholderTitles.test(title) ? null : title,
    airDate: isoDate(json.airdate),
  };
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWholeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function isoDate(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : null;
}
