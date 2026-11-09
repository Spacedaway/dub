import type {PropsWithChildren, ReactNode} from 'react';
import {cn} from 'cn';

import {Switch} from '@/ui/switch';

export function StepCard({
  stepId,
  number,
  title,
  enabled,
  onEnabledChange,
  controls,
  children,
}: PropsWithChildren<{
  stepId: string;
  number: number;
  title: string;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  controls?: ReactNode;
}>) {
  return (
    <li
      data-step-id={stepId}
      className="flex flex-col gap-2 rounded-lg border border-border/80 bg-background/60 p-2.5">
      <div className="flex min-h-6 items-center gap-2">
        <Switch
          size="sm"
          checked={enabled}
          onCheckedChange={onEnabledChange}
          aria-label={`Use step ${number}, ${title}`}
          title={enabled ? 'Switch this step off' : 'Switch this step on'}
        />
        <span className="text-body font-medium">
          <span className="text-muted-foreground tabular-nums">{number}.</span>{' '}
          {title}
        </span>
        {controls !== undefined && (
          <div className="ml-auto flex items-center">{controls}</div>
        )}
      </div>
      <div className={cn('flex flex-col gap-1.5', !enabled && 'opacity-60')}>
        {children}
      </div>
    </li>
  );
}
