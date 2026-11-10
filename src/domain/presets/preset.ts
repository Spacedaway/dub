import {
  isObject,
  isWholeNumber,
  type JsonObject,
} from '@/domain/json/json-guards';
import {
  nameEnds,
  textStepKinds,
  textStepNumber,
  trimEnds,
  type StepSettings,
  type TemplateStep,
  type TextStepSettings,
} from '@/domain/steps/step';
import {fileKinds} from '@/domain/suggestions/classify-file';
import {
  parseDefaultTemplates,
  readTemplateSources,
  templateSources,
} from '@/domain/suggestions/default-templates';
import {letterCaseStyles} from '@/domain/text/letter-case';

export type Preset = StepSettings & {name: string};

export type PresetReadResult =
  | {kind: 'read'; preset: Preset}
  | {kind: 'invalid'; reason: string};

const presetFormat = 'dub-preset';
const presetVersion = 1;
const maxTextSteps = 100;
const maxTextLength = 1000;
const loneSurrogate = /\p{Cs}/u;

export function presetKey(name: string): string {
  return name.normalize('NFC').replace(/\s+/gu, ' ').trim().toLowerCase();
}

export function presetJson(preset: Preset): JsonObject {
  return {
    format: presetFormat,
    version: presetVersion,
    name: preset.name,
    defaultTemplates: templateSources(preset.defaultTemplates),
    template: {
      source: preset.template.source,
      enabled: preset.template.enabled,
    },
    textSteps: preset.textSteps.map(textStepJson),
  };
}

export function readPresetText(text: string): PresetReadResult {
  let value: unknown;
  try {
    value = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return invalid("This isn't a Dub preset.");
  }
  return readPreset(value);
}

export function readPreset(value: unknown): PresetReadResult {
  if (!isObject(value) || value.format !== presetFormat)
    return invalid("This isn't a Dub preset.");
  if (value.version !== presetVersion)
    return invalid(
      isWholeNumber(value.version) && value.version > presetVersion
        ? 'This preset needs a newer version of Dub.'
        : "This preset's version isn't one Dub knows."
    );
  if (typeof value.name !== 'string' || value.name.trim() === '')
    return invalid('The preset needs a name.');
  const name = value.name.trim();

  const sources = readTemplateSources(value.defaultTemplates);
  if (sources === null)
    return invalid("The preset's default templates are unreadable.");
  const template = readTemplateStep(value.template);
  if (template === null)
    return invalid("The preset's Template step is unreadable.");
  if (!Array.isArray(value.textSteps))
    return invalid("The preset's steps are unreadable.");
  if (value.textSteps.length > maxTextSteps)
    return invalid(`A preset can hold at most ${maxTextSteps} steps.`);
  const textSteps: Array<TextStepSettings> = [];
  for (const [index, item] of value.textSteps.entries()) {
    const step = readTextStep(item);
    if (step === null)
      return invalid(
        `Step ${textStepNumber(index)} has a setting Dub can't use.`
      );
    textSteps.push(step);
  }

  const texts = [
    name,
    ...fileKinds.map(kind => sources[kind]),
    template.source,
    ...textSteps.flatMap(textStepTexts),
  ];
  const problem = texts.map(textProblem).find(reason => reason !== null);
  if (problem !== undefined) return invalid(problem);

  const defaultTemplates = parseDefaultTemplates(sources);
  if (defaultTemplates === null)
    return invalid('A default template in the preset is empty or invalid.');
  return {
    kind: 'read',
    preset: {name, defaultTemplates, template, textSteps},
  };
}

function invalid(reason: string): PresetReadResult {
  return {kind: 'invalid', reason};
}

function textProblem(text: string): string | null {
  if (text.length > maxTextLength)
    return `Text in a preset can be at most ${maxTextLength.toLocaleString('en-GB')} characters.`;
  if (loneSurrogate.test(text))
    return "The preset has text that isn't valid Unicode.";
  return null;
}

function readTemplateStep(value: unknown): TemplateStep | null {
  if (!isObject(value)) return null;
  const {source, enabled} = value;
  return typeof source === 'string' && typeof enabled === 'boolean'
    ? {source, enabled}
    : null;
}

function readTextStep(value: unknown): TextStepSettings | null {
  if (!isObject(value)) return null;
  const {kind, enabled} = value;
  if (typeof enabled !== 'boolean' || !isOneOf(textStepKinds, kind))
    return null;
  switch (kind) {
    case 'replace': {
      const {find, replacement, regularExpression, matchCase} = value;
      return typeof find === 'string' &&
        typeof replacement === 'string' &&
        typeof regularExpression === 'boolean' &&
        typeof matchCase === 'boolean'
        ? {kind, enabled, find, replacement, regularExpression, matchCase}
        : null;
    }
    case 'case': {
      const {style} = value;
      return isOneOf(letterCaseStyles, style) ? {kind, enabled, style} : null;
    }
    case 'trim': {
      const {characters, ends} = value;
      return typeof characters === 'string' && isOneOf(trimEnds, ends)
        ? {kind, enabled, characters, ends}
        : null;
    }
    case 'remove': {
      const {count, position, from} = value;
      return isCount(count) && isCount(position) && isOneOf(nameEnds, from)
        ? {kind, enabled, count, position, from}
        : null;
    }
  }
}

function textStepJson(step: TextStepSettings): JsonObject {
  switch (step.kind) {
    case 'replace':
      return {
        kind: step.kind,
        enabled: step.enabled,
        find: step.find,
        replacement: step.replacement,
        regularExpression: step.regularExpression,
        matchCase: step.matchCase,
      };
    case 'case':
      return {kind: step.kind, enabled: step.enabled, style: step.style};
    case 'trim':
      return {
        kind: step.kind,
        enabled: step.enabled,
        characters: step.characters,
        ends: step.ends,
      };
    case 'remove':
      return {
        kind: step.kind,
        enabled: step.enabled,
        count: step.count,
        position: step.position,
        from: step.from,
      };
  }
}

function textStepTexts(step: TextStepSettings): Array<string> {
  switch (step.kind) {
    case 'replace':
      return [step.find, step.replacement];
    case 'trim':
      return [step.characters];
    case 'case':
    case 'remove':
      return [];
  }
}

function isOneOf<Value extends string>(
  choices: ReadonlyArray<Value>,
  value: unknown
): value is Value {
  return choices.some(choice => choice === value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}
