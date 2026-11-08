import {useDeferredValue, useMemo} from 'react';

import {
  buildPreview,
  proposedRenames,
  type PreviewRow,
} from '@/domain/preview/build-preview';
import {parseTemplate} from '@/domain/templates/parse-template';
import type {TemplateParseResult} from '@/domain/templates/template';
import type {Plan, RowOutcome} from '@/ipc/contracts';
import {livePlanFor, type LivePlan} from '@/store/live-plan';
import {useSession} from '@/store/session-store';

export type Preview = {
  template: TemplateParseResult;
  rows: Array<PreviewRow>;
  livePlan: LivePlan;
  outcomes: ReadonlyMap<string, RowOutcome>;
  readyPlan: Plan | null;
  readyCount: number;
  blockedCount: number;
};

export function usePreview(): Preview {
  const files = useSession(state => state.files);
  const parsedNames = useSession(state => state.parsedNames);
  const templateSource = useSession(state => state.templateSource);
  const diskGeneration = useSession(state => state.diskGeneration);
  const planResult = useSession(state => state.planResult);

  const template = useMemo(
    () => parseTemplate(templateSource),
    [templateSource]
  );
  const deferredTemplate = useDeferredValue(template);
  const rows = useMemo(
    () => buildPreview(files, parsedNames, deferredTemplate),
    [files, parsedNames, deferredTemplate]
  );
  const renames = useMemo(() => proposedRenames(rows), [rows]);
  const livePlan = useMemo(
    () => livePlanFor(renames, diskGeneration, planResult),
    [renames, diskGeneration, planResult]
  );
  const outcomes = useMemo(() => rowOutcomes(livePlan), [livePlan]);
  const counts = useMemo(() => countOutcomes(outcomes), [outcomes]);

  return {
    template,
    rows,
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
