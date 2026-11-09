import {use, useRef, useState, type KeyboardEvent} from 'react';

import {newStem, type PreviewRow} from '@/domain/preview/build-preview';
import {GridActionsContext} from '@/features/file-grid/grid-context';

export function NameEditor({row}: {row: PreviewRow}) {
  const actions = use(GridActionsContext);
  const [startingStem] = useState(() => newStem(row));
  const [draft, setDraft] = useState(startingStem);
  const isFinished = useRef(false);

  function finish(save: boolean, returnFocus: boolean) {
    if (isFinished.current) return;
    isFinished.current = true;
    actions?.finishEditing(
      row.file.path,
      save && draft !== startingStem ? draft : null,
      returnFocus
    );
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // WebKit sends the Enter that ends an IME composition after compositionend, with keyCode 229.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      finish(true, true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      finish(false, true);
    }
  }

  return (
    <div className="-mx-1.5 flex h-6 min-w-0 items-center rounded-md bg-background px-1.5 ring-2 ring-ring/60">
      <input
        ref={focusAndSelect}
        value={draft}
        aria-label="New name"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        className="min-w-0 flex-1 bg-transparent font-medium outline-none select-text"
        onChange={event => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => finish(true, false)}
      />
      <span className="shrink-0 text-muted-foreground">
        {row.file.extension}
      </span>
    </div>
  );
}

function focusAndSelect(input: HTMLInputElement | null) {
  input?.focus({preventScroll: true});
  input?.select();
}
