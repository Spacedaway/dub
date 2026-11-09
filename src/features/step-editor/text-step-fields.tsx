import type {
  NameEnd,
  TextStep,
  TextStepKind,
  TrimEnds,
} from '@/domain/steps/step';
import type {LetterCaseStyle} from '@/domain/text/letter-case';
import {
  CheckboxLabel,
  ChoiceGroup,
  NumberInput,
  StepInput,
  type Choice,
} from '@/features/step-editor/field-controls';

type FieldsProps<Kind extends TextStepKind> = {
  step: Extract<TextStep, {kind: Kind}>;
  onChange: (step: TextStep) => void;
};

const caseChoices: Array<Choice<LetterCaseStyle>> = [
  {value: 'upper', label: 'UPPER', description: 'Upper case'},
  {value: 'lower', label: 'lower', description: 'Lower case'},
  {value: 'title', label: 'Title', description: 'Title case'},
];

const trimChoices: Array<Choice<TrimEnds>> = [
  {value: 'start', label: 'Start'},
  {value: 'end', label: 'End'},
  {value: 'both', label: 'Both'},
];

const removeChoices: Array<Choice<NameEnd>> = [
  {value: 'start', label: 'Start'},
  {value: 'end', label: 'End'},
];

export function TextStepFields({
  step,
  patternError,
  onChange,
}: {
  step: TextStep;
  patternError: string | undefined;
  onChange: (step: TextStep) => void;
}) {
  switch (step.kind) {
    case 'replace':
      return (
        <ReplaceFields
          step={step}
          patternError={patternError}
          onChange={onChange}
        />
      );
    case 'case':
      return <CaseFields step={step} onChange={onChange} />;
    case 'trim':
      return <TrimFields step={step} onChange={onChange} />;
    case 'remove':
      return <RemoveFields step={step} onChange={onChange} />;
  }
}

function ReplaceFields({
  step,
  patternError,
  onChange,
}: FieldsProps<'replace'> & {patternError: string | undefined}) {
  return (
    <>
      <StepInput
        data-first-field
        value={step.find}
        onChange={event => onChange({...step, find: event.target.value})}
        placeholder="Find"
        aria-label="Find"
        aria-invalid={patternError !== undefined}
      />
      {patternError !== undefined && (
        <p className="text-xs text-destructive">
          This regular expression isn't valid: {patternError}.
        </p>
      )}
      <StepInput
        value={step.replacement}
        onChange={event => onChange({...step, replacement: event.target.value})}
        placeholder="Replace with"
        aria-label="Replace with"
      />
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        <CheckboxLabel
          checked={step.regularExpression}
          onCheckedChange={regularExpression =>
            onChange({...step, regularExpression})
          }>
          Regular expression
        </CheckboxLabel>
        <CheckboxLabel
          checked={step.matchCase}
          onCheckedChange={matchCase => onChange({...step, matchCase})}>
          Match case
        </CheckboxLabel>
      </div>
    </>
  );
}

function CaseFields({step, onChange}: FieldsProps<'case'>) {
  return (
    <ChoiceGroup
      label="Letter case"
      value={step.style}
      choices={caseChoices}
      isFirstField
      onChange={style => onChange({...step, style})}
    />
  );
}

function TrimFields({step, onChange}: FieldsProps<'trim'>) {
  return (
    <>
      <div className="flex items-center gap-1.5">
        <StepInput
          data-first-field
          value={step.characters}
          onChange={event =>
            onChange({...step, characters: event.target.value})
          }
          placeholder="Characters"
          aria-label="Characters to trim"
          className="h-7 flex-1"
        />
        <ChoiceGroup
          label="Trim from"
          value={step.ends}
          choices={trimChoices}
          onChange={ends => onChange({...step, ends})}
        />
      </div>
      <p className="text-caption text-muted-foreground">
        Spaces are trimmed too.
      </p>
    </>
  );
}

function RemoveFields({step, onChange}: FieldsProps<'remove'>) {
  return (
    <div className="flex flex-col gap-1.5 text-xs text-sidebar-foreground">
      <div className="flex items-center gap-1.5">
        <span>Remove</span>
        <NumberInput
          data-first-field
          value={step.count}
          onChange={count => onChange({...step, count})}
          aria-label="Number of characters"
        />
        <span>{step.count === 1 ? 'character' : 'characters'},</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span>starting at</span>
        <NumberInput
          value={step.position}
          onChange={position => onChange({...step, position})}
          aria-label="Starting position"
        />
        <span>from the</span>
        <ChoiceGroup
          label="Counted from the"
          value={step.from}
          choices={removeChoices}
          onChange={from => onChange({...step, from})}
        />
      </div>
    </div>
  );
}
