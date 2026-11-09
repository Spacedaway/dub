import type {ComponentProps, PropsWithChildren} from 'react';
import {NumberField} from '@base-ui/react/number-field';
import {cn} from 'cn';

import {Checkbox} from '@/ui/checkbox';
import {Input} from '@/ui/input';
import {ToggleGroup, ToggleGroupItem} from '@/ui/toggle-group';

export function StepInput({className, ...props}: ComponentProps<typeof Input>) {
  return (
    <Input
      spellCheck={false}
      autoCorrect="off"
      autoCapitalize="off"
      className={cn(
        'font-mono text-xs select-text placeholder:font-sans',
        className
      )}
      {...props}
    />
  );
}

export function NumberInput({
  value,
  onChange,
  ...props
}: Omit<ComponentProps<typeof NumberField.Input>, 'value' | 'onChange'> & {
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <NumberField.Root
      value={value}
      min={1}
      onValueChange={next => {
        if (next !== null) onChange(Math.max(1, Math.round(next)));
      }}>
      <NumberField.Input
        className="h-7 w-10 rounded-lg border border-input bg-transparent px-1.5 text-center font-mono text-xs tabular-nums outline-none select-text focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
        {...props}
      />
    </NumberField.Root>
  );
}

export type Choice<Value extends string> = {
  value: Value;
  label: string;
  description?: string;
};

export function ChoiceGroup<Value extends string>({
  label,
  value,
  choices,
  isFirstField = false,
  onChange,
}: {
  label: string;
  value: Value;
  choices: Array<Choice<Value>>;
  isFirstField?: boolean;
  onChange: (value: Value) => void;
}) {
  return (
    <ToggleGroup
      aria-label={label}
      value={[value]}
      onValueChange={values => {
        const chosen = choices.find(choice => choice.value === values[0]);
        if (chosen !== undefined) onChange(chosen.value);
      }}
      variant="outline"
      size="sm"
      spacing={0}>
      {choices.map(choice => (
        <ToggleGroupItem
          key={choice.value}
          value={choice.value}
          aria-label={choice.description}
          data-first-field={
            isFirstField && choice.value === value ? true : undefined
          }
          className="px-2 text-xs">
          {choice.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export function CheckboxLabel({
  checked,
  onCheckedChange,
  children,
}: PropsWithChildren<{
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}>) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-sidebar-foreground">
      <Checkbox checked={checked} onCheckedChange={onCheckedChange} />
      {children}
    </label>
  );
}
