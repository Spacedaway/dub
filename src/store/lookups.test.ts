import {afterEach, expect, it, vi} from 'vitest';

import type {ScannedFile} from '@/ipc/contracts';
import {chooseShow, followLookups} from '@/store/lookups';
import {useSession} from '@/store/session-store';

type PendingRequest = {
  target: string;
  resolve: (json: unknown) => void;
};

const pendingRequests = vi.hoisted((): Array<PendingRequest> => []);

vi.mock('@/ipc/tvmaze', () => ({
  searchShows(query: string): Promise<unknown> {
    return new Promise(resolve =>
      pendingRequests.push({target: `search ${query}`, resolve})
    );
  },
  requestShow(showId: number): Promise<unknown> {
    return new Promise(resolve =>
      pendingRequests.push({target: `show ${showId}`, resolve})
    );
  },
}));

vi.mock('@/ipc/cache-db', () => ({
  readCachedShow: () => Promise.resolve(null),
  writeCachedShow: () => Promise.resolve(),
  readRememberedShow: () => Promise.resolve(null),
  rememberShow: () => Promise.resolve(),
}));

let stopLookups: (() => void) | undefined;

afterEach(() => {
  stopLookups?.();
  pendingRequests.length = 0;
  useSession.setState(useSession.getInitialState(), true);
});

function file(path: string): ScannedFile {
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

function showJson(id: number, premiered: string): unknown {
  return {
    id,
    name: 'Doctor Who',
    premiered,
    _embedded: {
      episodes: [{season: 1, number: 1, type: 'regular', name: `Pilot ${id}`}],
    },
  };
}

async function answer(target: string, json: unknown): Promise<void> {
  await settle();
  const request = pendingRequests.find(pending => pending.target === target);
  if (request === undefined) throw new Error(`No request for ${target}`);
  request.resolve(json);
  await settle();
}

function settle(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

it('keeps a chosen show when the automatic search answers late', async () => {
  useSession.getState().setLookupsEnabled(true);
  useSession
    .getState()
    .setFiles([file('/tv/Doctor.Who.2005.S01E01.720p.HDTV.x264-GRP.mkv')]);
  stopLookups = followLookups();
  const [view] = useSession.getState().lookups.groups;
  if (view === undefined) throw new Error('Expected one show');
  await settle();
  expect(pendingRequests.map(({target}) => target)).toEqual([
    'search Doctor Who',
  ]);

  const doctorWho1963 = {
    id: 766,
    name: 'Doctor Who',
    premiered: '1963-11-23',
    status: null,
    network: null,
    country: null,
  };
  const choice = chooseShow(view.group, doctorWho1963, []);
  await answer('show 766', showJson(766, '1963-11-23'));
  await choice;
  await answer('search Doctor Who', [
    {score: 1, show: showJson(210, '2005-03-26')},
  ]);
  await answer('show 210', showJson(210, '2005-03-26'));

  const [settled] = useSession.getState().lookups.groups;
  expect(settled?.status).toMatchObject({
    kind: 'matched',
    how: 'picked',
    listing: {show: {id: 766}},
  });
});
