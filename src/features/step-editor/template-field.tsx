import {useRef} from 'react';

import type {
  TemplateError,
  TemplateParseResult,
} from '@/domain/templates/template';
import {Input} from '@/ui/input';

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
  parsed: TemplateParseResult;
  onChange: (source: string) => void;
};

export function TemplateField({source, parsed, onChange}: TemplateFieldProps) {
  const input = useRef<HTMLInputElement>(null);

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
      <Input
        ref={input}
        value={source}
        onChange={event => onChange(event.target.value)}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        aria-invalid={parsed.kind === 'invalid'}
        aria-label="Name template"
        className="font-mono text-xs select-text"
      />
      {parsed.kind === 'invalid' && (
        <p className="text-xs text-destructive">
          {describeTemplateError(parsed.error)}
        </p>
      )}
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
    </div>
  );
}

function describeTemplateError(error: TemplateError): string {
  const at = `at character ${error.position + 1}`;
  switch (error.kind) {
    case 'unknownTag':
      return `There's no tag called “${error.tag}” (${at}).`;
    case 'unknownModifier':
      return `“${error.modifier}” isn't a modifier Dub knows (${at}).`;
    case 'modifierNotAllowed':
      return `<${error.tag}> can't take “${error.modifier}” (${at}).`;
    case 'unclosedTag':
      return `A tag is missing its closing “>” (${at}).`;
    case 'unclosedOptional':
      return `An optional part is missing its closing “}” (${at}).`;
    case 'unmatchedBrace':
      return `There's a “}” with no matching “{” (${at}). Use }} for a literal brace.`;
  }
}
