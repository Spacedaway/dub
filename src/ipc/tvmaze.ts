import {getVersion} from '@tauri-apps/api/app';
import {fetch} from '@tauri-apps/plugin-http';

export type StillWanted = () => boolean;

const baseUrl = 'https://api.tvmaze.com';
const rateWindowMs = 10_000;
const requestsPerWindow = 20;
const timeoutMs = 15_000;
const offlinePauseMs = 30_000;
const maximumAttempts = 3;
const defaultRetryMs = 5_000;

const sentAt: Array<number> = [];
let queue: Promise<unknown> = Promise.resolve();
let offlineUntil = 0;
let userAgent: Promise<string> | undefined;

export function searchShows(
  query: string,
  stillWanted: StillWanted
): Promise<unknown> {
  return requestJson(
    `/search/shows?q=${encodeURIComponent(query)}`,
    stillWanted
  );
}

export function requestShow(
  showId: number,
  stillWanted: StillWanted
): Promise<unknown> {
  return requestJson(`/shows/${showId}?embed[]=episodes`, stillWanted);
}

export function forgetNetworkFailure(): void {
  offlineUntil = 0;
}

function requestJson(path: string, stillWanted: StillWanted): Promise<unknown> {
  const request = queue.then(() => send(path, stillWanted));
  queue = request.catch(() => undefined);
  return request;
}

async function send(path: string, stillWanted: StillWanted): Promise<unknown> {
  for (let attempt = 1; ; attempt++) {
    if (!stillWanted()) throw new Error('The lookup is no longer needed.');
    if (Date.now() < offlineUntil)
      throw new Error("TVmaze couldn't be reached a moment ago.");
    await waitForRateLimit();

    let response: Response;
    try {
      response = await fetch(baseUrl + path, {
        headers: {'User-Agent': await agent()},
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      offlineUntil = Date.now() + offlinePauseMs;
      throw error;
    }
    if (response.ok) return response.json();
    void response.body?.cancel();
    if (response.status === 404) return null;
    if (response.status === 429 && attempt < maximumAttempts) {
      await sleep(retryDelayMs(response));
      continue;
    }
    throw new Error(`TVmaze answered ${response.status}.`);
  }
}

async function waitForRateLimit(): Promise<void> {
  const now = Date.now();
  while (sentAt.length > 0 && now - (sentAt[0] ?? 0) >= rateWindowMs)
    sentAt.shift();
  const oldest = sentAt[0];
  if (sentAt.length >= requestsPerWindow && oldest !== undefined)
    await sleep(rateWindowMs - (now - oldest));
  sentAt.push(Date.now());
}

function retryDelayMs(response: Response): number {
  const seconds = Number(response.headers.get('Retry-After'));
  return Number.isFinite(seconds) && seconds > 0
    ? seconds * 1000
    : defaultRetryMs;
}

function agent(): Promise<string> {
  userAgent ??= getVersion().then(
    version => `Dub/${version}`,
    () => 'Dub'
  );
  return userAgent;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}
