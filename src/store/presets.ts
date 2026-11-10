import {toast} from 'sonner';

import {compareNaturally} from '@/domain/files/natural-sort';
import {
  presetJson,
  presetKey,
  readPresetText,
  type Preset,
} from '@/domain/presets/preset';
import {sanitiseFileName} from '@/domain/sanitising/sanitise-file-name';
import type {StepSettings} from '@/domain/steps/step';
import * as cache from '@/ipc/cache-db';
import {errorMessage} from '@/ipc/command-error';
import * as commands from '@/ipc/commands';
import {persistDefaultTemplates} from '@/store/default-templates';
import {useSession} from '@/store/session-store';

const undoToastDuration = 10_000;

let latestLoad = 0;

export async function loadPresets(): Promise<void> {
  const load = ++latestLoad;
  try {
    const bodies = await cache.readPresetBodies();
    if (load !== latestLoad) return;
    useSession
      .getState()
      .setPresets(
        bodies
          .flatMap(readStoredPreset)
          .sort((left, right) => compareNaturally(left.name, right.name))
      );
  } catch (error) {
    toast.error(`Couldn't load the presets: ${errorMessage(error)}`);
  }
}

export async function savePreset(preset: Preset): Promise<boolean> {
  const result = readPresetText(JSON.stringify(presetJson(preset)));
  if (result.kind === 'invalid') {
    toast.error(`Couldn't save the preset. ${result.reason}`);
    return false;
  }
  try {
    await cache.writePreset(
      presetKey(result.preset.name),
      JSON.stringify(presetJson(result.preset))
    );
  } catch (error) {
    toast.error(`Couldn't save the preset: ${errorMessage(error)}`);
    return false;
  }
  await loadPresets();
  return true;
}

export async function deletePreset(preset: Preset): Promise<boolean> {
  try {
    await cache.deletePreset(presetKey(preset.name));
  } catch (error) {
    toast.error(`Couldn't delete the preset: ${errorMessage(error)}`);
    return false;
  }
  await loadPresets();
  return true;
}

export async function exportPreset(preset: Preset): Promise<void> {
  try {
    const exported = await commands.exportPreset(
      sanitiseFileName(preset.name, '.json') || 'Preset.json',
      `${JSON.stringify(presetJson(preset), null, 2)}\n`
    );
    if (exported) toast.success(`Exported “${preset.name}”`);
  } catch (error) {
    toast.error(`Couldn't export the preset: ${errorMessage(error)}`);
  }
}

export async function readPresetFile(): Promise<Preset | null> {
  let text: string | null;
  try {
    text = await commands.importPreset();
  } catch (error) {
    toast.error(`Couldn't import the preset: ${errorMessage(error)}`);
    return null;
  }
  if (text === null) return null;
  const result = readPresetText(text);
  if (result.kind === 'read') return result.preset;
  toast.error(`Couldn't import the preset. ${result.reason}`);
  return null;
}

export function applyPreset(preset: Preset): void {
  const previous = useSession.getState().steps;
  replaceSteps(preset);
  toast(`Applied “${preset.name}”`, {
    action: {label: 'Undo', onClick: () => replaceSteps(previous)},
    duration: undoToastDuration,
  });
}

function replaceSteps(settings: StepSettings): void {
  useSession.getState().replaceSteps(settings);
  void persistDefaultTemplates(settings.defaultTemplates);
}

function readStoredPreset(body: string): Array<Preset> {
  const result = readPresetText(body);
  if (result.kind === 'read') return [result.preset];
  console.warn('Skipped an unreadable preset', result.reason, body);
  return [];
}
