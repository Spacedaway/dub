const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

export function compareNaturally(left: string, right: string): number {
  return collator.compare(left, right);
}
