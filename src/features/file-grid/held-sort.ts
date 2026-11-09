import type {SortingState} from '@tanstack/react-table';

import {compareNaturally} from '@/domain/files/natural-sort';
import {newName, type PreviewRow} from '@/domain/preview/build-preview';
import type {FileKind} from '@/domain/suggestions/classify-file';
import type {ScannedFile} from '@/ipc/contracts';
import type {RowStatus} from '@/features/file-grid/row-status';

const sortColumns = [
  'status',
  'original',
  'newName',
  'kind',
  'folder',
] as const;

export type SortColumn = (typeof sortColumns)[number];

type SortKey = string | number;

export type HeldSort = {
  files: Array<ScannedFile> | null;
  keys: ReadonlyMap<string, SortKey>;
};

export const noHeldSort: HeldSort = {files: null, keys: new Map()};

const kindOrder: Array<FileKind> = [
  'tvEpisode',
  'datedEpisode',
  'numberedEpisode',
  'film',
  'generic',
];

export function sortColumnOf(sorting: SortingState): SortColumn | null {
  const id = sorting[0]?.id;
  return sortColumns.find(column => column === id) ?? null;
}

export function holdSort(
  column: SortColumn,
  files: Array<ScannedFile>,
  rowsByPath: ReadonlyMap<string, PreviewRow>,
  statusOf: (row: PreviewRow) => RowStatus,
  previous: ReadonlyMap<string, SortKey>
): HeldSort {
  const keys = new Map<string, SortKey>();
  for (const file of files) {
    const row = rowsByPath.get(file.path);
    const key =
      previous.get(file.path) ??
      (row === undefined ? undefined : sortKey(column, row, statusOf(row)));
    if (key !== undefined) keys.set(file.path, key);
  }
  return {files, keys};
}

export function orderByHeldSort(
  files: Array<ScannedFile>,
  keys: ReadonlyMap<string, SortKey>,
  isDescending: boolean
): Array<ScannedFile> {
  const direction = isDescending ? -1 : 1;
  return files
    .map((file, index) => ({file, index, key: keys.get(file.path)}))
    .sort((left, right) => {
      if (left.key === undefined || right.key === undefined) {
        return (
          Number(left.key === undefined) - Number(right.key === undefined) ||
          left.index - right.index
        );
      }
      return (
        direction * compareKeys(left.key, right.key) || left.index - right.index
      );
    })
    .map(({file}) => file);
}

function sortKey(
  column: SortColumn,
  row: PreviewRow,
  status: RowStatus
): SortKey {
  switch (column) {
    case 'status':
      return statusRank(status);
    case 'original':
      return row.file.name;
    case 'newName':
      return newName(row);
    case 'kind':
      return kindOrder.indexOf(row.kind);
    case 'folder':
      return row.file.directory;
  }
}

function statusRank(status: RowStatus): number {
  switch (status.kind) {
    case 'blocked':
      return 0;
    case 'ready':
    case 'unchanged':
      if (status.warnings.length > 0) return 1;
      return status.kind === 'ready' ? 2 : 3;
    case 'pending':
      return 2;
    case 'excluded':
      return 4;
  }
}

function compareKeys(left: SortKey, right: SortKey): number {
  return typeof left === 'number' && typeof right === 'number'
    ? left - right
    : compareNaturally(String(left), String(right));
}
