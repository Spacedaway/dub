import {findTagName, tagValueTypes, type TagName} from '@/domain/tags/tags';
import type {
  TagModifier,
  TemplateError,
  TemplateNode,
  TemplateParseResult,
} from '@/domain/templates/template';

class TemplateSyntaxError extends Error {
  constructor(readonly detail: TemplateError) {
    super(detail.kind);
  }
}

export function parseTemplate(source: string): TemplateParseResult {
  const reader = {source, index: 0};
  try {
    const nodes = readNodes(reader, {insideOptional: false});
    return {kind: 'parsed', template: {source, nodes}};
  } catch (error) {
    if (error instanceof TemplateSyntaxError)
      return {kind: 'invalid', error: error.detail};
    throw error;
  }
}

type Reader = {source: string; index: number};

function readNodes(
  reader: Reader,
  {insideOptional}: {insideOptional: boolean}
): Array<TemplateNode> {
  const nodes: Array<TemplateNode> = [];
  let text = '';
  function flushText() {
    if (text !== '') nodes.push({kind: 'text', text});
    text = '';
  }

  while (reader.index < reader.source.length) {
    const character = reader.source[reader.index];
    const next = reader.source[reader.index + 1];

    if (character === '{' && next === '{') {
      text += '{';
      reader.index += 2;
    } else if (character === '}' && next === '}') {
      text += '}';
      reader.index += 2;
    } else if (character === '{') {
      flushText();
      const position = reader.index;
      reader.index += 1;
      const children = readNodes(reader, {insideOptional: true});
      if (reader.source[reader.index] !== '}') {
        throw new TemplateSyntaxError({kind: 'unclosedOptional', position});
      }
      reader.index += 1;
      nodes.push({kind: 'optional', children, position});
    } else if (character === '}') {
      if (insideOptional) break;
      throw new TemplateSyntaxError({
        kind: 'unmatchedBrace',
        position: reader.index,
      });
    } else if (character === '<') {
      flushText();
      nodes.push(readTag(reader));
    } else {
      text += character;
      reader.index += 1;
    }
  }

  flushText();
  return nodes;
}

function readTag(reader: Reader): TemplateNode {
  const position = reader.index;
  const end = reader.source.indexOf('>', position);
  if (end === -1)
    throw new TemplateSyntaxError({kind: 'unclosedTag', position});

  const [name = '', ...modifierTexts] = reader.source
    .slice(position + 1, end)
    .split(':');
  const tag = findTagName(name);
  if (tag === undefined)
    throw new TemplateSyntaxError({kind: 'unknownTag', tag: name, position});

  const modifiers = modifierTexts.map(text =>
    readModifier(tag, text.trim(), position)
  );
  reader.index = end + 1;
  return {kind: 'tag', tag, modifiers, position};
}

function readModifier(
  tag: TagName,
  text: string,
  position: number
): TagModifier {
  const modifier = recogniseModifier(text);
  if (modifier === undefined) {
    throw new TemplateSyntaxError({
      kind: 'unknownModifier',
      modifier: text,
      position,
    });
  }
  if (!modifierAllowed(tag, modifier)) {
    throw new TemplateSyntaxError({
      kind: 'modifierNotAllowed',
      tag,
      modifier: text,
      position,
    });
  }
  return modifier;
}

function recogniseModifier(text: string): TagModifier | undefined {
  const lowered = text.toLowerCase();
  if (/^0+$/.test(text)) return {kind: 'pad', width: text.length};
  if (lowered === 'upper' || lowered === 'lower' || lowered === 'title') {
    return {kind: 'case', style: lowered};
  }

  const [key, value = ''] = lowered.split('=');
  if (key === 'start' && /^-?\d+$/.test(value))
    return {kind: 'counterStart', value: Number(value)};
  if (key === 'step' && /^-?\d+$/.test(value))
    return {kind: 'counterStep', value: Number(value)};
  if (key === 'scope' && (value === 'folder' || value === 'batch')) {
    return {kind: 'counterScope', scope: value};
  }
  return undefined;
}

function modifierAllowed(tag: TagName, modifier: TagModifier): boolean {
  switch (modifier.kind) {
    case 'pad':
      return tagValueTypes[tag] === 'number';
    case 'case':
      return tagValueTypes[tag] === 'text';
    case 'counterStart':
    case 'counterStep':
    case 'counterScope':
      return tag === 'Inc';
  }
}

export function templateTags(
  nodes: Array<TemplateNode>
): Array<Extract<TemplateNode, {kind: 'tag'}>> {
  return nodes.flatMap(node => {
    switch (node.kind) {
      case 'text':
        return [];
      case 'tag':
        return [node];
      case 'optional':
        return templateTags(node.children);
    }
  });
}
