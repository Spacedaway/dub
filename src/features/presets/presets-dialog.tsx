import {useRef, useState, type FormEvent} from 'react';
import {Trash2Icon} from 'lucide-react';

import {presetKey, type Preset} from '@/domain/presets/preset';
import {plural} from '@/domain/text/plural';
import {applyPreset, deletePreset, savePreset} from '@/store/presets';
import {useSession} from '@/store/session-store';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/ui/alert-dialog';
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

type Replacement = {existing: Preset; incoming: Preset};

export function PresetsDialog({onClose}: {onClose: () => void}) {
  const presets = useSession(state => state.presets);
  const steps = useSession(state => state.steps);
  const [name, setName] = useState('');
  const [replacing, setReplacing] = useState<Replacement | null>(null);
  const [isReplaceOpen, setIsReplaceOpen] = useState(false);
  const [deleted, setDeleted] = useState<Preset | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);

  async function save(preset: Preset) {
    setDeleted(null);
    const saved = await savePreset(preset);
    const typed = nameInput.current?.value ?? '';
    if (saved && presetKey(typed) === presetKey(preset.name)) setName('');
  }

  function offer(incoming: Preset) {
    const existing = useSession
      .getState()
      .presets.find(
        saved => presetKey(saved.name) === presetKey(incoming.name)
      );
    if (existing === undefined) {
      void save(incoming);
    } else {
      setReplacing({existing, incoming});
      setIsReplaceOpen(true);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim() !== '') offer({...steps, name: name.trim()});
  }

  function confirmReplace() {
    if (replacing !== null) void save(replacing.incoming);
    setIsReplaceOpen(false);
  }

  async function restore(preset: Preset) {
    await save(preset);
    requestAnimationFrame(() => nameInput.current?.focus());
  }

  function apply(preset: Preset) {
    applyPreset(preset);
    onClose();
  }

  async function remove(preset: Preset, index: number) {
    if (!(await deletePreset(preset))) return;
    setDeleted(preset);
    requestAnimationFrame(() => {
      const buttons =
        list.current?.querySelectorAll<HTMLElement>('[data-apply]');
      const next = buttons?.[Math.min(index, buttons.length - 1)];
      (next ?? nameInput.current)?.focus();
    });
  }

  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open) onClose();
      }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Presets</DialogTitle>
          <DialogDescription>
            A preset keeps the default templates and every step, so you can
            switch between naming styles.
          </DialogDescription>
        </DialogHeader>
        {presets.length === 0 ? (
          <p className="text-sm text-muted-foreground">No presets yet.</p>
        ) : (
          <ul
            ref={list}
            aria-label="Saved presets"
            className="-mx-2 flex max-h-[50vh] flex-col overflow-y-auto">
            {presets.map((preset, index) => (
              <li
                key={presetKey(preset.name)}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm">{preset.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {presetSummary(preset)}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  data-apply
                  aria-label={`Apply ${preset.name}`}
                  onClick={() => apply(preset)}>
                  Apply
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete ${preset.name}`}
                  title="Delete"
                  onClick={() => void remove(preset, index)}>
                  <Trash2Icon />
                </Button>
              </li>
            ))}
          </ul>
        )}
        {deleted !== null && (
          <output className="flex items-center gap-2 text-sm text-muted-foreground">
            {`Deleted “${deleted.name}”.`}
            <Button
              variant="ghost"
              size="xs"
              onClick={() => void restore(deleted)}>
              Undo
            </Button>
          </output>
        )}
        <DialogFooter>
          <form onSubmit={submit} className="flex w-full gap-2">
            <Input
              ref={nameInput}
              value={name}
              onChange={event => setName(event.target.value)}
              placeholder="Name"
              aria-label="Preset name"
            />
            <Button type="submit" disabled={name.trim() === ''}>
              Save current
            </Button>
          </form>
        </DialogFooter>
        <AlertDialog
          open={isReplaceOpen}
          onOpenChange={setIsReplaceOpen}
          onOpenChangeComplete={open => {
            if (open) return;
            setReplacing(null);
            nameInput.current?.focus();
          }}>
          <AlertDialogContent size="sm">
            <AlertDialogHeader>
              <AlertDialogTitle>{`Replace “${replacing?.existing.name}”?`}</AlertDialogTitle>
              <AlertDialogDescription>
                The saved preset will hold the current default templates and
                steps instead.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={confirmReplace}>
                Replace
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

function presetSummary(preset: Preset): string {
  const template = !preset.template.enabled
    ? 'Original names'
    : preset.template.source.trim() === ''
      ? 'Suggested names'
      : preset.template.source;
  return preset.textSteps.length === 0
    ? template
    : `${template} · ${plural(preset.textSteps.length, 'more step')}`;
}
