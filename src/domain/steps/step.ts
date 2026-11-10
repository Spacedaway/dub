import {
  builtInDefaultTemplates,
  type DefaultTemplates,
} from '@/domain/suggestions/default-templates';
import type {LetterCaseStyle} from '@/domain/text/letter-case';

export type NameEnd = 'start' | 'end';

export type TrimEnds = NameEnd | 'both';

export const nameEnds: Array<NameEnd> = ['start', 'end'];

export const trimEnds: Array<TrimEnds> = [...nameEnds, 'both'];

export type TemplateStep = {source: string; enabled: boolean};

export type TextStepSettings = {enabled: boolean} & (
  | {
      kind: 'replace';
      find: string;
      replacement: string;
      regularExpression: boolean;
      matchCase: boolean;
    }
  | {kind: 'case'; style: LetterCaseStyle}
  | {kind: 'trim'; characters: string; ends: TrimEnds}
  | {kind: 'remove'; count: number; position: number; from: NameEnd}
);

export type TextStep = {id: string} & TextStepSettings;

export type TextStepKind = TextStep['kind'];

export const textStepKinds: Array<TextStepKind> = [
  'replace',
  'case',
  'trim',
  'remove',
];

export type StepKind = 'template' | TextStepKind;

export type Steps = {
  defaultTemplates: DefaultTemplates;
  template: TemplateStep;
  textSteps: Array<TextStep>;
};

export type StepSettings = {
  defaultTemplates: DefaultTemplates;
  template: TemplateStep;
  textSteps: Array<TextStepSettings>;
};

export const initialSteps: Steps = {
  defaultTemplates: builtInDefaultTemplates,
  template: {source: '', enabled: true},
  textSteps: [],
};

export function textStepNumber(index: number): number {
  return index + 2;
}

export function newTextStep(kind: TextStepKind, id: string): TextStep {
  switch (kind) {
    case 'replace':
      return {
        id,
        enabled: true,
        kind,
        find: '',
        replacement: '',
        regularExpression: false,
        matchCase: false,
      };
    case 'case':
      return {id, enabled: true, kind, style: 'title'};
    case 'trim':
      return {id, enabled: true, kind, characters: '-_.', ends: 'both'};
    case 'remove':
      return {id, enabled: true, kind, count: 1, position: 1, from: 'start'};
  }
}
