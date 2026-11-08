import type {CommandError} from '@/ipc/contracts';

export function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return (error as CommandError).message;
  }
  return String(error);
}
