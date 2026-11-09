// Mirrors src-tauri/src/contracts.rs.

export type NonEmptyArray<T> = [T, ...Array<T>];

export type FolderDepth = 'topLevel' | 'recursive';

export type ScanRequest = {paths: Array<string>; folders: FolderDepth};

export type FileAccess = 'writable' | 'readOnlyVolume' | 'folderNotWritable';

export type ScannedFile = {
  path: string;
  directory: string;
  name: string;
  stem: string;
  extension: string;
  folderName: string;
  parentFolderName: string | null;
  size: number;
  modifiedMs: number;
  createdMs: number | null;
  volumeId: string;
  access: FileAccess;
};

export type ScanProblem =
  | {kind: 'notUnicode'; lossyPath: string}
  | {kind: 'unreadable'; path: string; message: string};

export type ScanResponse = {
  files: Array<ScannedFile>;
  volumes: Array<VolumeInfo>;
  problems: Array<ScanProblem>;
  junkSkipped: number;
};

export type VolumeInfo = {
  id: string;
  mountPoint: string;
  label: string;
  fileSystem: string;
  access: 'readWrite' | 'readOnly';
  exclusiveRename: 'native' | 'checkThenRename';
  idStability: 'stable' | 'mountPathOnly';
};

export type RenameTarget = {kind: 'sameFolder'; name: string};

export type ProposedRename = {
  rowId: string;
  source: string;
  target: RenameTarget;
  companionOf: string | null;
};

export type PlanRequest = {revision: number; renames: Array<ProposedRename>};

export type PlanProblem =
  | {kind: 'emptyName'}
  | {kind: 'invalidCharacters'; characters: Array<string>}
  | {kind: 'reservedName'; reserved: string}
  | {kind: 'endsWithDotOrSpace'}
  | {kind: 'startsWithDot'}
  | {kind: 'notNormalised'}
  | {kind: 'nameTooLong'; length: number; limit: number}
  | {kind: 'duplicateTarget'; otherRowIds: Array<string>}
  | {kind: 'duplicateSource'; otherRowIds: Array<string>}
  | {kind: 'targetExists'}
  | {kind: 'blockedByRow'; rowId: string}
  | {kind: 'groupBlocked'; rowId: string}
  | {kind: 'sourceMissing'}
  | {kind: 'readOnlyVolume'}
  | {kind: 'volumeUnavailable'}
  | {kind: 'folderNotWritable'};

export type PlanWarning = {
  kind: 'pathTooLongForWindows';
  length: number;
  limit: number;
};

export type RowOutcome =
  | {kind: 'ready'; targetPath: string; warnings: Array<PlanWarning>}
  | {
      kind: 'blocked';
      problems: NonEmptyArray<PlanProblem>;
      warnings: Array<PlanWarning>;
    };

export type StepRole = 'direct' | 'toTemporary' | 'fromTemporary';

export type PlanStep = {
  position: number;
  rowId: string;
  groupId: string;
  role: StepRole;
  from: string;
  to: string;
  volumeId: string;
};

export type Plan = {
  planId: string;
  revision: number;
  rows: Array<{rowId: string; outcome: RowOutcome}>;
  steps: Array<PlanStep>;
};

export type ExecuteRequest = {kind: 'plan'; plan: Plan};

export type BatchRequest = {batchId: string};

export type BatchProgress =
  | {event: 'started'; data: {batchId: string; totalSteps: number}}
  | {event: 'stepDone'; data: {position: number; rowId: string}};

export type RenameFailure =
  | {kind: 'targetExists'}
  | {kind: 'sourceMissing'}
  | {kind: 'fileInUse'}
  | {kind: 'permissionDenied'}
  | {kind: 'readOnlyVolume'}
  | {kind: 'differentVolume'}
  | {kind: 'nameTooLong'}
  | {kind: 'driveDisconnected'}
  | {kind: 'other'; message: string; osCode: number | null};

export type SkipReason = 'fileChanged' | 'fileMissing' | 'originalNameTaken';

export type BatchKind = 'rename' | 'undo';

export type BatchResult = {
  batchId: string;
  kind: BatchKind;
  outcome:
    | {kind: 'completed'}
    | {
        kind: 'stopped';
        position: number;
        rowId: string;
        failure: RenameFailure;
      };
  completedSteps: number;
  totalSteps: number;
  skipped: Array<{position: number; rowId: string; reason: SkipReason}>;
  touchedPaths: Array<string>;
};

export type BatchStatus =
  | 'running'
  | 'completed'
  | 'stopped'
  | 'interrupted'
  | 'undone'
  | 'partiallyUndone';

export type JournalEntry = {
  batchId: string;
  kind: BatchKind;
  createdAt: number;
  status: BatchStatus;
  totalSteps: number;
  doneSteps: number;
  undoesBatchId: string | null;
  undo: {kind: 'available'} | {kind: 'alreadyUndone'} | {kind: 'notUndoable'};
};

export type CommandError = {
  kind:
    | 'journal'
    | 'io'
    | 'batchAlreadyRunning'
    | 'batchNotFound'
    | 'invalidRequest'
    | 'driveNotConnected'
    | 'driveMountedTwice'
    | 'resumeBlocked'
    | 'internal';
  message: string;
};
