import type {TagName, TagValue, TagValues} from '@/domain/tags/tags';
import type {
  CounterScope,
  TagModifier,
  Template,
  TemplateNode,
} from '@/domain/templates/template';
import {collapseSpaces} from '@/domain/text/spaces';

export type CounterIndexes = Record<CounterScope, number>;

export type RenderedTemplate = {text: string; missingTags: Array<TagName>};

export function renderTemplate(
  template: Template,
  values: TagValues,
  counterIndexes: CounterIndexes
): RenderedTemplate {
  const missingTags: Array<TagName> = [];
  const rendered = renderNodes(
    template.nodes,
    values,
    counterIndexes,
    missingTags
  );
  return {text: collapseSpaces(rendered), missingTags};
}

function renderNodes(
  nodes: Array<TemplateNode>,
  values: TagValues,
  counterIndexes: CounterIndexes,
  missingTags: Array<TagName>
): string {
  let output = '';
  for (const node of nodes) {
    switch (node.kind) {
      case 'text':
        output += node.text;
        break;
      case 'tag': {
        const text = renderTag(
          node.tag,
          node.modifiers,
          values,
          counterIndexes,
          output
        );
        if (text === undefined) missingTags.push(node.tag);
        output += text ?? '';
        break;
      }
      case 'optional': {
        const missingInside: Array<TagName> = [];
        const text = renderNodes(
          node.children,
          values,
          counterIndexes,
          missingInside
        );
        if (missingInside.length === 0) output += text;
        break;
      }
    }
  }
  return output;
}

function renderTag(
  tag: TagName,
  modifiers: Array<TagModifier>,
  values: TagValues,
  counterIndexes: CounterIndexes,
  textBefore: string
): string | undefined {
  if (tag === 'Inc')
    return formatNumber(counterValue(modifiers, counterIndexes), modifiers);

  const value = values[tag];
  if (value === undefined) return undefined;
  return formatValue(value, modifiers, textBefore);
}

function counterValue(
  modifiers: Array<TagModifier>,
  counterIndexes: CounterIndexes
): number {
  let start = 1;
  let step = 1;
  let scope: CounterScope = 'folder';
  for (const modifier of modifiers) {
    if (modifier.kind === 'counterStart') start = modifier.value;
    if (modifier.kind === 'counterStep') step = modifier.value;
    if (modifier.kind === 'counterScope') scope = modifier.scope;
  }
  return start + step * counterIndexes[scope];
}

function formatValue(
  value: TagValue,
  modifiers: Array<TagModifier>,
  textBefore: string
): string {
  switch (value.kind) {
    case 'text':
      return applyCase(value.text, modifiers);
    case 'number':
      return formatNumber(value.value, modifiers);
    case 'numbers':
      return formatNumberList(value.values, modifiers, textBefore);
    case 'date':
      return value.isoDate;
  }
}

function formatNumber(value: number, modifiers: Array<TagModifier>): string {
  const width = modifiers.find(modifier => modifier.kind === 'pad')?.width ?? 0;
  const [whole = '', fraction] = String(Math.abs(value)).split('.');
  const sign = value < 0 ? '-' : '';
  const padded = whole.padStart(width, '0');
  return fraction === undefined
    ? `${sign}${padded}`
    : `${sign}${padded}.${fraction}`;
}

function formatNumberList(
  values: Array<number>,
  modifiers: Array<TagModifier>,
  textBefore: string
): string {
  const prefix = /([A-Za-z]+)$/.exec(textBefore)?.[1] ?? '';
  const separator = `-${prefix}`;
  const isConsecutiveRun =
    values.length > 2 &&
    values.every(
      (value, index) => index === 0 || value === (values[index - 1] ?? 0) + 1
    );
  const shown = isConsecutiveRun
    ? [values[0] ?? 0, values[values.length - 1] ?? 0]
    : values;
  return shown.map(value => formatNumber(value, modifiers)).join(separator);
}

function applyCase(text: string, modifiers: Array<TagModifier>): string {
  const caseModifier = modifiers.find(modifier => modifier.kind === 'case');
  switch (caseModifier?.style) {
    case undefined:
      return text;
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
