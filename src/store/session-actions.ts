import {toast} from 'sonner';

import {companionsOf} from '@/domain/files/companions';
import {isVideoExtension} from '@/domain/parsing/parse-file-name';
import {describeFailure, describeSkip} from '@/domain/preview/messages';
import {errorMessage} from '@/ipc/command-error';
import * as commands from '@/ipc/commands';
import type {
  BatchKind,
  BatchProgress,
  BatchResult,
  Plan,
  ScannedFile,
} from '@/ipc/contracts';
import {rememberAppliedShows} from '@/store/lookups';
import {useSession} from '@/store/session-store';

export async function addPaths(paths: Array<string>): Promise<void> {
  if (paths.length === 0) return;
  if (useSession.getState().activity.kind !== 'idle') {
    toast.info(
      'Wait for the current task to finish, then add the files again.'
    );
    return;
  }

  useSession.getState().setActivity({kind: 'scanning'});
  try {
    const response = await commands.scan({paths, folders: 'recursive'});
    useSession.getState().addVolumes(response.volumes);
    const companions = await companionsOfAddedVideos(paths, response.files);
    const current = useSession.getState().files;
    const added = new Map(
      [...response.files, ...companions].map(file => [file.path, file])
    );
    for (const file of current) added.delete(file.path);
    useSession.getState().setFiles([...current, ...added.values()]);

    if (response.problems.length > 0) {
      toast.warning(
        `${plural(response.problems.length, 'item')} couldn't be read.`
      );
    }
  } catch (error) {
    toast.error(`Couldn't read the files: ${errorMessage(error)}`);
  } finally {
    useSession.getState().setActivity({kind: 'idle'});
  }
}

async function companionsOfAddedVideos(
  paths: Array<string>,
  scanned: Array<ScannedFile>
): Promise<Array<ScannedFile>> {
  const addedPaths = new Set(paths);
  const videos = scanned.filter(
    file => addedPaths.has(file.path) && isVideoExtension(file.extension)
  );
  if (videos.length === 0) return [];

  try {
    const folders = [...new Set(videos.map(file => file.directory))];
    const response = await commands.scan({paths: folders, folders: 'topLevel'});
    return companionsOf(videos, response.files);
  } catch (error) {
    toast.warning(
      `Couldn't look for subtitles and other files that go with the added videos: ${errorMessage(error)}`
    );
    return [];
  }
}

export function clearFiles(): void {
  useSession.getState().setFiles([]);
}

export async function loadUndoableBatch(): Promise<void> {
  try {
    const entries = await commands.history(20);
    const newestRename = entries.find(entry => entry.kind === 'rename');
    useSession
      .getState()
      .setUndoableBatchId(
        newestRename?.undo.kind === 'available' ? newestRename.batchId : null
      );
  } catch (error) {
    toast.error(`Couldn't read the rename history: ${errorMessage(error)}`);
  }
}

export async function applyPlan(plan: Plan): Promise<void> {
  const result = await runBatch('rename', plan.steps.length, onProgress =>
    commands.execute({kind: 'plan', plan}, onProgress)
  );
  if (result !== null)
    await rememberAppliedShows(plan.steps.map(step => step.rowId));
  await finishBatch(
    result,
    plan.steps.flatMap(step => [step.from, step.to]),
    result === null ? new Map() : finishedMoves(plan, result)
  );
  if (result === null) return;

  if (result.outcome.kind === 'completed') {
    toast.success(
      `Renamed ${plural(new Set(plan.steps.map(step => step.rowId)).size, 'file')}.`
    );
  } else {
    toast.error(
      `Stopped after ${plural(result.completedSteps, 'step')}: ${describeFailure(result.outcome.failure)}.`
    );
  }
}

export async function undoLatestBatch(): Promise<void> {
  const batchId = useSession.getState().undoableBatchId;
  if (batchId === null) return;

  const result = await runBatch('undo', 0, onProgress =>
    commands.undo({batchId}, onProgress)
  );
  await finishBatch(result, [], new Map());
  if (result === null) return;

  const [firstSkip] = result.skipped;
  if (result.outcome.kind === 'stopped') {
    toast.error(
      `Undo stopped: ${describeFailure(result.outcome.failure)}. Try Undo again once that's sorted.`
    );
  } else if (firstSkip !== undefined) {
    toast.warning(
      `Undone, except ${plural(result.skipped.length, 'step')} left as renamed: ${describeSkip(firstSkip.reason)}.`
    );
  } else {
    toast.success('Undone.');
  }
}

async function runBatch(
  batch: BatchKind,
  expectedSteps: number,
  start: (onProgress: (progress: BatchProgress) => void) => Promise<BatchResult>
): Promise<BatchResult | null> {
  const {setActivity} = useSession.getState();
  let totalSteps = expectedSteps;
  let completedSteps = 0;
  setActivity({kind: 'running', batch, completedSteps, totalSteps});

  try {
    return await start(progress => {
      if (progress.event === 'started') totalSteps = progress.data.totalSteps;
      else completedSteps += 1;
      setActivity({kind: 'running', batch, completedSteps, totalSteps});
    });
  } catch (error) {
    toast.error(
      `${batch === 'rename' ? 'Rename' : 'Undo'} failed: ${errorMessage(error)}`
    );
    return null;
  }
}

function finishedMoves(
  plan: Plan,
  result: BatchResult
): ReadonlyMap<string, string> {
  const stoppedAt =
    result.outcome.kind === 'stopped'
      ? result.outcome.position
      : Number.POSITIVE_INFINITY;
  return new Map(
    plan.steps
      .filter(step => step.position < stoppedAt)
      .map(step => [step.rowId, step.to])
  );
}

async function finishBatch(
  result: BatchResult | null,
  extraPaths: Array<string>,
  overrideMoves: ReadonlyMap<string, string>
): Promise<void> {
  const previousPaths = useSession.getState().files.map(file => file.path);
  try {
    await refreshFiles(
      [...previousPaths, ...(result?.touchedPaths ?? []), ...extraPaths],
      overrideMoves
    );
    await loadUndoableBatch();
  } finally {
    useSession.getState().markDiskChanged();
    useSession.getState().setActivity({kind: 'idle'});
  }
}

async function refreshFiles(
  paths: Array<string>,
  overrideMoves: ReadonlyMap<string, string>
): Promise<void> {
  const unique = [...new Set(paths)];
  if (unique.length === 0) return useSession.getState().setFiles([]);
  try {
    const response = await commands.scan({paths: unique, folders: 'topLevel'});
    useSession.getState().addVolumes(response.volumes);
    useSession.getState().setFiles(response.files, overrideMoves);
  } catch (error) {
    toast.error(`Couldn't refresh the file list: ${errorMessage(error)}`);
  }
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
