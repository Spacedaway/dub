import type {FileKind} from '@/domain/suggestions/classify-file';
import {parseTemplate} from '@/domain/templates/parse-template';
import type {Template} from '@/domain/templates/template';

export const defaultTemplates: Record<FileKind, Template> = {
  tvEpisode: parsedDefault(
    '<Name> - S<Season:00>E<Episode:00>{ - <Episode Title>}'
  ),
  datedEpisode: parsedDefault('<Name> - <Air Date>{ - <Episode Title>}'),
  numberedEpisode: parsedDefault('<Name> - Episode <Episode:00>'),
  film: parsedDefault('<Name> (<Year>)'),
  generic: parsedDefault('<Original>'),
};

function parsedDefault(source: string): Template {
  const result = parseTemplate(source);
  if (result.kind === 'invalid')
    throw new Error(`Invalid default template: ${source}`);
  return result.template;
}
