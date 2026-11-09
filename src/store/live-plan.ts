import {buildPreview, proposedRenames} from '@/domain/preview/build-preview';
import {compileSteps} from '@/domain/steps/compile-steps';
import {errorMessage} from '@/ipc/command-error';
import * as commands from '@/ipc/commands';
import type {Plan, ProposedRename} from '@/ipc/contracts';
import {useSession} from '@/store/session-store';

export const planningDelayMs = 150;

type SettledPlan =
  | {kind: 'planned'; plan: Plan}
  | {kind: 'failed'; message: string};

export type LivePlan =
  | {kind: 'nothingToPlan'}
  | {kind: 'planning'}
  | SettledPlan;

export type PlanResult = {key: string; plan: SettledPlan};

let latestRevision = 0;
let pendingRequest: ReturnType<typeof setTimeout> | undefined;

export function planKey(
  renames: Array<ProposedRename>,
  diskGeneration: number
): string {
  return `${diskGeneration}:${JSON.stringify(renames)}`;
}

export function livePlanFor(
  renames: Array<ProposedRename>,
  diskGeneration: number,
  planResult: PlanResult | null
): LivePlan {
  if (renames.length === 0) return {kind: 'nothingToPlan'};
  return planResult?.key === planKey(renames, diskGeneration)
    ? planResult.plan
    : {kind: 'planning'};
}

export function followPlanning(): () => void {
  return useSession.subscribe((state, previous) => {
    if (
      state.files === previous.files &&
      state.lookups.files === previous.lookups.files &&
      state.steps === previous.steps &&
      state.rowEdits === previous.rowEdits &&
      state.diskGeneration === previous.diskGeneration
    )
      return;
    clearTimeout(pendingRequest);
    pendingRequest = setTimeout(() => void requestPlan(), planningDelayMs);
  });
}

async function requestPlan(): Promise<void> {
  const revision = ++latestRevision;
  const {
    files,
    parsedNames,
    companions,
    lookups,
    steps,
    rowEdits,
    diskGeneration,
    planResult,
  } = useSession.getState();
  const renames = proposedRenames(
    buildPreview(
      files,
      parsedNames,
      companions,
      lookups.files,
      compileSteps(steps).pipeline,
      rowEdits
    )
  );
  const key = planKey(renames, diskGeneration);
  if (renames.length === 0 || planResult?.key === key) return;

  let plan: SettledPlan;
  try {
    plan = {kind: 'planned', plan: await commands.plan({revision, renames})};
  } catch (error) {
    plan = {kind: 'failed', message: errorMessage(error)};
  }
  if (revision === latestRevision) {
    useSession.getState().setPlanResult({key, plan});
  }
}
