import type {PropsWithChildren} from 'react';

import {Toaster} from '@/ui/sonner';
import {TooltipProvider} from '@/ui/tooltip';

export function AppProviders({children}: PropsWithChildren) {
  return (
    <TooltipProvider delay={300}>
      {children}
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
}
