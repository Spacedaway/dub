import {useDeferredValue, useMemo} from 'react';

import type {Lookups} from '@/domain/lookups/derive-lookups';
import {
  buildPreview,
  proposedRenames,
  type PreviewRow,
} from '@/domain/preview/build-preview';
import {compileSteps, type CompiledSteps} from '@/domain/steps/compile-steps';
import {
  counterIgnoresEpisodes,
  episodeFlags,
  type EpisodeFlag,
} from '@/domain/suggestions/episode-flags';
import type {Plan, RowOutcome} from '@/ipc/contracts';
import {livePlanFor, type LivePlan} from '@/store/live-plan';
import {useSession} from '@/store/session-store';

export type Preview = {
  compiledSteps: CompiledSteps;
  lookups: Lookups;
  rows: Array<PreviewRow>;
  flags: ReadonlyMap<string, Array<EpisodeFlag>>;
  counterIgnoresEpisodes: boolean;
  livePlan: LivePlan;
  outcomes: ReadonlyMap<string, RowOutcome>;
  readyPlan: Plan | null;
  readyCount: number;
  blockedCount: number;
  excludedCount: number;
  editCount: number;
};

export function usePreview(): Preview {
  const files = useSession(state => state.files);
  const parsedNames = useSession(state => state.parsedNames);
  const companions = useSession(state => state.companions);
  const lookups = useSession(state => state.lookups);
  const steps = useSession(state => state.steps);
  const rowEdits = useSession(state => state.rowEdits);
  const diskGeneration = useSession(state => state.diskGeneration);
  const planResult = useSession(state => state.planResult);

  const compiledSteps = useMemo(() => compileSteps(steps), [steps]);
  const deferredPipeline = useDeferredValue(compiledSteps.pipeline);
  const rows = useMemo(
    () =>
      buildPreview(
        files,
        parsedNames,
        companions,
        lookups.files,
        deferredPipeline,
        rowEdits
      ),
    [files, parsedNames, companions, lookups.files, deferredPipeline, rowEdits]
  );
  const flags = useMemo(
    () => episodeFlags(files, parsedNames),
    [files, parsedNames]
  );
  const template = compiledSteps.template;
  const isTemplateEnabled = steps.template.enabled;
  const ignoresEpisodes = useMemo(
    () =>
      isTemplateEnabled &&
      template.kind === 'parsed' &&
      counterIgnoresEpisodes(template.template, parsedNames),
    [isTemplateEnabled, template, parsedNames]
  );
  const renames = useMemo(() => proposedRenames(rows), [rows]);
  const livePlan = useMemo(
    () => livePlanFor(renames, diskGeneration, planResult),
    [renames, diskGeneration, planResult]
  );
  const outcomes = useMemo(() => rowOutcomes(livePlan), [livePlan]);
  const counts = useMemo(() => countOutcomes(outcomes), [outcomes]);
  const excludedCount = useMemo(
    () => rows.filter(row => row.proposal.kind === 'excluded').length,
    [rows]
  );
  const editCount = useMemo(
    () => rows.filter(row => row.override !== null).length,
    [rows]
  );

  return {
    compiledSteps,
    lookups,
    rows,
    flags,
    counterIgnoresEpisodes: ignoresEpisodes,
    livePlan,
    outcomes,
    readyPlan: livePlan.kind === 'planned' ? livePlan.plan : null,
    ...counts,
    excludedCount,
    editCount,
  };
}

function rowOutcomes(livePlan: LivePlan): ReadonlyMap<string, RowOutcome> {
  if (livePlan.kind !== 'planned') return new Map();
  return new Map(livePlan.plan.rows.map(row => [row.rowId, row.outcome]));
}

function countOutcomes(outcomes: ReadonlyMap<string, RowOutcome>): {
  readyCount: number;
  blockedCount: number;
} {
  let readyCount = 0;
  let blockedCount = 0;
  for (const outcome of outcomes.values()) {
    if (outcome.kind === 'ready') readyCount += 1;
    else blockedCount += 1;
  }
  return {readyCount, blockedCount};
}
