import type {TagName} from '@/domain/tags/tags';

export type LetterCaseStyle = 'upper' | 'lower' | 'title';

export type CounterScope = 'folder' | 'batch';

export type TagModifier =
  | {kind: 'pad'; width: number}
  | {kind: 'case'; style: LetterCaseStyle}
  | {kind: 'counterStart'; value: number}
  | {kind: 'counterStep'; value: number}
  | {kind: 'counterScope'; scope: CounterScope};

export type TemplateNode =
  | {kind: 'text'; text: string}
  | {kind: 'tag'; tag: TagName; modifiers: Array<TagModifier>; position: number}
  | {kind: 'optional'; children: Array<TemplateNode>; position: number};

export type Template = {source: string; nodes: Array<TemplateNode>};

export type TemplateError =
  | {kind: 'unknownTag'; tag: string; position: number}
  | {kind: 'unknownModifier'; modifier: string; position: number}
  | {
      kind: 'modifierNotAllowed';
      tag: TagName;
      modifier: string;
      position: number;
    }
  | {kind: 'unclosedTag'; position: number}
  | {kind: 'unclosedOptional'; position: number}
  | {kind: 'unmatchedBrace'; position: number};

export type TemplateParseResult =
  | {kind: 'parsed'; template: Template}
  | {kind: 'invalid'; error: TemplateError};
