import {PropsWithChildren, useRef} from 'react';
import {useVirtualizer} from '@tanstack/react-virtual';
import {cn} from 'cn';
import {
  ArrowRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  TriangleAlertIcon,
} from 'lucide-react';

import type {ParsedName} from '@/domain/parsing/parsed-name';
import type {PreviewRow} from '@/domain/preview/build-preview';
import type {RowOutcome} from '@/ipc/contracts';
import type {LivePlan} from '@/store/live-plan';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/ui/tooltip';
import {rowStatus, type RowStatus} from '@/features/file-grid/row-status';

const rowHeight = 34;
const columns =
  'grid grid-cols-[1.25rem_minmax(0,1fr)_1rem_minmax(0,1fr)_minmax(0,12rem)] items-center gap-3';

type FileListProps = {
  rows: Array<PreviewRow>;
  outcomes: ReadonlyMap<string, RowOutcome>;
  livePlan: LivePlan;
};

export function FileList({rows, outcomes, livePlan}: FileListProps) {
  const scrollElement = useRef<HTMLDivElement>(null);
  // oxlint-disable-next-line react/incompatible-library -- only affects React Compiler memoisation.
  const virtualiser = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollElement.current,
    estimateSize: () => rowHeight,
    overscan: 12,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className={cn(
          columns,
          'border-b px-4 py-2 text-xs font-medium text-muted-foreground'
        )}>
        <span />
        <span>Original</span>
        <span />
        <span>New name</span>
        <span>Folder</span>
      </div>
      <div ref={scrollElement} className="min-h-0 flex-1 overflow-y-auto">
        <div className="relative" style={{height: virtualiser.getTotalSize()}}>
          {virtualiser.getVirtualItems().map(item => {
            const row = rows[item.index];
            if (row === undefined) return null;
            return (
              <FileRow
                key={row.file.path}
                row={row}
                status={rowStatus(row, outcomes, livePlan)}
                style={{
                  transform: `translateY(${item.start}px)`,
                  height: rowHeight,
                }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function FileRow({
  row,
  status,
  style,
}: {
  row: PreviewRow;
  status: RowStatus;
  style: React.CSSProperties;
}) {
  const newName =
    row.proposal.kind === 'renamed' ? row.proposal.name : row.file.name;
  const isMuted = status.kind === 'unchanged';

  return (
    <div
      className={cn(
        columns,
        'absolute inset-x-0 top-0 border-b border-border/60 px-4 text-body'
      )}
      style={style}>
      <StatusIcon status={status} />
      <div className="min-w-0">
        <p className="truncate" title={row.file.name}>
          {row.file.name}
        </p>
        <DetectedSummary parsed={row.parsed} />
      </div>
      <ArrowRightIcon
        className={cn(
          'size-3.5 text-muted-foreground',
          isMuted && 'opacity-30'
        )}
      />
      <p
        className={cn(
          'truncate',
          isMuted ? 'text-muted-foreground' : 'font-medium'
        )}
        title={newName}>
        {newName}
      </p>
      <p
        className="truncate text-xs text-muted-foreground"
        title={row.file.directory}>
        {row.file.folderName}
      </p>
    </div>
  );
}

function DetectedSummary({parsed}: {parsed: ParsedName | null}) {
  if (parsed === null || parsed.name === null) return null;
  const parts = [parsed.name];
  if (parsed.year !== null) parts.push(String(parsed.year));
  if (parsed.season !== null)
    parts.push(`S${String(parsed.season).padStart(2, '0')}`);
  if (parsed.episodes.length > 0)
    parts.push(
      `E${parsed.episodes.map(episode => String(episode).padStart(2, '0')).join('-')}`
    );
  if (parsed.airDate !== null) parts.push(parsed.airDate);
  return (
    <p className="truncate text-caption leading-tight text-muted-foreground">
      {parts.join(' · ')}
    </p>
  );
}

function StatusIcon({status}: {status: RowStatus}) {
  switch (status.kind) {
    case 'unchanged':
      return <span className="size-3.5" />;
    case 'pending':
      return (
        <CircleDashedIcon className="size-3.5 animate-spin-slow text-muted-foreground" />
      );
    case 'ready':
      return status.warnings.length === 0 ? (
        <CircleCheckIcon className="size-3.5 text-success" aria-label="Ready" />
      ) : (
        <ReasonsTooltip reasons={status.warnings}>
          <TriangleAlertIcon
            className="size-3.5 text-warning"
            aria-label="Ready, with warnings"
          />
        </ReasonsTooltip>
      );
    case 'blocked':
      return (
        <ReasonsTooltip reasons={status.reasons}>
          <CircleAlertIcon
            className="size-3.5 text-destructive"
            aria-label="Can't be renamed"
          />
        </ReasonsTooltip>
      );
  }
}

function ReasonsTooltip({
  reasons,
  children,
}: PropsWithChildren<{
  reasons: Array<string>;
}>) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>
        {children}
      </TooltipTrigger>
      <TooltipContent side="right" className="flex-col items-start">
        {reasons.map(reason => (
          <span key={reason}>{reason}</span>
        ))}
      </TooltipContent>
    </Tooltip>
  );
}
