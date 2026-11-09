import {PropsWithChildren, useRef} from 'react';
import {useVirtualizer} from '@tanstack/react-virtual';
import {cn} from 'cn';
import {
  ArrowRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CornerDownRightIcon,
  TriangleAlertIcon,
} from 'lucide-react';

import type {ParsedName} from '@/domain/parsing/parsed-name';
import type {PreviewRow} from '@/domain/preview/build-preview';
import type {FileKind} from '@/domain/suggestions/classify-file';
import type {EpisodeFlag} from '@/domain/suggestions/episode-flags';
import {runEnds} from '@/domain/templates/render-template';
import type {RowOutcome} from '@/ipc/contracts';
import type {LivePlan} from '@/store/live-plan';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/ui/tooltip';
import {rowStatus, type RowStatus} from '@/features/file-grid/row-status';
import {stepTitles} from '@/features/step-editor/step-titles';

const rowHeight = 34;
const noFlags: Array<EpisodeFlag> = [];
const kindLabels: Record<FileKind, string | null> = {
  tvEpisode: 'TV',
  datedEpisode: 'Dated',
  numberedEpisode: 'Numbered',
  film: 'Film',
  generic: null,
};
const columns =
  'grid grid-cols-[1.25rem_minmax(0,1fr)_1rem_minmax(0,1fr)_minmax(0,12rem)] items-center gap-3';

type FileListProps = {
  rows: Array<PreviewRow>;
  flags: ReadonlyMap<string, Array<EpisodeFlag>>;
  outcomes: ReadonlyMap<string, RowOutcome>;
  livePlan: LivePlan;
};

export function FileList({rows, flags, outcomes, livePlan}: FileListProps) {
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
                status={rowStatus(
                  row,
                  flags.get(row.file.path) ?? noFlags,
                  outcomes,
                  livePlan
                )}
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
      <div className="flex min-w-0 items-center gap-1.5">
        {row.companionOf !== null && (
          <CornerDownRightIcon
            className="ml-1 size-3.5 shrink-0 text-muted-foreground"
            aria-label="Renames with the video above"
          />
        )}
        <div className="min-w-0">
          <p className="truncate" title={row.file.name}>
            {row.file.name}
          </p>
          <DetectedSummary parsed={row.parsed} kind={row.kind} />
        </div>
      </div>
      <ArrowRightIcon
        className={cn(
          'size-3.5 text-muted-foreground',
          isMuted && 'opacity-30'
        )}
      />
      <NewName row={row} name={newName} isMuted={isMuted} />
      <p
        className="truncate text-xs text-muted-foreground"
        title={row.file.directory}>
        {row.file.folderName}
      </p>
    </div>
  );
}

function DetectedSummary({
  parsed,
  kind,
}: {
  parsed: ParsedName | null;
  kind: FileKind;
}) {
  if (parsed === null || parsed.name === null) return null;
  const label = kindLabels[kind];
  const parts = label === null ? [parsed.name] : [label, parsed.name];
  if (parsed.year !== null) parts.push(String(parsed.year));
  if (parsed.season !== null)
    parts.push(`S${String(parsed.season).padStart(2, '0')}`);
  if (parsed.episodes.length > 0)
    parts.push(
      `E${runEnds(parsed.episodes)
        .map(episode => String(episode).padStart(2, '0'))
        .join('-')}`
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
      return status.warnings.length === 0 ? (
        <span className="size-3.5" />
      ) : (
        <ReasonsTooltip reasons={status.warnings}>
          <TriangleAlertIcon
            className="size-3.5 text-warning"
            aria-label="Unchanged, with warnings"
          />
        </ReasonsTooltip>
      );
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

function NewName({
  row,
  name,
  isMuted,
}: {
  row: PreviewRow;
  name: string;
  isMuted: boolean;
}) {
  const className = cn(
    'truncate',
    isMuted ? 'text-muted-foreground' : 'font-medium'
  );
  if (!row.trace.some(entry => entry.step !== 'template')) {
    return (
      <p className={className} title={name}>
        {name}
      </p>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger render={<p className={className} />}>
        {name}
      </TooltipTrigger>
      <TooltipContent side="bottom" align="start" className="max-w-md">
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 wrap-anywhere">
          {row.trace.map(entry => (
            <TraceLine
              key={entry.number}
              label={`${entry.number}. ${stepTitles[entry.step]}`}
              text={entry.text}
            />
          ))}
          <TraceLine label="New name" text={name} />
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function TraceLine({label, text}: {label: string; text: string}) {
  return (
    <>
      <span className="opacity-60">{label}</span>
      <span>{text}</span>
    </>
  );
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
