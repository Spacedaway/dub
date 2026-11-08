import type {PreviewRow} from '@/domain/preview/build-preview';
import {
  describeFlag,
  describeLookupNote,
  describeProblem,
  describeWarning,
} from '@/domain/preview/messages';
import type {EpisodeFlag} from '@/domain/suggestions/episode-flags';
import type {RowOutcome} from '@/ipc/contracts';
import type {LivePlan} from '@/store/live-plan';

export type RowStatus =
  | {kind: 'unchanged'; warnings: Array<string>}
  | {kind: 'pending'}
  | {kind: 'ready'; warnings: Array<string>}
  | {kind: 'blocked'; reasons: Array<string>};

export function rowStatus(
  row: PreviewRow,
  flags: Array<EpisodeFlag>,
  outcomes: ReadonlyMap<string, RowOutcome>,
  livePlan: LivePlan
): RowStatus {
  if (row.lookup?.kind === 'pending') return {kind: 'pending'};
  const notes = [
    ...(row.lookup?.notes.map(describeLookupNote) ?? []),
    ...flags.map(describeFlag),
  ];
  switch (row.proposal.kind) {
    case 'unchanged':
    case 'templateInvalid':
      return {kind: 'unchanged', warnings: notes};
    case 'emptyName':
      return {
        kind: 'blocked',
        reasons: ["Nothing usable is left for this file's name.", ...notes],
      };
    case 'renamed':
      break;
  }

  if (livePlan.kind === 'failed')
    return {kind: 'blocked', reasons: [livePlan.message, ...notes]};
  const outcome = outcomes.get(row.file.path);
  if (outcome === undefined) return {kind: 'pending'};
  if (outcome.kind === 'blocked') {
    return {
      kind: 'blocked',
      reasons: [...outcome.problems.map(describeProblem), ...notes],
    };
  }
  const warnings = [...outcome.warnings.map(describeWarning), ...notes];
  if (row.missingTags.length > 0) {
    warnings.push(
      `No value for ${row.missingTags.map(tag => `<${tag}>`).join(', ')}.`
    );
  }
  return {kind: 'ready', warnings};
}
