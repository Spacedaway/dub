import type {Steps} from '@/domain/steps/step';
import {parseTemplate} from '@/domain/templates/parse-template';
import type {Template, TemplateParseResult} from '@/domain/templates/template';

export type NameSource = {kind: 'suggested'} | TemplateParseResult;

export type NameStart =
  | {kind: 'suggested'}
  | {kind: 'template'; template: Template};

export type StepPipeline =
  | {kind: 'ready'; start: NameStart}
  | {kind: 'invalid'};

export type CompiledSteps = {template: NameSource; pipeline: StepPipeline};

export function compileSteps(steps: Steps): CompiledSteps {
  const template = nameSourceFor(steps.template.source);
  return {template, pipeline: pipelineFor(template)};
}

function nameSourceFor(templateSource: string): NameSource {
  return templateSource.trim() === ''
    ? {kind: 'suggested'}
    : parseTemplate(templateSource);
}

function pipelineFor(template: NameSource): StepPipeline {
  switch (template.kind) {
    case 'invalid':
      return {kind: 'invalid'};
    case 'suggested':
      return {kind: 'ready', start: {kind: 'suggested'}};
    case 'parsed':
      return {
        kind: 'ready',
        start: {kind: 'template', template: template.template},
      };
  }
}
