import {useId, useState} from 'react';

import type {FileKind} from '@/domain/suggestions/classify-file';
import {
  builtInDefaultTemplates,
  parseDefaultTemplate,
  parseDefaultTemplates,
  templateSources,
  type DefaultTemplateResult,
} from '@/domain/suggestions/default-templates';
import {saveDefaultTemplates} from '@/store/default-templates';
import {useSession} from '@/store/session-store';
import {Button} from '@/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';
import {StepInput} from '@/features/step-editor/field-controls';
import {describeTemplateError} from '@/features/step-editor/template-error';

const fields: Array<{kind: FileKind; label: string; example: string | null}> = [
  {kind: 'tvEpisode', label: 'TV episodes', example: 'Show.Name.S01E02.mkv'},
  {
    kind: 'datedEpisode',
    label: 'Dated episodes',
    example: 'Show.Name.2026.11.05.mkv',
  },
  {
    kind: 'numberedEpisode',
    label: 'Numbered episodes',
    example: '[Group] Show Name - 012.mkv',
  },
  {kind: 'film', label: 'Films', example: 'Film.Name.2019.1080p.mkv'},
  {kind: 'generic', label: 'Other files', example: null},
];

export function DefaultTemplatesDialog({onClose}: {onClose: () => void}) {
  const [draft, setDraft] = useState(() =>
    templateSources(useSession.getState().steps.defaultTemplates)
  );
  const formId = useId();
  const templates = parseDefaultTemplates(draft);

  function save() {
    if (templates === null) return;
    void saveDefaultTemplates(templates);
    onClose();
  }

  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open) onClose();
      }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Default templates</DialogTitle>
          <DialogDescription>
            While the Template step is empty, Dub names each file with the
            template for its kind.
          </DialogDescription>
        </DialogHeader>
        <form
          id={formId}
          onSubmit={event => {
            event.preventDefault();
            save();
          }}
          className="flex flex-col gap-3">
          {fields.map(field => (
            <TemplateSourceField
              key={field.kind}
              label={field.label}
              example={field.example}
              source={draft[field.kind]}
              result={parseDefaultTemplate(draft[field.kind])}
              onChange={source => setDraft({...draft, [field.kind]: source})}
            />
          ))}
        </form>
        <DialogFooter>
          <Button
            variant="ghost"
            className="sm:mr-auto"
            onClick={() => setDraft(templateSources(builtInDefaultTemplates))}>
            Reset to built-in
          </Button>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={templates === null}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TemplateSourceField({
  label,
  example,
  source,
  result,
  onChange,
}: {
  label: string;
  example: string | null;
  source: string;
  result: DefaultTemplateResult;
  onChange: (source: string) => void;
}) {
  const inputId = useId();
  const exampleId = useId();
  const errorId = useId();
  const error = errorFor(result);
  const describedBy = [
    example === null ? null : exampleId,
    error === null ? null : errorId,
  ].filter(id => id !== null);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline gap-2">
        <label htmlFor={inputId} className="text-sm">
          {label}
        </label>
        {example !== null && (
          <span
            id={exampleId}
            className="font-mono text-caption text-muted-foreground">
            {example}
          </span>
        )}
      </div>
      <StepInput
        id={inputId}
        value={source}
        onChange={event => onChange(event.target.value)}
        aria-invalid={error !== null}
        aria-describedby={
          describedBy.length === 0 ? undefined : describedBy.join(' ')
        }
      />
      {error !== null && (
        <p id={errorId} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function errorFor(result: DefaultTemplateResult): string | null {
  switch (result.kind) {
    case 'parsed':
      return null;
    case 'blank':
      return "A default template can't be empty.";
    case 'invalid':
      return describeTemplateError(result.error);
  }
}
