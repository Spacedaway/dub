import {describe, expect, it} from 'vitest';

import {parserCases, type ParserCase} from '@/domain/parsing/cases';
import {parseFileName} from '@/domain/parsing/parse-file-name';

function parseCase({
  fileName,
  folderName = '',
  parentFolderName = null,
}: ParserCase) {
  const dot = fileName.lastIndexOf('.');
  return parseFileName({
    stem: dot > 0 ? fileName.slice(0, dot) : fileName,
    extension: dot > 0 ? fileName.slice(dot) : '',
    folderName,
    parentFolderName,
  });
}

function caseLabel({fileName, folderName, parentFolderName}: ParserCase) {
  const folders = [parentFolderName, folderName].filter(Boolean).join('/');
  return folders === '' ? fileName : `${fileName} (in ${folders})`;
}

function check(parserCase: ParserCase) {
  const parsed = parseCase(parserCase);
  if (parserCase.expected === null) {
    expect(parsed).toBeNull();
    return;
  }
  expect(parsed).not.toBeNull();
  expect(parsed).toMatchObject(parserCase.expected);
}

describe('parseFileName', () => {
  for (const parserCase of parserCases) {
    const label = caseLabel(parserCase);
    if (parserCase.knownFailure) {
      it.fails(`${label}: known failure, ${parserCase.knownFailure}`, () =>
        check(parserCase));
    } else {
      it(label, () => check(parserCase));
    }
  }
});
