import {useSession} from '@/store/session-store';
import {usePreview} from '@/store/use-preview';
import {PreviewPane} from '@/features/file-grid/preview-pane';
import {Sidebar} from '@/features/sidebar/sidebar';

export function App() {
  const preview = usePreview();
  const isDraggingOver = useSession(state => state.isDraggingOver);

  return (
    <div className="flex h-full">
      <Sidebar preview={preview} />
      <PreviewPane preview={preview} />
      {isDraggingOver && <DropOverlay />}
    </div>
  );
}

function DropOverlay() {
  return (
    <div className="pointer-events-none fixed inset-2 z-50 flex items-center justify-center rounded-xl border-2 border-dashed border-primary/50 bg-background/70 backdrop-blur-sm">
      <p className="text-sm font-medium">Drop to add</p>
    </div>
  );
}
