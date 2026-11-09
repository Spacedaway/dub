import {useState} from 'react';
import {TriangleAlertIcon, XIcon} from 'lucide-react';

import {batchSummary} from '@/domain/history/batch-summary';
import {resumeBatch, undoBatch} from '@/store/session-actions';
import {useSession} from '@/store/session-store';
import {Button} from '@/ui/button';

export function BatchBanner() {
  const newestBatch = useSession(state => state.history.at(0));
  const isBusy = useSession(state => state.activity.kind !== 'idle');
  const [dismissedBatchId, setDismissedBatchId] = useState<string | null>(null);
  if (
    newestBatch === undefined ||
    !newestBatch.canResume ||
    newestBatch.batchId === dismissedBatchId
  )
    return null;

  const {batchId} = newestBatch;
  return (
    <section
      aria-label="Unfinished rename"
      className="flex shrink-0 items-center gap-3 border-b bg-muted/50 px-4 py-2">
      <TriangleAlertIcon className="size-4 shrink-0 text-warning" />
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="text-body">{batchSummary(newestBatch)}.</p>
        <p className="text-xs text-muted-foreground">
          {newestBatch.canUndo
            ? 'Resume renames the rest. Undo puts back the files already renamed.'
            : 'Resume renames the rest.'}
        </p>
      </div>
      <Button
        size="xs"
        disabled={isBusy}
        onClick={() => void resumeBatch(batchId)}>
        Resume
      </Button>
      {newestBatch.canUndo && (
        <Button
          variant="ghost"
          size="xs"
          disabled={isBusy}
          onClick={() => void undoBatch(batchId)}>
          Undo
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Dismiss"
        onClick={() => setDismissedBatchId(batchId)}>
        <XIcon />
      </Button>
    </section>
  );
}
