const segmenter = new Intl.Segmenter('en-GB', {granularity: 'grapheme'});

export function splitGraphemes(text: string): Array<string> {
  if (/^[\x20-\x7e]*$/.test(text)) return text.split('');
  return Array.from(segmenter.segment(text), part => part.segment);
}
