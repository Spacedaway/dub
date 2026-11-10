import {toast} from 'sonner';

import {
  builtInDefaultTemplates,
  parseDefaultTemplates,
  readTemplateSources,
  sameTemplates,
  templateSources,
  type DefaultTemplates,
} from '@/domain/suggestions/default-templates';
import * as cache from '@/ipc/cache-db';
import {errorMessage} from '@/ipc/command-error';
import {useSession} from '@/store/session-store';

const defaultTemplatesSetting = 'defaultTemplates';

let persisting = Promise.resolve();

export async function loadDefaultTemplates(): Promise<void> {
  const before = useSession.getState().steps.defaultTemplates;
  let stored: DefaultTemplates | null = null;
  try {
    const value = await cache.readSetting(defaultTemplatesSetting);
    if (value === null) return;
    const sources = readTemplateSources(JSON.parse(value));
    stored = sources === null ? null : parseDefaultTemplates(sources);
    if (stored === null)
      console.warn('Ignored unreadable default templates', value);
  } catch (error) {
    console.warn("Couldn't read the default templates", error);
  }
  if (
    stored !== null &&
    useSession.getState().steps.defaultTemplates === before
  )
    useSession.getState().setDefaultTemplates(stored);
}

export async function saveDefaultTemplates(
  templates: DefaultTemplates
): Promise<void> {
  useSession.getState().setDefaultTemplates(templates);
  await persistDefaultTemplates(templates);
}

export async function persistDefaultTemplates(
  templates: DefaultTemplates
): Promise<void> {
  persisting = persisting.then(() => writeDefaultTemplates(templates));
  await persisting;
}

async function writeDefaultTemplates(
  templates: DefaultTemplates
): Promise<void> {
  try {
    if (sameTemplates(templates, builtInDefaultTemplates))
      await cache.deleteSetting(defaultTemplatesSetting);
    else
      await cache.writeSetting(
        defaultTemplatesSetting,
        JSON.stringify(templateSources(templates))
      );
  } catch (error) {
    toast.warning(
      `Couldn't save the default templates, so they only last until Dub restarts: ${errorMessage(error)}`
    );
  }
}
