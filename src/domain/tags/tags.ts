import type {NonEmptyArray} from '@/ipc/contracts';

export const tagNames = [
  'Original',
  'Ext',
  'Folder',
  'Created',
  'Modified',
  'Size',
  'Name',
  'Year',
  'Season',
  'Episode',
  'Air Date',
  'Episode Title',
  'Group',
  'Resolution',
  'CRC',
  'Version',
  'Edition',
  'Inc',
] as const;

export type TagName = (typeof tagNames)[number];

export type TagValueType = 'text' | 'number' | 'date';

export const tagValueTypes: Record<TagName, TagValueType> = {
  Original: 'text',
  Ext: 'text',
  Folder: 'text',
  Created: 'date',
  Modified: 'date',
  Size: 'number',
  Name: 'text',
  Year: 'number',
  Season: 'number',
  Episode: 'number',
  'Air Date': 'date',
  'Episode Title': 'text',
  Group: 'text',
  Resolution: 'text',
  CRC: 'text',
  Version: 'number',
  Edition: 'text',
  Inc: 'number',
};

export type TagValue =
  | {kind: 'text'; text: string}
  | {kind: 'number'; value: number}
  | {kind: 'numbers'; values: NonEmptyArray<number>}
  | {kind: 'date'; isoDate: string};

export type TagValues = Partial<Record<Exclude<TagName, 'Inc'>, TagValue>>;

export function findTagName(text: string): TagName | undefined {
  const wanted = text.trim().toLowerCase();
  return tagNames.find(name => name.toLowerCase() === wanted);
}
