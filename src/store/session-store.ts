import {create} from 'zustand';

import {
  findCompanions,
  orderCompanionsAfterVideos,
} from '@/domain/files/companions';
import {compareNaturally} from '@/domain/files/natural-sort';
import {
  deriveLookups,
  noLookups,
  type Lookups,
} from '@/domain/lookups/derive-lookups';
import type {ShowLookup} from '@/domain/lookups/group-status';
import {lookupGroups} from '@/domain/lookups/lookup-groups';
import {parseFileName} from '@/domain/parsing/parse-file-name';
import type {ParsedName} from '@/domain/parsing/parsed-name';
import {noRowEdits, type RowEdits} from '@/domain/preview/build-preview';
import {
  initialSteps,
  newTextStep,
  type Steps,
  type TemplateStep,
  type TextStep,
  type TextStepKind,
} from '@/domain/steps/step';
import type {BatchKind, ScannedFile, VolumeInfo} from '@/ipc/contracts';
import type {PlanResult} from '@/store/live-plan';

export type Activity =
  | {kind: 'idle'}
  | {kind: 'scanning'}
  | {
      kind: 'running';
      batch: BatchKind;
      completedSteps: number;
      totalSteps: number;
    };

type SessionState = {
  files: Array<ScannedFile>;
  parsedNames: ReadonlyMap<string, ParsedName | null>;
  companions: ReadonlyMap<string, string>;
  steps: Steps;
  rowEdits: RowEdits;
  activity: Activity;
  undoableBatchId: string | null;
  diskGeneration: number;
  planResult: PlanResult | null;
  isDraggingOver: boolean;
  volumes: ReadonlyMap<string, VolumeInfo>;
  lookupsEnabled: boolean | null;
  showLookups: ReadonlyMap<string, ShowLookup>;
  lookups: Lookups;
};

type SessionActions = {
  setFiles: (
    files: Array<ScannedFile>,
    overrideMoves?: ReadonlyMap<string, string>
  ) => void;
  setTemplateSource: (source: string) => void;
  setTemplateEnabled: (enabled: boolean) => void;
  addTextStep: (kind: TextStepKind) => string;
  updateTextStep: (step: TextStep) => void;
  deleteTextStep: (id: string) => void;
  moveTextStep: (id: string, offset: -1 | 1) => void;
  setExcluded: (excluded: ReadonlySet<string>) => void;
  setNameOverride: (path: string, stem: string | null) => void;
  resetNameOverrides: () => void;
  setActivity: (activity: Activity) => void;
  setUndoableBatchId: (batchId: string | null) => void;
  markDiskChanged: () => void;
  setPlanResult: (planResult: PlanResult) => void;
  setDraggingOver: (isDraggingOver: boolean) => void;
  setShowLookup: (groupKey: string, lookup: ShowLookup | null) => void;
  addVolumes: (volumes: Array<VolumeInfo>) => void;
  setLookupsEnabled: (enabled: boolean) => void;
};

let lastStepId = 0;

function withTemplate(
  steps: Steps,
  changes: Partial<TemplateStep>
): {steps: Steps} {
  return {steps: {...steps, template: {...steps.template, ...changes}}};
}

function rowEditsFor(
  rowEdits: RowEdits,
  paths: ReadonlySet<string>,
  overrideMoves: ReadonlyMap<string, string>
): RowEdits {
  return {
    excluded: new Set([...rowEdits.excluded].filter(path => paths.has(path))),
    overrides: new Map(
      [...rowEdits.overrides]
        .map(([path, stem]) => [overrideMoves.get(path) ?? path, stem] as const)
        .filter(([path]) => paths.has(path))
    ),
  };
}

function withTextSteps(
  steps: Steps,
  textSteps: Array<TextStep>
): {steps: Steps} {
  return {steps: {...steps, textSteps}};
}

