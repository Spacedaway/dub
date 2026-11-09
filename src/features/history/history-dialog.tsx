import {useId, useState} from 'react';
import {cn} from 'cn';
import {ChevronRightIcon} from 'lucide-react';

import {
  batchSummary,
  batchTime,
  type BatchRow,
  type BatchRowState,
} from '@/domain/history/batch-summary';
import {errorMessage} from '@/ipc/command-error';
import type {JournalEntry} from '@/ipc/contracts';
import {loadBatchRows, resumeBatch, undoBatch} from '@/store/session-actions';
import {useSession} from '@/store/session-store';
import {Button} from '@/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';

type Files =
  | {kind: 'hidden'}
  | {kind: 'loading'}
  | {kind: 'shown'; rows: Array<BatchRow>}
  | {kind: 'failed'; message: string};

export function HistoryDialog({onClose}: {onClose: () => void}) {
  const history = useSession(state => state.history);
  const isBusy = useSession(state => state.activity.kind !== 'idle');

  function start(action: (batchId: string) => Promise<void>, batchId: string) {
    onClose();
    void action(batchId);
  }

  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open) onClose();
      }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Rename history</DialogTitle>
          <DialogDescription>
            Undo any batch, or resume one that stopped part-way. Files that have
            changed since are left alone.
          </DialogDescription>
        </DialogHeader>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing has been renamed yet.
          </p>
        ) : (
          <ul
            aria-label="Batches, newest first"
            className="-mx-2 flex max-h-[60vh] flex-col overflow-y-auto">
            {history.map(entry => (
              <BatchItem
                key={entry.batchId}
                entry={entry}
                isBusy={isBusy}
                onUndo={() => start(undoBatch, entry.batchId)}
                onResume={() => start(resumeBatch, entry.batchId)}
              />
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

function BatchItem({
  entry,
  isBusy,
  onUndo,
  onResume,
}: {
  entry: JournalEntry;
  isBusy: boolean;
  onUndo: () => void;
  onResume: () => void;
}) {
  const [files, setFiles] = useState<Files>({kind: 'hidden'});
  const isOpen = files.kind !== 'hidden';
  const summaryId = useId();

  async function toggleFiles() {
    if (isOpen) {
      setFiles({kind: 'hidden'});
      return;
    }
    setFiles({kind: 'loading'});
    let loaded: Files;
    try {
      loaded = {kind: 'shown', rows: await loadBatchRows(entry.batchId)};
    } catch (error) {
      loaded = {kind: 'failed', message: errorMessage(error)};
    }
    setFiles(current => (current.kind === 'loading' ? loaded : current));
  }

  return (
    <li className="flex flex-col gap-2 rounded-md px-2 py-2">
      <div className="flex items-start gap-2">
        <button
          type="button"
          aria-expanded={isOpen}
          onClick={() => void toggleFiles()}
          className="flex min-w-0 flex-1 items-start gap-1.5 text-left">
          <ChevronRightIcon
            className={cn(
              'mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform',
              isOpen && 'rotate-90'
            )}
          />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span id={summaryId} className="text-sm">
              {batchSummary(entry)}
            </span>
            <span className="text-xs text-muted-foreground">
              {[batchTime(entry), ...entry.drives].join(' · ')}
            </span>
          </span>
        </button>
        {entry.canResume && (
          <Button
            variant="outline"
            size="xs"
            disabled={isBusy}
            aria-describedby={summaryId}
            onClick={onResume}>
            Resume
          </Button>
        )}
        {entry.canUndo && (
          <Button
            variant="ghost"
            size="xs"
            disabled={isBusy}
            aria-describedby={summaryId}
            onClick={onUndo}>
            Undo
          </Button>
        )}
      </div>
      <BatchFiles files={files} />
    </li>
  );
}

function BatchFiles({files}: {files: Files}) {
  switch (files.kind) {
    case 'hidden':
      return null;
    case 'loading':
      return <p className="pl-5.5 text-xs text-muted-foreground">Loading…</p>;
    case 'failed':
      return (
        <p className="pl-5.5 text-xs text-destructive">
          Couldn’t read this batch: {files.message}
        </p>
      );
    case 'shown':
      return (
        <ul className="ml-5.5 flex max-h-64 flex-col gap-1.5 overflow-y-auto text-xs">
          {files.rows.map(row => (
            <li key={row.rowId} title={row.folder} className="flex flex-col">
              <span className="truncate text-muted-foreground">
                {row.oldName}
              </span>
              <span className="flex min-w-0 gap-1">
                <span className="truncate">→ {row.newName}</span>
                {row.state !== 'renamed' && (
                  <span className="shrink-0 text-muted-foreground">
                    · {stateLabel(row.state)}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      );
  }
}

function stateLabel(state: Exclude<BatchRowState, 'renamed'>): string {
  switch (state) {
    case 'undone':
      return 'undone';
    case 'notRenamed':
      return 'not renamed';
    case 'failed':
      return 'failed';
    case 'unfinished':
      return 'unfinished';
  }
}
