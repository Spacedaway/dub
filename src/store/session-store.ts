import {create} from 'zustand';

import {compareNaturally} from '@/domain/files/natural-sort';
import {parseFileName} from '@/domain/parsing/parse-file-name';
import type {ParsedName} from '@/domain/parsing/parsed-name';
import type {BatchKind, ScannedFile} from '@/ipc/contracts';
import type {PlanResult} from '@/store/live-plan';

export const defaultTemplate = '<Original>';

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
  templateSource: string;
  activity: Activity;
  undoableBatchId: string | null;
  diskGeneration: number;
  planResult: PlanResult | null;
  isDraggingOver: boolean;
};

type SessionActions = {
  setFiles: (files: Array<ScannedFile>) => void;
  setTemplateSource: (source: string) => void;
  setActivity: (activity: Activity) => void;
  setUndoableBatchId: (batchId: string | null) => void;
  markDiskChanged: () => void;
  setPlanResult: (planResult: PlanResult) => void;
  setDraggingOver: (isDraggingOver: boolean) => void;
};

export const useSession = create<SessionState & SessionActions>()(
  (set, get) => ({
    files: [],
    parsedNames: new Map(),
    templateSource: defaultTemplate,
    activity: {kind: 'idle'},
    undoableBatchId: null,
    diskGeneration: 0,
    planResult: null,
    isDraggingOver: false,

    setFiles(files) {
      const sorted = [...files].sort(
        (left, right) =>
          compareNaturally(left.directory, right.directory) ||
          compareNaturally(left.name, right.name)
      );
      set({
        files: sorted,
        parsedNames: new Map(
          sorted.map(file => [file.path, parseFileName(file)])
        ),
      });
    },
    setTemplateSource(templateSource) {
      set({templateSource});
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
  })
);
