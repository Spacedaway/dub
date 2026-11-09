import {FilesIcon, RotateCcwIcon} from 'lucide-react';

import {useSession} from '@/store/session-store';
import type {Preview} from '@/store/use-preview';
import {Button} from '@/ui/button';
import {FileGrid} from '@/features/file-grid/file-grid';
import {BatchBanner} from '@/features/history/batch-banner';

export function PreviewPane({preview}: {preview: Preview}) {
  const {
    rows,
    flags,
    outcomes,
    livePlan,
    readyCount,
    blockedCount,
    excludedCount,
    editCount,
  } = preview;
  const resetNameOverrides = useSession(state => state.resetNameOverrides);

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-background">
      <header
        data-tauri-drag-region
        className="flex h-12 shrink-0 items-center justify-between border-b px-4">
        <h1 data-tauri-drag-region className="text-body font-semibold">
          Preview
        </h1>
        {rows.length > 0 && (
          <div className="flex items-center gap-3">
            {editCount > 0 && (
              <Button variant="ghost" size="xs" onClick={resetNameOverrides}>
                <RotateCcwIcon />
                Reset {editCount} {editCount === 1 ? 'edit' : 'edits'}
              </Button>
            )}
            <p
              data-tauri-drag-region
              className="text-xs text-muted-foreground tabular-nums">
              {readyCount} to rename
              {excludedCount > 0 && ` · ${excludedCount} excluded`}
              {blockedCount > 0 && (
                <span className="text-destructive">
                  {' '}
                  · {blockedCount} can't be renamed
                </span>
              )}
            </p>
          </div>
        )}
      </header>
      <BatchBanner />
      {rows.length === 0 ? (
        <EmptyState />
      ) : (
        <FileGrid
          rows={rows}
          flags={flags}
          outcomes={outcomes}
          livePlan={livePlan}
        />
      )}
    </main>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
      <FilesIcon className="size-10 stroke-1" />
      <div className="flex flex-col gap-1">
        <p className="text-body font-medium text-foreground">
          Drop files or folders here
        </p>
        <p className="text-xs">
          Folders are searched all the way down. Nothing changes until you press
          Rename.
        </p>
      </div>
    </div>
  );
}
