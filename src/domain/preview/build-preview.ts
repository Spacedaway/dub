import type {ParsedName} from '@/domain/parsing/parsed-name';
import {sanitiseFileName} from '@/domain/sanitising/sanitise-file-name';
import {fileTagValues, parsedTagValues} from '@/domain/tags/file-tags';
import type {TagName} from '@/domain/tags/tags';
import {
  renderTemplate,
  type CounterIndexes,
} from '@/domain/templates/render-template';
import type {TemplateParseResult} from '@/domain/templates/template';
import {collapseSpaces} from '@/domain/text/spaces';
import type {ProposedRename, ScannedFile} from '@/ipc/contracts';

export type NameProposal =
  | {kind: 'unchanged'}
  | {kind: 'renamed'; name: string}
  | {kind: 'emptyName'}
  | {kind: 'templateInvalid'};

export type PreviewRow = {
  file: ScannedFile;
  parsed: ParsedName | null;
  proposal: NameProposal;
  missingTags: Array<TagName>;
};

export function buildPreview(
  files: Array<ScannedFile>,
  parsedNames: ReadonlyMap<string, ParsedName | null>,
  template: TemplateParseResult
): Array<PreviewRow> {
  const indexes = counterIndexes(files);

  return files.map((file, index) => {
    const parsed = parsedNames.get(file.path) ?? null;
    if (template.kind === 'invalid') {
      return {
        file,
        parsed,
        proposal: {kind: 'templateInvalid'},
        missingTags: [],
      };
    }

    const values = {...fileTagValues(file), ...parsedTagValues(parsed)};
    const counter = indexes[index] ?? {folder: 0, batch: index};
    const rendered = renderTemplate(template.template, values, counter);
    return {
      file,
      parsed,
      proposal: propose(file, rendered.text),
      missingTags: rendered.missingTags,
    };
  });
}

function propose(file: ScannedFile, stem: string): NameProposal {
  if (stem.normalize('NFC') === collapseSpaces(file.stem).normalize('NFC'))
    return {kind: 'unchanged'};
  const name = sanitiseFileName(stem, file.extension);
  if (name === '') return {kind: 'emptyName'};
  if (name === file.name.normalize('NFC')) return {kind: 'unchanged'};
  return {kind: 'renamed', name};
}

function counterIndexes(files: Array<ScannedFile>): Array<CounterIndexes> {
  const seenPerFolder = new Map<string, number>();
  return files.map((file, batch) => {
    const folder = seenPerFolder.get(file.directory) ?? 0;
    seenPerFolder.set(file.directory, folder + 1);
    return {folder, batch};
  });
}

export function proposedRenames(
  rows: Array<PreviewRow>
): Array<ProposedRename> {
  return rows.flatMap(row =>
    row.proposal.kind === 'renamed'
      ? [
          {
            rowId: row.file.path,
            source: row.file.path,
            target: {kind: 'sameFolder', name: row.proposal.name},
          },
        ]
      : []
  );
}
