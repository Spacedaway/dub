import {FilesIcon} from 'lucide-react';

import type {Preview} from '@/store/use-preview';
import {FileList} from '@/features/file-grid/file-list';

export function PreviewPane({preview}: {preview: Preview}) {
  const {rows, outcomes, livePlan, readyCount, blockedCount} = preview;

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-background">
      <header
        data-tauri-drag-region
        className="flex h-12 shrink-0 items-center justify-between border-b px-4">
        <h1 data-tauri-drag-region className="text-body font-semibold">
          Preview
        </h1>
        {rows.length > 0 && (
          <p
            data-tauri-drag-region
            className="text-xs text-muted-foreground tabular-nums">
            {readyCount} to rename
            {blockedCount > 0 && (
              <span className="text-destructive">
                {' '}
                · {blockedCount} can't be renamed
              </span>
            )}
          </p>
        )}
      </header>
      {rows.length === 0 ? (
        <EmptyState />
      ) : (
        <FileList rows={rows} outcomes={outcomes} livePlan={livePlan} />
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
