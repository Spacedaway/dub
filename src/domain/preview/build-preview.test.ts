import {describe, expect, it} from 'vitest';

import {parseFileName} from '@/domain/parsing/parse-file-name';
import type {ParsedName} from '@/domain/parsing/parsed-name';
import {buildPreview, noRowEdits} from '@/domain/preview/build-preview';
import {compileSteps} from '@/domain/steps/compile-steps';
import {initialSteps, newTextStep, type Steps} from '@/domain/steps/step';
import type {ScannedFile} from '@/ipc/contracts';

function file(directory: string, name: string): ScannedFile {
  const dot = name.lastIndexOf('.');
  const folderName = directory.split('/').pop() ?? '';
  return {
    path: `${directory}/${name}`,
    directory,
    name,
    stem: dot > 0 ? name.slice(0, dot) : name,
    extension: dot > 0 ? name.slice(dot) : '',
    folderName,
    parentFolderName: null,
    size: 100,
    modifiedMs: Date.UTC(2026, 10, 7),
    createdMs: null,
    volumeId: 'uuid:TEST',
    access: 'writable',
  };
}

function parsedNamesFor(
  files: Array<ScannedFile>
): Map<string, ParsedName | null> {
  return new Map(files.map(entry => [entry.path, parseFileName(entry)]));
}

function names(source: string, files: Array<ScannedFile>) {
  return proposals({...initialSteps, template: {source, enabled: true}}, files);
}

function proposals(steps: Steps, files: Array<ScannedFile>) {
  return buildPreview(
    files,
    parsedNamesFor(files),
    new Map(),
    new Map(),
    compileSteps(steps).pipeline,
    noRowEdits
  ).map(row => row.proposal);
}

describe('buildPreview', () => {
  it('leaves a file alone when the template reproduces its name', () => {
    const files = [file('/media', 'Re:Zero - 01.mkv')];
    expect(names('<Original>', files)).toEqual([{kind: 'unchanged'}]);
  });

  it("doesn't rename a file just to tidy its spaces", () => {
    const files = [
      file('/media', 'Show  Name .mkv'),
      file('/media', '葬送の　フリーレン.mkv'),
    ];
    expect(names('<Original>', files)).toEqual([
      {kind: 'unchanged'},
      {kind: 'unchanged'},
    ]);
  });

  it("doesn't rename for clean-up alone when the steps only change spacing", () => {
    const files = [
      file('/media', 'Show  Name .mkv'),
      file('/media', 'Pokémon.mkv'),
    ];
    const doubleSpaces = {
      ...newTextStep('replace', 'spaces'),
      find: ' ',
      replacement: '  ',
    };
    expect(
      proposals(
        {
          ...initialSteps,
          template: {source: '', enabled: false},
          textSteps: [doubleSpaces],
        },
        files
      )
    ).toEqual([{kind: 'unchanged'}, {kind: 'unchanged'}]);
  });

  it('treats names that differ only in Unicode form as unchanged', () => {
    const files = [file('/media', 'Pokémon.mkv')];
    expect(names('<Original>', files)).toEqual([{kind: 'unchanged'}]);
    expect(names('Pokémon', files)).toEqual([{kind: 'unchanged'}]);
  });

  it('cleans names the template changes', () => {
    const files = [file('/media', 'a.mkv')];
    expect(names('Re:Zero - 01', files)).toEqual([
      {kind: 'renamed', name: 'Re-Zero - 01.mkv'},
    ]);
  });
});