export const useSession = create<SessionState & SessionActions>()(
  (set, get) => ({
    files: [],
    parsedNames: new Map(),
    companions: new Map(),
    steps: initialSteps,
    rowEdits: noRowEdits,
    activity: {kind: 'idle'},
    undoableBatchId: null,
    diskGeneration: 0,
    planResult: null,
    isDraggingOver: false,
    volumes: new Map(),
    lookupsEnabled: null,
    showLookups: new Map(),
    lookups: noLookups,

    setFiles(files, overrideMoves = new Map()) {
      const sorted = [...files].sort(
        (left, right) =>
          compareNaturally(left.directory, right.directory) ||
          compareNaturally(left.name, right.name)
      );
      const companions = findCompanions(sorted);
      const parsedNames = new Map(
        sorted.map(file => [file.path, parseFileName(file)])
      );
      const groupKeys = new Set(
        lookupGroups(sorted, parsedNames).map(group => group.key)
      );
      const showLookups = new Map(
        [...get().showLookups].filter(([key]) => groupKeys.has(key))
      );
      const orderedFiles = orderCompanionsAfterVideos(sorted, companions);
      set({
        files: orderedFiles,
        parsedNames,
        companions,
        rowEdits: rowEditsFor(
          get().rowEdits,
          new Set(sorted.map(file => file.path)),
          overrideMoves
        ),
        showLookups,
        lookups: deriveLookups(
          orderedFiles,
          parsedNames,
          showLookups,
          get().lookupsEnabled
        ),
      });
    },
    setTemplateSource(source) {
      set(withTemplate(get().steps, {source}));
    },
    setTemplateEnabled(enabled) {
      set(withTemplate(get().steps, {enabled}));
    },
    addTextStep(kind) {
      const id = `step-${++lastStepId}`;
      const {steps} = get();
      set(withTextSteps(steps, [...steps.textSteps, newTextStep(kind, id)]));
      return id;
    },
    updateTextStep(step) {
      const {steps} = get();
      set(
        withTextSteps(
          steps,
          steps.textSteps.map(current =>
            current.id === step.id ? step : current
          )
        )
      );
    },
    deleteTextStep(id) {
      const {steps} = get();
      set(
        withTextSteps(
          steps,
          steps.textSteps.filter(step => step.id !== id)
        )
      );
    },
    moveTextStep(id, offset) {
      const {steps} = get();
      const index = steps.textSteps.findIndex(step => step.id === id);
      const moved = steps.textSteps[index];
      const displaced = steps.textSteps[index + offset];
      if (moved === undefined || displaced === undefined) return;
      const textSteps = [...steps.textSteps];
      textSteps[index] = displaced;
      textSteps[index + offset] = moved;
      set(withTextSteps(steps, textSteps));
    },
    setExcluded(excluded) {
      set({rowEdits: {...get().rowEdits, excluded}});
    },
    setNameOverride(path, stem) {
      const {rowEdits} = get();
      const overrides = new Map(rowEdits.overrides);
      if (stem === null || stem.trim() === '') overrides.delete(path);
      else overrides.set(path, stem.normalize('NFC'));
      set({rowEdits: {...rowEdits, overrides}});
    },
    resetNameOverrides() {
      set({rowEdits: {...get().rowEdits, overrides: new Map()}});
    },
    setActivity(activity) {
      set({activity});
    },
    setUndoableBatchId(undoableBatchId) {
      set({undoableBatchId});
    },
    markDiskChanged() {
      set(state => ({diskGeneration: state.diskGeneration + 1}));
    },
    setPlanResult(planResult) {
      set({planResult});
    },
    setDraggingOver(isDraggingOver) {
      if (get().isDraggingOver !== isDraggingOver) set({isDraggingOver});
    },
    addVolumes(volumes) {
      const known = new Map(get().volumes);
      for (const volume of volumes) known.set(volume.id, volume);
      set({volumes: known});
    },
    setLookupsEnabled(lookupsEnabled) {
      const {files, parsedNames, showLookups} = get();
      set({
        lookupsEnabled,
        lookups: deriveLookups(files, parsedNames, showLookups, lookupsEnabled),
      });
    },
    setShowLookup(groupKey, lookup) {
      const {files, parsedNames, lookupsEnabled} = get();
      const showLookups = new Map(get().showLookups);
      if (lookup === null) showLookups.delete(groupKey);
      else showLookups.set(groupKey, lookup);
      set({
        showLookups,
        lookups: deriveLookups(files, parsedNames, showLookups, lookupsEnabled),
      });
    },
  })
);
