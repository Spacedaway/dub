import type {LetterCaseStyle} from '@/domain/text/letter-case';

export type NameEnd = 'start' | 'end';

export type TrimEnds = NameEnd | 'both';

export type TemplateStep = {source: string; enabled: boolean};

export type TextStep = {id: string; enabled: boolean} & (
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

export type TextStepKind = TextStep['kind'];

export type StepKind = 'template' | TextStepKind;

export type Steps = {template: TemplateStep; textSteps: Array<TextStep>};

export const initialSteps: Steps = {
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
