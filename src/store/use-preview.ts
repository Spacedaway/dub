import {useDeferredValue, useMemo} from 'react';

import {
  buildPreview,
  nameSourceFor,
  proposedRenames,
  type NameSource,
  type PreviewRow,
} from '@/domain/preview/build-preview';
import {
  counterIgnoresEpisodes,
  episodeFlags,
  type EpisodeFlag,
} from '@/domain/suggestions/episode-flags';
import type {Plan, RowOutcome} from '@/ipc/contracts';
import {livePlanFor, type LivePlan} from '@/store/live-plan';
import {useSession} from '@/store/session-store';

export type Preview = {
  nameSource: NameSource;
  rows: Array<PreviewRow>;
  flags: ReadonlyMap<string, Array<EpisodeFlag>>;
  counterIgnoresEpisodes: boolean;
  livePlan: LivePlan;
  outcomes: ReadonlyMap<string, RowOutcome>;
  readyPlan: Plan | null;
  readyCount: number;
  blockedCount: number;
};

export function usePreview(): Preview {
  const files = useSession(state => state.files);
  const parsedNames = useSession(state => state.parsedNames);
  const companions = useSession(state => state.companions);
  const templateSource = useSession(state => state.templateSource);
  const diskGeneration = useSession(state => state.diskGeneration);
  const planResult = useSession(state => state.planResult);

  const nameSource = useMemo(
    () => nameSourceFor(templateSource),
    [templateSource]
  );
  const deferredNameSource = useDeferredValue(nameSource);
  const rows = useMemo(
    () => buildPreview(files, parsedNames, companions, deferredNameSource),
    [files, parsedNames, companions, deferredNameSource]
  );
  const flags = useMemo(
    () => episodeFlags(files, parsedNames),
    [files, parsedNames]
  );
  const ignoresEpisodes = useMemo(
    () =>
      nameSource.kind === 'parsed' &&
      counterIgnoresEpisodes(nameSource.template, parsedNames),
    [nameSource, parsedNames]
  );
  const renames = useMemo(() => proposedRenames(rows), [rows]);
  const livePlan = useMemo(
    () => livePlanFor(renames, diskGeneration, planResult),
    [renames, diskGeneration, planResult]
  );
  const outcomes = useMemo(() => rowOutcomes(livePlan), [livePlan]);
  const counts = useMemo(() => countOutcomes(outcomes), [outcomes]);

  return {
    nameSource,
    rows,
    flags,
    counterIgnoresEpisodes: ignoresEpisodes,
    livePlan,
    outcomes,
    readyPlan: livePlan.kind === 'planned' ? livePlan.plan : null,
    ...counts,
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
