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
  templateSource: string;
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
  setFiles: (files: Array<ScannedFile>) => void;
  setTemplateSource: (source: string) => void;
  setActivity: (activity: Activity) => void;
  setUndoableBatchId: (batchId: string | null) => void;
  markDiskChanged: () => void;
  setPlanResult: (planResult: PlanResult) => void;
  setDraggingOver: (isDraggingOver: boolean) => void;
  setShowLookup: (groupKey: string, lookup: ShowLookup | null) => void;
  addVolumes: (volumes: Array<VolumeInfo>) => void;
  setLookupsEnabled: (enabled: boolean) => void;
};

export const useSession = create<SessionState & SessionActions>()(
  (set, get) => ({
    files: [],
    parsedNames: new Map(),
    companions: new Map(),
    templateSource: '',
    activity: {kind: 'idle'},
    undoableBatchId: null,
    diskGeneration: 0,
    planResult: null,
    isDraggingOver: false,
    volumes: new Map(),
    lookupsEnabled: null,
    showLookups: new Map(),
    lookups: noLookups,

    setFiles(files) {
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
        showLookups,
        lookups: deriveLookups(
          orderedFiles,
          parsedNames,
          showLookups,
          get().lookupsEnabled
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
