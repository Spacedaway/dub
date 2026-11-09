import {createContext} from 'react';

import type {PreviewRow} from '@/domain/preview/build-preview';
import type {RowStatus} from '@/features/file-grid/row-status';

export type RowCellProps = {
  row: PreviewRow;
  status: RowStatus;
  isEditing: boolean;
};

export const PreviewRowContext = createContext<RowCellProps | null>(null);

export type GridActions = {
  finishEditing: (
    path: string,
    stem: string | null,
    returnFocus: boolean
  ) => void;
};

export const GridActionsContext = createContext<GridActions | null>(null);

export function canEdit(row: PreviewRow): boolean {
  return (
    row.companionOf === null &&
    row.proposal.kind !== 'excluded' &&
    row.proposal.kind !== 'stepInvalid'
  );
}
