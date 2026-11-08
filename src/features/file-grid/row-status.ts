import type {PreviewRow} from '@/domain/preview/build-preview';
import {describeProblem, describeWarning} from '@/domain/preview/messages';
import type {RowOutcome} from '@/ipc/contracts';
import type {LivePlan} from '@/store/live-plan';

export type RowStatus =
  | {kind: 'unchanged'}
  | {kind: 'pending'}
  | {kind: 'ready'; warnings: Array<string>}
  | {kind: 'blocked'; reasons: Array<string>};

export function rowStatus(
  row: PreviewRow,
  outcomes: ReadonlyMap<string, RowOutcome>,
  livePlan: LivePlan
): RowStatus {
  switch (row.proposal.kind) {
    case 'unchanged':
      return {kind: 'unchanged'};
    case 'emptyName':
      return {
        kind: 'blocked',
        reasons: ["The template leaves nothing usable for this file's name."],
      };
    case 'templateInvalid':
      return {kind: 'unchanged'};
    case 'renamed':
      break;
  }

  if (livePlan.kind === 'failed')
    return {kind: 'blocked', reasons: [livePlan.message]};
  const outcome = outcomes.get(row.file.path);
  if (outcome === undefined) return {kind: 'pending'};
  if (outcome.kind === 'blocked') {
    return {kind: 'blocked', reasons: outcome.problems.map(describeProblem)};
  }
  const warnings = outcome.warnings.map(describeWarning);
  if (row.missingTags.length > 0) {
    warnings.push(
      `No value for ${row.missingTags.map(tag => `<${tag}>`).join(', ')}.`
    );
  }
  return {kind: 'ready', warnings};
}
