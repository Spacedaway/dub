export type LetterCaseStyle = 'upper' | 'lower' | 'title';

export function applyLetterCase(text: string, style: LetterCaseStyle): string {
  switch (style) {
    case 'upper':
      return text.toLocaleUpperCase('en-GB');
    case 'lower':
      return text.toLocaleLowerCase('en-GB');
    case 'title':
      return text.replace(
        /\p{L}[\p{L}']*/gu,
        word => word.charAt(0).toLocaleUpperCase('en-GB') + word.slice(1)
      );
  }
}
