import {FilePlusIcon, FolderPlusIcon, RotateCcwIcon, XIcon} from 'lucide-react';

import {pickFiles, pickFolders} from '@/ipc/dialogs';
import {
  addPaths,
  applyPlan,
  clearFiles,
  undoLatestBatch,
} from '@/store/session-actions';
import {useSession} from '@/store/session-store';
import type {Preview} from '@/store/use-preview';
import {Button} from '@/ui/button';
import {TemplateField} from '@/features/step-editor/template-field';

export function Sidebar({preview}: {preview: Preview}) {
  const {nameSource, counterIgnoresEpisodes, readyPlan, readyCount} = preview;
  const files = useSession(state => state.files);
  const templateSource = useSession(state => state.templateSource);
  const setTemplateSource = useSession(state => state.setTemplateSource);
  const activity = useSession(state => state.activity);
  const undoableBatchId = useSession(state => state.undoableBatchId);

  const isBusy = activity.kind !== 'idle';
  const folderCount = new Set(files.map(file => file.directory)).size;

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-sidebar-border bg-sidebar platform-macos:bg-transparent">
      <div data-tauri-drag-region className="h-12 shrink-0" />

      <section className="flex flex-col gap-2 px-4 pb-5">
        <SectionHeading>Files</SectionHeading>
        <p className="text-body text-sidebar-foreground">
          {files.length === 0
            ? 'None yet. Drop files or folders anywhere.'
            : `${files.length} ${files.length === 1 ? 'file' : 'files'} in ${folderCount} ${folderCount === 1 ? 'folder' : 'folders'}`}
        </p>
        <div className="flex gap-1.5">
          <Button
            variant="outline"
            size="sm"
            disabled={isBusy}
            onClick={async () => addPaths(await pickFiles())}>
            <FilePlusIcon /> Add files…
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={isBusy}
            onClick={async () => addPaths(await pickFolders())}>
            <FolderPlusIcon /> Add folder…
          </Button>
          {files.length > 0 && (
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={isBusy}
              onClick={clearFiles}
              aria-label="Clear the list">
              <XIcon />
            </Button>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-2 px-4">
        <SectionHeading>Rename to</SectionHeading>
        <TemplateField
          source={templateSource}
          nameSource={nameSource}
          counterIgnoresEpisodes={counterIgnoresEpisodes}
          onChange={setTemplateSource}
        />
      </section>

      <div className="flex-1" />

      <footer className="flex flex-col gap-2 border-t border-sidebar-border p-4">
        {activity.kind === 'running' && (
          <Progress
            completed={activity.completedSteps}
            total={activity.totalSteps}
            label={activity.batch === 'rename' ? 'Renaming' : 'Undoing'}
          />
        )}
        <Button
          size="lg"
          disabled={isBusy || readyPlan === null || readyCount === 0}
          onClick={() => readyPlan && applyPlan(readyPlan)}>
          {readyCount === 0
            ? 'Nothing to rename'
            : `Rename ${readyCount} ${readyCount === 1 ? 'file' : 'files'}`}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={isBusy || undoableBatchId === null}
          onClick={undoLatestBatch}>
          <RotateCcwIcon /> Undo last rename
        </Button>
      </footer>
    </aside>
  );
}

function SectionHeading({children}: {children: React.ReactNode}) {
  return (
    <h2 className="text-caption font-semibold tracking-wide text-muted-foreground uppercase">
      {children}
    </h2>
  );
}

function Progress({
  completed,
  total,
  label,
}: {
  completed: number;
  total: number;
  label: string;
}) {
  const percentage = total === 0 ? 0 : Math.round((completed / total) * 100);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{label}…</span>
        <span className="tabular-nums">
          {completed} of {total}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-primary transition-[width]"
          style={{width: `${percentage}%`}}
        />
      </div>
    </div>
  );
}
