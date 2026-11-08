import {describe, expect, it} from 'vitest';

import {sanitiseFileName} from '@/domain/sanitising/sanitise-file-name';

import nameRules from '../../../fixtures/name-rules.json';

describe('sanitiseFileName', () => {
  it.each(nameRules.cases)('$description', ({stem, extension, sanitised}) => {
    expect(sanitiseFileName(stem, extension)).toBe(sanitised);
  });
});
