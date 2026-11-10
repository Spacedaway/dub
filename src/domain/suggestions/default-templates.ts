import {isObject} from '@/domain/json/json-guards';
import {fileKinds, type FileKind} from '@/domain/suggestions/classify-file';
import {parseTemplate} from '@/domain/templates/parse-template';
import type {Template, TemplateParseResult} from '@/domain/templates/template';

export type DefaultTemplates = Record<FileKind, Template>;

export type TemplateSources = Record<FileKind, string>;

export type DefaultTemplateResult = TemplateParseResult | {kind: 'blank'};

export const builtInDefaultTemplates: DefaultTemplates = {
  tvEpisode: parsedDefault(
    '<Name> - S<Season:00>E<Episode:00>{ - <Episode Title>}'
  ),
  datedEpisode: parsedDefault('<Name> - <Air Date>{ - <Episode Title>}'),
  numberedEpisode: parsedDefault(
    '<Name> - Episode <Episode:00>{ - <Episode Title>}'
  ),
  film: parsedDefault('<Name> (<Year>)'),
  generic: parsedDefault('<Original>'),
};

export function parseDefaultTemplate(source: string): DefaultTemplateResult {
  return source.trim() === '' ? {kind: 'blank'} : parseTemplate(source);
}

export function parseDefaultTemplates(
  sources: TemplateSources
): DefaultTemplates | null {
  const templates = mapFileKinds(kind => {
    const result = parseDefaultTemplate(sources[kind]);
    return result.kind === 'parsed' ? result.template : null;
  });
  return isComplete(templates) ? templates : null;
}

export function readTemplateSources(value: unknown): TemplateSources | null {
  if (!isObject(value)) return null;
  const sources = mapFileKinds(kind => {
    const source = value[kind];
    return typeof source === 'string' ? source : null;
  });
  return isComplete(sources) ? sources : null;
}

export function templateSources(templates: DefaultTemplates): TemplateSources {
  return mapFileKinds(kind => templates[kind].source);
}

export function sameTemplates(
  left: DefaultTemplates,
  right: DefaultTemplates
): boolean {
  return fileKinds.every(kind => left[kind].source === right[kind].source);
}

function mapFileKinds<Value>(
  valueFor: (kind: FileKind) => Value
): Record<FileKind, Value> {
  return {
    tvEpisode: valueFor('tvEpisode'),
    datedEpisode: valueFor('datedEpisode'),
    numberedEpisode: valueFor('numberedEpisode'),
    film: valueFor('film'),
    generic: valueFor('generic'),
  };
}

function isComplete<Value>(
  record: Record<FileKind, Value | null>
): record is Record<FileKind, Value> {
  return fileKinds.every(kind => record[kind] !== null);
}

function parsedDefault(source: string): Template {
  const result = parseTemplate(source);
  if (result.kind === 'invalid')
    throw new Error(`Invalid default template: ${source}`);
  return result.template;
}
