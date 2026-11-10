import {
  textStepNumber,
  type NameEnd,
  type Steps,
  type TextStep,
  type TrimEnds,
} from '@/domain/steps/step';
import type {DefaultTemplates} from '@/domain/suggestions/default-templates';
import {parseTemplate} from '@/domain/templates/parse-template';
import type {Template, TemplateParseResult} from '@/domain/templates/template';
import {splitGraphemes} from '@/domain/text/graphemes';
import type {LetterCaseStyle} from '@/domain/text/letter-case';

export type NameSource = {kind: 'suggested'} | TemplateParseResult;

export type NameStart =
  | {kind: 'suggested'; templates: DefaultTemplates}
  | {kind: 'template'; template: Template}
  | {kind: 'original'};

export type CompiledTextStep = {number: number} & (
  | {kind: 'replace'; pattern: RegExp; replacement: string; literal: boolean}
  | {kind: 'case'; style: LetterCaseStyle}
  | {kind: 'trim'; characters: ReadonlySet<string>; ends: TrimEnds}
  | {kind: 'remove'; count: number; position: number; from: NameEnd}
);

export type StepPipeline =
  | {kind: 'ready'; start: NameStart; textSteps: Array<CompiledTextStep>}
  | {kind: 'invalid'};

export type CompiledSteps = {
  template: NameSource;
  pipeline: StepPipeline;
  patternErrors: ReadonlyMap<string, string>;
};

type TextStepResult =
  | {kind: 'compiled'; step: CompiledTextStep}
  | {kind: 'inert'}
  | {kind: 'invalid'; reason: string};

export function compileSteps(steps: Steps): CompiledSteps {
  const template = nameSourceFor(steps.template.source);
  const patternErrors = new Map<string, string>();
  const textSteps: Array<CompiledTextStep> = [];
  let isInvalid = steps.template.enabled && template.kind === 'invalid';

  steps.textSteps.forEach((step, index) => {
    const result = compileTextStep(step, textStepNumber(index));
    if (result.kind === 'invalid') {
      patternErrors.set(step.id, result.reason);
      if (step.enabled) isInvalid = true;
    } else if (result.kind === 'compiled' && step.enabled) {
      textSteps.push(result.step);
    }
  });

  return {
    template,
    pipeline: isInvalid
      ? {kind: 'invalid'}
      : {kind: 'ready', start: startFor(template, steps), textSteps},
    patternErrors,
  };
}

function nameSourceFor(templateSource: string): NameSource {
  return templateSource.trim() === ''
    ? {kind: 'suggested'}
    : parseTemplate(templateSource);
}

function startFor(template: NameSource, steps: Steps): NameStart {
  if (!steps.template.enabled || template.kind === 'invalid')
    return {kind: 'original'};
  return template.kind === 'suggested'
    ? {kind: 'suggested', templates: steps.defaultTemplates}
    : {kind: 'template', template: template.template};
}

function compileTextStep(step: TextStep, number: number): TextStepResult {
  switch (step.kind) {
    case 'replace':
      return compileReplace(step, number);
    case 'case':
      return {
        kind: 'compiled',
        step: {number, kind: 'case', style: step.style},
      };
    case 'trim':
      return {
        kind: 'compiled',
        step: {
          number,
          kind: 'trim',
          characters: new Set([
            ' ',
            ...splitGraphemes(step.characters.normalize('NFC')),
          ]),
          ends: step.ends,
        },
      };
    case 'remove':
      return {
        kind: 'compiled',
        step: {
          number,
          kind: 'remove',
          count: step.count,
          position: step.position,
          from: step.from,
        },
      };
  }
}

function compileReplace(
  step: Extract<TextStep, {kind: 'replace'}>,
  number: number
): TextStepResult {
  const find = step.find.normalize('NFC');
  if (find === '') return {kind: 'inert'};
  try {
    return {
      kind: 'compiled',
      step: {
        number,
        kind: 'replace',
        pattern: new RegExp(
          step.regularExpression ? find : escapePattern(find),
          step.matchCase ? 'gu' : 'giu'
        ),
        replacement: step.replacement.normalize('NFC'),
        literal: !step.regularExpression,
      },
    };
  } catch (error) {
    return {kind: 'invalid', reason: patternErrorReason(error)};
  }
}

function escapePattern(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

function patternErrorReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(message.lastIndexOf(': ') + 1).trim();
}
