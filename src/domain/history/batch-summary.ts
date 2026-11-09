import {baseName} from '@/domain/files/base-name';
import {compareNaturally} from '@/domain/files/natural-sort';
import {describeFailure} from '@/domain/preview/messages';
import {plural} from '@/domain/text/plural';
import type {BatchStep, JournalEntry, StepStatus} from '@/ipc/contracts';

export type BatchRowState =
  | 'renamed'
  | 'undone'
  | 'notRenamed'
  | 'failed'
  | 'unfinished';

export type BatchRow = {
  rowId: string;
  folder: string;
  oldName: string;
  newName: string;
  state: BatchRowState;
};

const timeFormat = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function batchTime(entry: JournalEntry): string {
  return timeFormat.format(entry.createdAt);
}

export function batchSummary(entry: JournalEntry): string {
  const {totalFiles, renamedFiles, undoneFiles} = entry;
  const progress = `${renamedFiles} of ${plural(totalFiles, 'file')}`;
  if (undoneFiles > 0) {
    return renamedFiles === 0
      ? 'Undone'
      : `Partly undone: ${progress} still renamed`;
  }
  switch (entry.status) {
    case 'running':
      return `Renaming: ${progress} so far`;
    case 'completed':
      return `Renamed ${plural(totalFiles, 'file')}`;
    case 'stopped':
      return entry.stopReason === null
        ? `Stopped after ${progress}`
        : `Stopped after ${progress}: ${describeFailure(entry.stopReason)}`;
    case 'interrupted':
      return `Interrupted after ${progress}`;
  }
}

export function batchRows(steps: Array<BatchStep>): Array<BatchRow> {
  const stepsByRow = new Map<string, Array<BatchStep>>();
  for (const step of steps) {
    stepsByRow.set(step.rowId, [...(stepsByRow.get(step.rowId) ?? []), step]);
  }
  const rows: Array<BatchRow> = [];
  for (const [rowId, rowSteps] of stepsByRow) {
    const first = rowSteps[0];
    const last = rowSteps.at(-1);
    if (first === undefined || last === undefined) continue;
    rows.push({
      rowId,
      folder: first.from.slice(0, -baseName(first.from).length - 1),
      oldName: baseName(first.from),
      newName: baseName(last.to),
      state: rowState(rowSteps),
    });
  }
  return rows.sort(
    (left, right) =>
      compareNaturally(left.folder, right.folder) ||
      compareNaturally(left.oldName, right.oldName)
  );
}

function rowState(steps: Array<BatchStep>): BatchRowState {
  function allAre(...statuses: Array<StepStatus>): boolean {
    return steps.every(step => statuses.includes(step.status));
  }
  if (allAre('done')) return 'renamed';
  if (allAre('undone')) return 'undone';
  if (steps.some(step => step.status === 'failed')) return 'failed';
  if (allAre('planned', 'started')) return 'notRenamed';
  return 'unfinished';
}
