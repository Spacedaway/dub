import type {CompiledTextStep} from '@/domain/steps/compile-steps';
import type {NameEnd, TrimEnds} from '@/domain/steps/step';
import {splitGraphemes} from '@/domain/text/graphemes';
import {applyLetterCase} from '@/domain/text/letter-case';

export function applyTextStep(step: CompiledTextStep, text: string): string {
  switch (step.kind) {
    case 'replace':
      return step.literal
        ? text.replace(step.pattern, () => step.replacement)
        : text.replace(step.pattern, step.replacement);
    case 'case':
      return applyLetterCase(text, step.style);
    case 'trim':
      return trimEnds(text, step.characters, step.ends);
    case 'remove':
      return removeCharacters(text, step.count, step.position, step.from);
  }
}

function trimEnds(
  text: string,
  characters: ReadonlySet<string>,
  ends: TrimEnds
): string {
  const parts = splitGraphemes(text);
  let start = 0;
  let end = parts.length;
  if (ends !== 'end') {
    while (start < end && characters.has(parts[start] ?? '')) start += 1;
  }
  if (ends !== 'start') {
    while (end > start && characters.has(parts[end - 1] ?? '')) end -= 1;
  }
  return parts.slice(start, end).join('');
}

function removeCharacters(
  text: string,
  count: number,
  position: number,
  from: NameEnd
): string {
  const parts = splitGraphemes(text);
  const first =
    from === 'start' ? position - 1 : parts.length - (position - 1) - count;
  const start = Math.max(0, first);
  const end = Math.min(parts.length, first + count);
  if (end <= start) return text;
  return [...parts.slice(0, start), ...parts.slice(end)].join('');
}
