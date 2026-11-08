import {collapseSpaces} from '@/domain/text/spaces';

const nameLengthLimit = 255;

const reservedNames = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM0',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'COM¹',
  'COM²',
  'COM³',
  'LPT0',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
  'LPT¹',
  'LPT²',
  'LPT³',
]);

const characterReplacements: Array<[RegExp, string]> = [
  [/: /g, ' - '],
  [/:/g, '-'],
  [/[\\/]/g, '+'],
  [/[<>|?]/g, ''],
  [/\*/g, '-'],
  [/"/g, "'"],
  // oxlint-disable-next-line no-control-regex -- Windows forbids control characters.
  [/[\u0000-\u001f]/g, ' '],
];

export function sanitiseFileName(stem: string, extension: string): string {
  const cleanStem = collapseSpaces(
    replaceCharacters(stem.normalize('NFC'))
  ).replace(/^[. ]+/, '');
  if (cleanStem === '') return '';

  const cleanExtension = cleanedExtension(extension);
  const name = trimTrailingDotsAndSpaces(cleanStem + cleanExtension);
  return fitLength(avoidReservedName(name), cleanExtension);
}

function cleanedExtension(extension: string): string {
  const cleaned = replaceCharacters(extension.normalize('NFC')).replace(
    / /g,
    ''
  );
  return /^\.*$/.test(cleaned) ? '' : cleaned;
}

function replaceCharacters(text: string): string {
  return characterReplacements.reduce(
    (result, [pattern, replacement]) => result.replace(pattern, replacement),
    text
  );
}

function trimTrailingDotsAndSpaces(text: string): string {
  return text.replace(/[. ]+$/, '');
}

function avoidReservedName(name: string): string {
  const firstDot = name.indexOf('.');
  const firstPart = firstDot === -1 ? name : name.slice(0, firstDot);
  const rest = firstDot === -1 ? '' : name.slice(firstDot);
  const bare = trimTrailingDotsAndSpaces(firstPart);
  if (!reservedNames.has(bare.toUpperCase())) return name;
  return `${bare}_${rest}`;
}

function fitLength(name: string, extension: string): string {
  if (name.length <= nameLengthLimit) return name;
  const stem = name.slice(0, name.length - extension.length);
  let shortened = '';
  for (const character of stem) {
    if (
      shortened.length + character.length + extension.length >
      nameLengthLimit
    )
      break;
    shortened += character;
  }
  return trimTrailingDotsAndSpaces(shortened) + extension;
}
