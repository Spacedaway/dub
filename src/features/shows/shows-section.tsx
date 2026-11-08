import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleMinusIcon,
  LoaderCircleIcon,
  TriangleAlertIcon,
} from 'lucide-react';

import type {GroupView, Lookups} from '@/domain/lookups/derive-lookups';
import type {GroupStatus} from '@/domain/lookups/group-status';
import {premiereYear, type TvShow} from '@/domain/lookups/tvmaze';
import {chooseShow, retryLookup} from '@/store/lookups';
import {useSession} from '@/store/session-store';
import {Button} from '@/ui/button';
import {SectionHeading} from '@/features/sidebar/section-heading';

export function ShowsSection({lookups}: {lookups: Lookups}) {
  const names = lookups.groups.map(view => displayName(view));
  const repeatedNames = new Set(
    names.filter((name, index) => names.indexOf(name) !== index)
  );

  return (
    <section className="flex min-h-0 flex-col gap-2 px-4 pb-5">
      <SectionHeading>Shows</SectionHeading>
      <p className="text-body text-sidebar-foreground">
        {summary(lookups.groups)}
      </p>
      <ul className="-mx-1 flex max-h-48 flex-col overflow-y-auto px-1">
        {lookups.groups.map(view => (
          <ShowRow
            key={view.group.key}
            view={view}
            showFolder={repeatedNames.has(displayName(view))}
          />
        ))}
      </ul>
      <p className="text-caption text-muted-foreground">
        TV data from TVmaze.com
      </p>
    </section>
  );
}

function ShowRow({view, showFolder}: {view: GroupView; showFolder: boolean}) {
  const {group, status} = view;
  const isBusy = useSession(state => state.activity.kind !== 'idle');
  const fileCount = `${group.members.length} ${group.members.length === 1 ? 'file' : 'files'}`;
  const details = [
    fileCount,
    statusText(status),
    ...(showFolder ? [folderName(group.showFolder)] : []),
  ].join(' · ');

  return (
    <li className="flex min-h-9 items-center gap-2 py-1">
      <StatusIcon status={status} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body" title={displayName(view)}>
          {displayName(view)}
        </span>
        <span
          className="truncate text-caption text-muted-foreground"
          title={status.kind === 'failed' ? status.message : group.showFolder}>
          {details}
        </span>
      </div>
      {status.kind === 'unsure' && status.suggested !== null && (
        <Button
          variant="outline"
          size="xs"
          disabled={isBusy}
          title={`Use ${showLabel(status.suggested)}`}
          onClick={() =>
            status.suggested &&
            chooseShow(group, status.suggested, status.candidates)
          }>
          Use
        </Button>
      )}
      {status.kind === 'failed' && (
        <Button
          variant="outline"
          size="xs"
          disabled={isBusy}
          onClick={() => retryLookup(group)}>
          Retry
        </Button>
      )}
    </li>
  );
}

function StatusIcon({status}: {status: GroupStatus}) {
  switch (status.kind) {
    case 'pending':
      return (
        <LoaderCircleIcon
          className="size-4 shrink-0 animate-spin text-muted-foreground"
          aria-label="Looking up"
        />
      );
    case 'matched':
      return (
        <CircleCheckIcon
          className="size-4 shrink-0 text-success"
          aria-label="Matched"
        />
      );
    case 'unsure':
      return (
        <TriangleAlertIcon
          className="size-4 shrink-0 text-warning"
          aria-label="Needs a choice"
        />
      );
    case 'failed':
      return (
        <CircleAlertIcon
          className="size-4 shrink-0 text-destructive"
          aria-label="Couldn't reach TVmaze"
        />
      );
    case 'notFound':
    case 'declined':
      return (
        <CircleMinusIcon
          className="size-4 shrink-0 text-muted-foreground"
          aria-label="No match"
        />
      );
  }
}

function displayName({group, status}: GroupView): string {
  if (status.kind !== 'matched') return group.query;
  return status.namesakes
    ? showLabel(status.listing.show)
    : status.listing.show.name;
}

function showLabel(show: TvShow): string {
  const year = premiereYear(show);
  return year === null ? show.name : `${show.name} (${year})`;
}

function statusText(status: GroupStatus): string {
  switch (status.kind) {
    case 'pending':
      return 'Looking up…';
    case 'matched':
      return status.how === 'remembered' ? 'Remembered' : 'Matched';
    case 'unsure':
      return 'Needs a choice';
    case 'notFound':
      return 'Not found on TVmaze';
    case 'declined':
      return 'Not looked up';
    case 'failed':
      return "Couldn't reach TVmaze";
  }
}

function summary(groups: Array<GroupView>): string {
  function count(kind: GroupStatus['kind']): number {
    return groups.filter(({status}) => status.kind === kind).length;
  }
  const parts = [
    [count('matched'), 'matched'],
    [
      count('unsure'),
      count('unsure') === 1 ? 'needs a choice' : 'need a choice',
    ],
    [count('pending'), 'looking up'],
    [count('failed'), 'failed'],
  ] as const;
  const described = parts
    .filter(([number]) => number > 0)
    .map(([number, label]) => `${number} ${label}`);
  return described.length === 0
    ? `${groups.length} ${groups.length === 1 ? 'show' : 'shows'}`
    : described.join(' · ');
}

function folderName(path: string): string {
  return path.split(/[\\/]/).at(-1) ?? path;
}
