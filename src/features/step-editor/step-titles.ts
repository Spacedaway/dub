import type {StepKind} from '@/domain/steps/step';

export const stepTitles: Record<StepKind, string> = {
  template: 'Template',
  replace: 'Replace',
  case: 'Case',
  trim: 'Trim',
  remove: 'Remove',
};
