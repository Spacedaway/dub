import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import type {Plan, PlanRequest, ScannedFile} from '@/ipc/contracts';
import {followPlanning, planningDelayMs} from '@/store/live-plan';
import {useSession} from '@/store/session-store';

type PendingPlan = {request: PlanRequest; resolve: (plan: Plan) => void};

const pendingPlans = vi.hoisted((): Array<PendingPlan> => []);

vi.mock('@/ipc/commands', () => ({
  plan(request: PlanRequest): Promise<Plan> {
    return new Promise(resolve => pendingPlans.push({request, resolve}));
  },
}));

let stopPlanning: () => void;

beforeEach(() => {
  vi.useFakeTimers();
  pendingPlans.length = 0;
  useSession.setState(useSession.getInitialState(), true);
  stopPlanning = followPlanning();
  useSession.getState().setFiles([file('a.mkv')]);
});

afterEach(() => {
  stopPlanning();
  vi.useRealTimers();
});

function file(name: string): ScannedFile {
  const dot = name.lastIndexOf('.');
  return {
    path: `/media/${name}`,
    directory: '/media',
    name,
    stem: name.slice(0, dot),
    extension: name.slice(dot),
    folderName: 'media',
    parentFolderName: null,
    size: 1,
    modifiedMs: 0,
    createdMs: null,
    volumeId: 'uuid:TEST',
    access: 'writable',
  };
}

function targetNames(request: PlanRequest): string {
  return request.renames.map(rename => rename.target.name).join();
}

async function editTemplate(source: string): Promise<void> {
  useSession.getState().setTemplateSource(source);
  await vi.advanceTimersByTimeAsync(planningDelayMs);
}

async function answer(index: number): Promise<void> {
  const pending = pendingPlans[index];
  if (pending === undefined) throw new Error(`No plan request ${index}`);
  pending.resolve({
    planId: targetNames(pending.request),
    revision: pending.request.revision,
    rows: [],
    steps: [],
  });
  await vi.advanceTimersByTimeAsync(0);
}

function plannedTargets(): string | undefined {
  const result = useSession.getState().planResult;
  return result?.plan.kind === 'planned' ? result.plan.plan.planId : undefined;
}

describe('followPlanning', () => {
  it('plans the suggested names while the template is empty', async () => {
    useSession.getState().setFiles([file('Show.S01E01.mkv')]);
    await vi.advanceTimersByTimeAsync(planningDelayMs);

    expect(pendingPlans.map(({request}) => targetNames(request))).toEqual([
      'Show - S01E01.mkv',
    ]);
  });

  it('plans the looked-up names once a show is matched', async () => {
    useSession.getState().setLookupsEnabled(true);
    useSession.getState().setFiles([file('Show.S01E01.mkv')]);
    await vi.advanceTimersByTimeAsync(planningDelayMs);
    const [view] = useSession.getState().lookups.groups;
    if (view === undefined) throw new Error('Expected one show');

    useSession.getState().setShowLookup(view.group.key, {
      kind: 'chosen',
      listing: {
        show: {
          id: 1,
          name: 'The Show',
          premiered: '2020-01-01',
          status: null,
          network: null,
          country: null,
        },
        episodes: [{season: 1, number: 1, title: 'Pilot', airDate: null}],
        fetchedAt: 0,
      },
      namesakes: false,
      how: 'picked',
    });
    await vi.advanceTimersByTimeAsync(planningDelayMs);

    expect(pendingPlans.map(({request}) => targetNames(request))).toEqual([
      'Show - S01E01.mkv',
      'The Show - S01E01 - Pilot.mkv',
    ]);
  });

  it('plans companions with their video so the planner can block them together', async () => {
    useSession.getState().setFiles([file('a.mkv'), file('a.en.forced.srt')]);
    await editTemplate('b');

    expect(pendingPlans.at(-1)?.request.renames).toEqual([
      {
        rowId: '/media/a.mkv',
        source: '/media/a.mkv',
        target: {kind: 'sameFolder', name: 'b.mkv'},
        companionOf: null,
      },
      {
        rowId: '/media/a.en.forced.srt',
        source: '/media/a.en.forced.srt',
        target: {kind: 'sameFolder', name: 'b.en.forced.srt'},
        companionOf: '/media/a.mkv',
      },
    ]);
  });

  it('plans once the names stop changing', async () => {
    useSession.getState().setTemplateSource('one');
    await vi.advanceTimersByTimeAsync(planningDelayMs - 1);
    await editTemplate('two');

    expect(pendingPlans.map(({request}) => targetNames(request))).toEqual([
      'two.mkv',
    ]);
  });

  it('keeps the newest plan when an older one finishes last', async () => {
    await editTemplate('one');
    await editTemplate('two');
    await answer(1);
    await answer(0);

    expect(plannedTargets()).toBe('two.mkv');
  });

  it('ignores a stale plan after the names change back', async () => {
    await editTemplate('one');
    await answer(0);
    await editTemplate('two');
    await editTemplate('one');
    await answer(1);

    expect(pendingPlans).toHaveLength(2);
    expect(plannedTargets()).toBe('one.mkv');
  });

  it('plans the same names again after the disk changes', async () => {
    await editTemplate('one');
    await answer(0);
    useSession.getState().markDiskChanged();
    await vi.advanceTimersByTimeAsync(planningDelayMs);

    expect(pendingPlans.map(({request}) => targetNames(request))).toEqual([
      'one.mkv',
      'one.mkv',
    ]);
  });
});
