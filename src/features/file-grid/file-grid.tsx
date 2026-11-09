import {memo, useMemo, useRef} from 'react';
import {FlexRender, useTable, type Row} from '@tanstack/react-table';
import {useVirtualizer} from '@tanstack/react-virtual';
import {cn} from 'cn';

import {companionsByVideo} from '@/domain/files/companions';
import type {PreviewRow} from '@/domain/preview/build-preview';
import type {EpisodeFlag} from '@/domain/suggestions/episode-flags';
import type {RowOutcome, ScannedFile} from '@/ipc/contracts';
import type {LivePlan} from '@/store/live-plan';
import {useSession} from '@/store/session-store';
import {
  gridColumns,
  gridFeatures,
  gridTemplateColumns,
  PreviewRowContext,
} from '@/features/file-grid/grid-columns';
import {rowStatus, type RowStatus} from '@/features/file-grid/row-status';

const rowHeight = 34;
const headerHeight = 32;
const noFlags: Array<EpisodeFlag> = [];
const rowLayout = 'grid items-center gap-3 px-4';

type FileGridProps = {
  rows: Array<PreviewRow>;
  flags: ReadonlyMap<string, Array<EpisodeFlag>>;
  outcomes: ReadonlyMap<string, RowOutcome>;
  livePlan: LivePlan;
};

export function FileGrid({rows, flags, outcomes, livePlan}: FileGridProps) {
  const files = useSession(state => state.files);
  const companions = useSession(state => state.companions);
  const mainFiles = useMemo(
    () => files.filter(file => !companions.has(file.path)),
    [files, companions]
  );
  const companionFiles = useMemo(
    () => companionsByVideo(files, companions),
    [files, companions]
  );
  const rowsByPath = useMemo(
    () => new Map(rows.map(row => [row.file.path, row])),
    [rows]
  );
  const statusOf = useMemo(() => {
    const statuses = new Map<PreviewRow, RowStatus>();
    return function statusOf(row: PreviewRow): RowStatus {
      let status = statuses.get(row);
      if (status === undefined) {
        status = rowStatus(
          row,
          flags.get(row.file.path) ?? noFlags,
          outcomes,
          livePlan
        );
        statuses.set(row, status);
      }
      return status;
    };
  }, [flags, outcomes, livePlan]);

  const table = useTable({
    features: gridFeatures,
    columns: gridColumns,
    data: mainFiles,
    getRowId: file => file.path,
    getSubRows: file => companionFiles.get(file.path),
    state: {expanded: true},
  });
  const tableRows = table.getRowModel().rows;

  const scrollElement = useRef<HTMLDivElement>(null);
  // oxlint-disable-next-line react/incompatible-library -- only affects React Compiler memoisation.
  const virtualiser = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => scrollElement.current,
    estimateSize: () => rowHeight,
    getItemKey: index => tableRows[index]?.id ?? index,
    overscan: 12,
    scrollMargin: headerHeight,
    scrollPaddingStart: headerHeight,
  });

  return (
    <div ref={scrollElement} className="min-h-0 flex-1 overflow-y-auto">
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-to-interactive-role -- a table with role="grid" is the ARIA grid pattern. */}
      <table role="grid" aria-rowcount={tableRows.length + 1} className="grid">
        <thead className="sticky top-0 z-10 grid border-b bg-background">
          <tr
            aria-rowindex={1}
            className={cn(
              rowLayout,
              'text-xs font-medium text-muted-foreground'
            )}
            style={{gridTemplateColumns, height: headerHeight}}>
            {table
              .getHeaderGroups()
              .flatMap(group => group.headers)
              .map(header => (
                // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- the label comes from FlexRender, which the rule can't see.
                <th key={header.id} className="truncate text-start font-medium">
                  <table.FlexRender header={header} />
                </th>
              ))}
          </tr>
        </thead>
        <tbody
          className="relative grid"
          style={{height: virtualiser.getTotalSize()}}>
          {virtualiser.getVirtualItems().map(item => {
            const row = tableRows[item.index];
            const previewRow = row && rowsByPath.get(row.id);
            if (row === undefined || previewRow === undefined) return null;
            return (
              <GridRow
                key={row.id}
                row={row}
                rowIndex={item.index + 2}
                offset={item.start - headerHeight}
                previewRow={previewRow}
                status={statusOf(previewRow)}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type GridRowProps = {
  row: Row<typeof gridFeatures, ScannedFile>;
  rowIndex: number;
  offset: number;
  previewRow: PreviewRow;
  status: RowStatus;
};

const GridRow = memo(function GridRow({
  row,
  rowIndex,
  offset,
  previewRow,
  status,
}: GridRowProps) {
  return (
    <tr
      aria-rowindex={rowIndex}
      className={cn(
        rowLayout,
        'absolute inset-x-0 top-0 border-b border-border/60 text-body'
      )}
      style={{
        gridTemplateColumns,
        height: rowHeight,
        transform: `translateY(${offset}px)`,
      }}>
      <PreviewRowContext value={{row: previewRow, status}}>
        {row.getAllCells().map(cell => (
          // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- the content comes from FlexRender, which the rule can't see.
          <td key={cell.id} className="min-w-0">
            <FlexRender cell={cell} />
          </td>
        ))}
      </PreviewRowContext>
    </tr>
  );
});
