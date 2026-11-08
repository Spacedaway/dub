import {getCurrentWebview} from '@tauri-apps/api/webview';

type FileDropHandlers = {
  onDraggingOverChange: (isDraggingOver: boolean) => void;
  onDrop: (paths: Array<string>) => void;
};

export function followFileDrops({
  onDraggingOverChange,
  onDrop,
}: FileDropHandlers): void {
  void getCurrentWebview().onDragDropEvent(({payload}) => {
    onDraggingOverChange(payload.type === 'enter' || payload.type === 'over');
    if (payload.type === 'drop' && payload.paths.length > 0) {
      onDrop(payload.paths);
    }
  });
}
