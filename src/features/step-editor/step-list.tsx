import {useRef} from 'react';
import {ChevronDownIcon, ChevronUpIcon, PlusIcon, XIcon} from 'lucide-react';

import type {CompiledSteps} from '@/domain/steps/compile-steps';
import {textStepNumber, type TextStepKind} from '@/domain/steps/step';
import {useSession} from '@/store/session-store';
import {Button} from '@/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import {SectionHeading} from '@/features/sidebar/section-heading';
import {StepCard} from '@/features/step-editor/step-card';
import {stepTitles, textStepKinds} from '@/features/step-editor/step-titles';
import {TemplateField} from '@/features/step-editor/template-field';
import {TextStepFields} from '@/features/step-editor/text-step-fields';

type MoveDirection = 'up' | 'down';

export function StepList({
  compiledSteps,
  counterIgnoresEpisodes,
}: {
  compiledSteps: CompiledSteps;
  counterIgnoresEpisodes: boolean;
}) {
  const steps = useSession(state => state.steps);
  const setTemplateSource = useSession(state => state.setTemplateSource);
  const setTemplateEnabled = useSession(state => state.setTemplateEnabled);
  const addTextStep = useSession(state => state.addTextStep);
  const updateTextStep = useSession(state => state.updateTextStep);
  const deleteTextStep = useSession(state => state.deleteTextStep);
  const moveTextStep = useSession(state => state.moveTextStep);

  const list = useRef<HTMLOListElement>(null);
  const addTrigger = useRef<HTMLButtonElement>(null);
  const addedStepId = useRef<string | null>(null);

  function cardElement(id: string, selector: string): HTMLElement | null {
    return (
      list.current?.querySelector<HTMLElement>(
        `[data-step-id="${id}"] ${selector}`
      ) ?? null
    );
  }

  function addStep(kind: TextStepKind) {
    addedStepId.current = addTextStep(kind);
  }

  function focusAfterAdding(): HTMLElement | true {
    const id = addedStepId.current;
    addedStepId.current = null;
    return (id === null ? null : cardElement(id, '[data-first-field]')) ?? true;
  }

  function moveStep(id: string, direction: MoveDirection) {
    moveTextStep(id, direction === 'up' ? -1 : 1);
    requestAnimationFrame(() => {
      const same = cardElement(id, `[data-move="${direction}"]`);
      const other = cardElement(
        id,
        `[data-move="${direction === 'up' ? 'down' : 'up'}"]`
      );
      const target =
        same instanceof HTMLButtonElement && same.disabled ? other : same;
      target?.focus();
    });
  }

  function deleteStep(id: string) {
    deleteTextStep(id);
    requestAnimationFrame(() => addTrigger.current?.focus());
  }

  return (
    <section className="flex flex-col gap-2 px-4 pb-5">
      <div className="flex items-center justify-between">
        <SectionHeading>Steps</SectionHeading>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                ref={addTrigger}
                variant="ghost"
                size="icon-xs"
                aria-label="Add step"
                title="Add step"
              />
            }>
            <PlusIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-auto"
            finalFocus={focusAfterAdding}>
            {textStepKinds.map(kind => (
              <DropdownMenuItem key={kind} onClick={() => addStep(kind)}>
                {stepTitles[kind]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ol ref={list} className="flex flex-col gap-2">
        <StepCard
          stepId="template"
          number={1}
          title={stepTitles.template}
          enabled={steps.template.enabled}
          onEnabledChange={setTemplateEnabled}>
          <TemplateField
            source={steps.template.source}
            nameSource={compiledSteps.template}
            counterIgnoresEpisodes={counterIgnoresEpisodes}
            onChange={setTemplateSource}
          />
        </StepCard>
        {steps.textSteps.map((step, index) => {
          const number = textStepNumber(index);
          return (
            <StepCard
              key={step.id}
              stepId={step.id}
              number={number}
              title={stepTitles[step.kind]}
              enabled={step.enabled}
              onEnabledChange={enabled => updateTextStep({...step, enabled})}
              controls={
                <>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    data-move="up"
                    disabled={index === 0}
                    onClick={() => moveStep(step.id, 'up')}
                    aria-label={`Move step ${number} up`}>
                    <ChevronUpIcon />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    data-move="down"
                    disabled={index === steps.textSteps.length - 1}
                    onClick={() => moveStep(step.id, 'down')}
                    aria-label={`Move step ${number} down`}>
                    <ChevronDownIcon />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => deleteStep(step.id)}
                    aria-label={`Delete step ${number}`}
                    title="Delete step">
                    <XIcon />
                  </Button>
                </>
              }>
              <TextStepFields
                step={step}
                patternError={compiledSteps.patternErrors.get(step.id)}
                onChange={updateTextStep}
              />
            </StepCard>
          );
        })}
      </ol>

      {steps.textSteps.length > 0 && (
        <p className="text-caption text-muted-foreground">
          Clean-up runs last and can't be switched off.
        </p>
      )}
    </section>
  );
}
