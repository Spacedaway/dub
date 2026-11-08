import {useState} from 'react';
import {cn} from 'cn';
import {SearchIcon} from 'lucide-react';

import {baseName} from '@/domain/files/base-name';
import type {GroupView} from '@/domain/lookups/derive-lookups';
import {premiereYear, type TvShow} from '@/domain/lookups/tvmaze';
import {errorMessage} from '@/ipc/command-error';
import {chooseShow, declineShow, searchShows} from '@/store/lookups';
import {Button} from '@/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';
import {Input} from '@/ui/input';

type Search =
  | {kind: 'idle'}
  | {kind: 'searching'}
  | {kind: 'failed'; message: string};

export function ShowPicker({
  view,
  onClose,
}: {
  view: GroupView;
  onClose: () => void;
}) {
  const {group} = view;
  const [query, setQuery] = useState(group.query);
  const [candidates, setCandidates] = useState(() => knownCandidates(view));
  const [selectedId, setSelectedId] = useState(() => knownChoice(view));
  const [search, setSearch] = useState<Search>({kind: 'idle'});
  const selected = candidates.find(show => show.id === selectedId) ?? null;
  const fileCount = `${group.members.length} ${group.members.length === 1 ? 'file' : 'files'}`;

  async function runSearch(event: React.FormEvent) {
    event.preventDefault();
    const wanted = query.trim();
    if (wanted === '') return;
    setSearch({kind: 'searching'});
    try {
      const found = await searchShows(wanted);
      setCandidates(found);
      setSelectedId(found.length === 1 ? (found[0]?.id ?? null) : null);
      setSearch({kind: 'idle'});
    } catch (error) {
      setSearch({kind: 'failed', message: errorMessage(error)});
    }
  }

  function use(show: TvShow) {
    void chooseShow(group, show, candidates);
    onClose();
  }

  function decline() {
    void declineShow(group);
    onClose();
  }

  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open) onClose();
      }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Choose a show</DialogTitle>
          <DialogDescription>
            {`${fileCount} named “${group.query}” in ${baseName(group.showFolder)}.`}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={runSearch} className="flex gap-2">
          <Input
            value={query}
            onChange={event => setQuery(event.target.value)}
            aria-label="Show name"
          />
          <Button
            type="submit"
            variant="outline"
            disabled={search.kind === 'searching'}>
            <SearchIcon /> Search
          </Button>
        </form>
        <ul
          aria-label="Shows on TVmaze"
          className="-mx-2 flex max-h-72 flex-col overflow-y-auto">
          {candidates.map(show => (
            <li key={show.id}>
              <button
                type="button"
                aria-pressed={show.id === selectedId}
                onClick={() => setSelectedId(show.id)}
                onDoubleClick={() => use(show)}
                className={cn(
                  'flex w-full flex-col rounded-md px-2 py-1.5 text-left',
                  show.id === selectedId
                    ? 'bg-accent text-accent-foreground'
                    : 'hover:bg-muted'
                )}>
                <span className="text-sm">{show.name}</span>
                <span className="text-xs text-muted-foreground">
                  {showDetails(show)}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <SearchMessage search={search} isEmpty={candidates.length === 0} />
        <DialogFooter>
          <Button variant="ghost" onClick={decline}>
            Don’t look this up
          </Button>
          <Button
            disabled={selected === null}
            onClick={() => selected && use(selected)}>
            Use this show
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SearchMessage({search, isEmpty}: {search: Search; isEmpty: boolean}) {
  switch (search.kind) {
    case 'searching':
      return <p className="text-sm text-muted-foreground">Searching TVmaze…</p>;
    case 'failed':
      return (
        <p className="text-sm text-destructive">
          Couldn’t search TVmaze: {search.message}
        </p>
      );
    case 'idle':
      return isEmpty ? (
        <p className="text-sm text-muted-foreground">
          No shows yet. Edit the name and search.
        </p>
      ) : null;
  }
}

function knownCandidates({status}: GroupView): Array<TvShow> {
  switch (status.kind) {
    case 'unsure':
      return status.candidates;
    case 'matched':
      return [status.listing.show];
    case 'pending':
    case 'notFound':
    case 'declined':
    case 'failed':
      return [];
  }
}

function knownChoice({status}: GroupView): number | null {
  switch (status.kind) {
    case 'unsure':
      return status.suggested?.id ?? null;
    case 'matched':
      return status.listing.show.id;
    case 'pending':
    case 'notFound':
    case 'declined':
    case 'failed':
      return null;
  }
}

function showDetails(show: TvShow): string {
  const details = [
    premiereYear(show)?.toString() ?? 'Not aired yet',
    show.network,
    show.country,
    show.status,
  ];
  return details.filter(detail => detail !== null).join(' · ');
}
