import {
  memo,
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import {
  FlexRender,
  functionalUpdate,
  useTable,
  type RowSelectionState,
  type Updater,
} from '@tanstack/react-table';
import {
  defaultRangeExtractor,
  useVirtualizer,
  type Range,
} from '@tanstack/react-virtual';
import {cn} from 'cn';

import {companionsByVideo} from '@/domain/files/companions';
import type {PreviewRow} from '@/domain/preview/build-preview';
import type {EpisodeFlag} from '@/domain/suggestions/episode-flags';
import type {RowOutcome} from '@/ipc/contracts';
import type {LivePlan} from '@/store/live-plan';
import {useSession} from '@/store/session-store';
import {
  gridColumns,
  gridFeatures,
  gridTemplateColumns,
  PreviewRowContext,
  toggleIncluded,
  type GridRowModel,
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
  const excluded = useSession(state => state.rowEdits.excluded);
  const setExcluded = useSession(state => state.setExcluded);
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

  const rowSelection: RowSelectionState = useMemo(
    () =>
      Object.fromEntries(
        mainFiles
          .filter(file => !excluded.has(file.path))
          .map(file => [file.path, true as const])
      ),
    [mainFiles, excluded]
  );

  function handleRowSelectionChange(updater: Updater<RowSelectionState>) {
    const included = functionalUpdate(updater, rowSelection);
    setExcluded(
      new Set(
        mainFiles.filter(file => !included[file.path]).map(file => file.path)
      )
    );
  }

  const table = useTable({
    features: gridFeatures,
    columns: gridColumns,
    data: mainFiles,
    getRowId: file => file.path,
    getSubRows: file => companionFiles.get(file.path),
    enableRowSelection: row => row.depth === 0,
    enableSubRowSelection: false,
    state: {expanded: true, rowSelection},
    onRowSelectionChange: handleRowSelectionChange,
  });
  const tableRows = table.getRowModel().rows;

  const [activeRowId, setActiveRowId] = useState<string | null>(null);
  const rowIndexes = useMemo(
    () => new Map(tableRows.map((row, index) => [row.id, index])),
    [tableRows]
  );
  const activeIndex =
    activeRowId === null ? -1 : (rowIndexes.get(activeRowId) ?? -1);
  const rangeExtractor = useCallback(
    (range: Range) => withIndex(defaultRangeExtractor(range), activeIndex),
    [activeIndex]
  );
  const rowElementId = useId();

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
    rangeExtractor,
  });

  function moveTo(index: number) {
    const row = tableRows[index];
    if (row === undefined) return;
    setActiveRowId(row.id);
    virtualiser.scrollToIndex(index, {align: 'auto'});
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTableElement>) {
    if (event.target !== event.currentTarget) return;
    if (event.key === ' ') {
      event.preventDefault();
      const row = tableRows[activeIndex];
      if (row !== undefined) toggleIncluded(row, event.shiftKey);
      return;
    }
    const visibleRows = Math.max(
      1,
      Math.floor(
        ((scrollElement.current?.clientHeight ?? 0) - headerHeight) / rowHeight
      ) - 1
    );
    const next = nextRowIndex(
      event.key,
      activeIndex,
      tableRows.length,
      visibleRows
    );
    if (next === null) return;
    event.preventDefault();
    moveTo(next);
  }

  function handleClick(event: MouseEvent<HTMLTableElement>) {
    const rowId = rowIdAt(event.target);
    if (rowId !== null) setActiveRowId(rowId);
    event.currentTarget.focus({preventScroll: true});
  }

  return (
    <div ref={scrollElement} className="min-h-0 flex-1 overflow-y-auto">
      <table
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-to-interactive-role -- a table with role="grid" is the ARIA grid pattern.
        role="grid"
        tabIndex={0}
        aria-rowcount={tableRows.length + 1}
        aria-activedescendant={
          activeIndex < 0 ? undefined : `${rowElementId}-${activeIndex}`
        }
        className="group/grid grid outline-none"
        onKeyDown={handleKeyDown}
        onClick={handleClick}>
        <thead className="sticky top-0 z-10 grid bg-background">
          <tr
            aria-rowindex={1}
            className={cn(
              rowLayout,
              'border-b text-xs font-medium text-muted-foreground'
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
                elementId={`${rowElementId}-${item.index}`}
                isActive={item.index === activeIndex}
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
  row: GridRowModel;
  elementId: string;
  isActive: boolean;
  rowIndex: number;
  offset: number;
  previewRow: PreviewRow;
  status: RowStatus;
};

const GridRow = memo(function GridRow({
  row,
  elementId,
  isActive,
  rowIndex,
  offset,
  previewRow,
  status,
}: GridRowProps) {
  return (
    <tr
      id={elementId}
      data-row-id={row.id}
      data-active={isActive || undefined}
      aria-rowindex={rowIndex}
      className={cn(
        rowLayout,
        'absolute inset-x-0 top-0 border-b border-border/60 text-body data-active:bg-primary/6 group-focus/grid:data-active:bg-primary/15'
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

function nextRowIndex(
  key: string,
  current: number,
  count: number,
  pageSize: number
): number | null {
  const last = count - 1;
  if (last < 0) return null;
  switch (key) {
    case 'ArrowDown':
      return current < 0 ? 0 : Math.min(current + 1, last);
    case 'ArrowUp':
      return current < 0 ? 0 : Math.max(current - 1, 0);
    case 'PageDown':
      return Math.min(Math.max(current, 0) + pageSize, last);
    case 'PageUp':
      return Math.max(current - pageSize, 0);
    case 'Home':
      return 0;
    case 'End':
      return last;
    default:
      return null;
  }
}

function rowIdAt(target: EventTarget): string | null {
  return target instanceof Element
    ? (target.closest<HTMLElement>('[data-row-id]')?.dataset.rowId ?? null)
    : null;
}

function withIndex(indexes: Array<number>, index: number): Array<number> {
  if (index < 0 || indexes.includes(index)) return indexes;
  return [...indexes, index].sort((left, right) => left - right);
}
