import type {StepKind, TextStepKind} from '@/domain/steps/step';

export const stepTitles: Record<StepKind, string> = {
  template: 'Template',
  replace: 'Replace',
  case: 'Case',
  trim: 'Trim',
  remove: 'Remove',
};

export const textStepKinds: Array<TextStepKind> = [
  'replace',
  'case',
  'trim',
  'remove',
];
