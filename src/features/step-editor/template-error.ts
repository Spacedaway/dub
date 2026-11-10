import type {TemplateError} from '@/domain/templates/template';

export function describeTemplateError(error: TemplateError): string {
  const at = `at character ${error.position + 1}`;
  switch (error.kind) {
    case 'unknownTag':
      return `There's no tag called “${error.tag}” (${at}).`;
    case 'unknownModifier':
      return `“${error.modifier}” isn't a modifier Dub knows (${at}).`;
    case 'modifierNotAllowed':
      return `<${error.tag}> can't take “${error.modifier}” (${at}).`;
    case 'unclosedTag':
      return `A tag is missing its closing “>” (${at}).`;
    case 'unclosedOptional':
      return `An optional part is missing its closing “}” (${at}).`;
    case 'unmatchedBrace':
      return `There's a “}” with no matching “{” (${at}). Use }} for a literal brace.`;
  }
}
