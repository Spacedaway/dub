import {useRef, useState} from 'react';

import type {NameSource} from '@/domain/steps/compile-steps';
import {Button} from '@/ui/button';
import {DefaultTemplatesDialog} from '@/features/step-editor/default-templates-dialog';
import {StepInput} from '@/features/step-editor/field-controls';
import {describeTemplateError} from '@/features/step-editor/template-error';

const suggestedTags = [
  'Original',
  'Folder',
  'Inc:000',
  'Name',
  'Season:00',
  'Episode:00',
  'Episode Title',
  'Year',
];

type TemplateFieldProps = {
  source: string;
  nameSource: NameSource;
  counterIgnoresEpisodes: boolean;
  onChange: (source: string) => void;
};

export function TemplateField({
  source,
  nameSource,
  counterIgnoresEpisodes,
  onChange,
}: TemplateFieldProps) {
  const input = useRef<HTMLInputElement>(null);
  const [isEditingDefaults, setIsEditingDefaults] = useState(false);

  function insertTag(tag: string) {
    const element = input.current;
    const start = element?.selectionStart ?? source.length;
    const end = element?.selectionEnd ?? source.length;
    const inserted = `<${tag}>`;
    onChange(source.slice(0, start) + inserted + source.slice(end));
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(
        start + inserted.length,
        start + inserted.length
      );
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <StepInput
        ref={input}
        value={source}
        onChange={event => onChange(event.target.value)}
        placeholder="Suggested name for each file"
        aria-invalid={nameSource.kind === 'invalid'}
        aria-label="Name template"
      />
      {nameSource.kind === 'invalid' && (
        <p className="text-xs text-destructive">
          {describeTemplateError(nameSource.error)}
        </p>
      )}
      {counterIgnoresEpisodes && (
        <p className="text-xs text-warning">
          &lt;Inc&gt; numbers files in list order and ignores the episode
          numbers in their names. Use &lt;Episode&gt; to keep them.
        </p>
      )}
      <div className="flex flex-wrap gap-1">
        {nameSource.kind !== 'suggested' && (
          <Button variant="ghost" size="xs" onClick={() => onChange('')}>
            Use suggestions
          </Button>
        )}
        <Button
          variant="ghost"
          size="xs"
          onClick={() => setIsEditingDefaults(true)}>
          Default templates…
        </Button>
      </div>
      <div className="flex flex-wrap gap-1">
        {suggestedTags.map(tag => (
          <button
            key={tag}
            type="button"
            onClick={() => insertTag(tag)}
            className="rounded-md border border-border/80 bg-background/60 px-1.5 py-0.5 font-mono text-caption text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            {`<${tag}>`}
          </button>
        ))}
      </div>
      {isEditingDefaults && (
        <DefaultTemplatesDialog onClose={() => setIsEditingDefaults(false)} />
      )}
    </div>
  );
}
