import {
  createContext,
  use,
  type PropsWithChildren,
  type ReactNode,
} from 'react';
import {
  createColumnHelper,
  createExpandedRowModel,
  metaHelper,
  rowExpandingFeature,
  tableFeatures,
} from '@tanstack/react-table';
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
import {runEnds} from '@/domain/templates/render-template';
import type {ScannedFile} from '@/ipc/contracts';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/ui/tooltip';
import type {RowStatus} from '@/features/file-grid/row-status';
import {stepTitles} from '@/features/step-editor/step-titles';

type RowCellProps = {row: PreviewRow; status: RowStatus};

export const PreviewRowContext = createContext<RowCellProps | null>(null);

export const gridFeatures = tableFeatures({
  rowExpandingFeature,
  expandedRowModel: createExpandedRowModel(),
  columnMeta: metaHelper<{width: string}>(),
});

const kindLabels: Record<FileKind, string | null> = {
  tvEpisode: 'TV',
  datedEpisode: 'Dated',
  numberedEpisode: 'Numbered',
  film: 'Film',
  generic: null,
};

const column = createColumnHelper<typeof gridFeatures, ScannedFile>();

export const gridColumns = column.columns([
  column.display({
    id: 'status',
    header: () => <span className="sr-only">Status</span>,
    cell: withPreviewRow(StatusCell),
    meta: {width: '1.25rem'},
  }),
  column.display({
    id: 'original',
    header: 'Original',
    cell: withPreviewRow(OriginalCell),
    meta: {width: 'minmax(0,1fr)'},
  }),
  column.display({
    id: 'arrow',
    cell: withPreviewRow(ArrowCell),
    meta: {width: '1rem'},
  }),
  column.display({
    id: 'newName',
    header: 'New name',
    cell: withPreviewRow(NewNameCell),
    meta: {width: 'minmax(0,1fr)'},
  }),
  column.display({
    id: 'kind',
    header: 'Kind',
    cell: withPreviewRow(KindCell),
    meta: {width: '4.5rem'},
  }),
  column.display({
    id: 'folder',
    header: 'Folder',
    cell: withPreviewRow(FolderCell),
    meta: {width: 'minmax(0,12rem)'},
  }),
]);

export const gridTemplateColumns = gridColumns
  .map(definition => definition.meta?.width)
  .join(' ');

function withPreviewRow(Cell: (props: RowCellProps) => ReactNode) {
  return function PreviewRowCell() {
    const props = use(PreviewRowContext);
    return props === null ? null : <Cell {...props} />;
  };
}

function StatusCell({status}: RowCellProps) {
  switch (status.kind) {
    case 'unchanged':
      return status.warnings.length === 0 ? null : (
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

function OriginalCell({row}: RowCellProps) {
  return (
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
        <DetectedSummary parsed={row.parsed} />
      </div>
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

function ArrowCell({status}: RowCellProps) {
  return (
    <ArrowRightIcon
      className={cn(
        'size-3.5 text-muted-foreground',
        status.kind === 'unchanged' && 'opacity-30'
      )}
    />
  );
}

function NewNameCell({row, status}: RowCellProps) {
  const name =
    row.proposal.kind === 'renamed' ? row.proposal.name : row.file.name;
  const className = cn(
    'truncate',
    status.kind === 'unchanged' ? 'text-muted-foreground' : 'font-medium'
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

function KindCell({row}: RowCellProps) {
  return (
    <p className="truncate text-xs text-muted-foreground">
      {kindLabels[row.kind]}
    </p>
  );
}

function FolderCell({row}: RowCellProps) {
  return (
    <p
      className="truncate text-xs text-muted-foreground"
      title={row.file.directory}>
      {row.file.folderName}
    </p>
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
