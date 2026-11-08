export function collapseSpaces(text: string): string {
  return text.replace(/ {2,}/g, ' ').replace(/^ +| +$/g, '');
}
