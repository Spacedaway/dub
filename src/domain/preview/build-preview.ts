import type {ParsedName} from '@/domain/parsing/parsed-name';
import {
  sanitiseCompanionSuffix,
  sanitiseFileName,
} from '@/domain/sanitising/sanitise-file-name';
import {classifyFile, type FileKind} from '@/domain/suggestions/classify-file';
import {defaultTemplates} from '@/domain/suggestions/default-templates';
import {fileTagValues, parsedTagValues} from '@/domain/tags/file-tags';
import type {TagName} from '@/domain/tags/tags';
import {parseTemplate} from '@/domain/templates/parse-template';
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
  kind: FileKind;
  proposal: NameProposal;
  missingTags: Array<TagName>;
  companionOf: string | null;
};

export type NameSource = {kind: 'suggested'} | TemplateParseResult;

export function nameSourceFor(templateSource: string): NameSource {
  return templateSource.trim() === ''
    ? {kind: 'suggested'}
    : parseTemplate(templateSource);
}

export function buildPreview(
  files: Array<ScannedFile>,
  parsedNames: ReadonlyMap<string, ParsedName | null>,
  companions: ReadonlyMap<string, string>,
  nameSource: NameSource
): Array<PreviewRow> {
  const mainFiles = files.filter(file => !companions.has(file.path));
  const mainRows = new Map(
    withCounters(mainFiles).map(({file, counter}) => [
      file.path,
      mainRow(file, parsedNames.get(file.path) ?? null, nameSource, counter),
    ])
  );

  return files.map(
    file =>
      mainRows.get(file.path) ??
      companionRow(file, mainRows.get(companions.get(file.path) ?? ''))
  );
}

function mainRow(
  file: ScannedFile,
  parsed: ParsedName | null,
  nameSource: NameSource,
  counter: CounterIndexes
): PreviewRow {
  const kind = classifyFile(parsed);
  if (nameSource.kind === 'invalid') {
    return {
      file,
      parsed,
      kind,
      proposal: {kind: 'templateInvalid'},
      missingTags: [],
      companionOf: null,
    };
  }

  const template =
    nameSource.kind === 'suggested'
      ? defaultTemplates[kind]
      : nameSource.template;
  const values = {...fileTagValues(file), ...parsedTagValues(parsed)};
  const rendered = renderTemplate(template, values, counter);
  return {
    file,
    parsed,
    kind,
    proposal: propose(file, rendered.text),
    missingTags: rendered.missingTags,
    companionOf: null,
  };
}

function companionRow(
  file: ScannedFile,
  video: PreviewRow | undefined
): PreviewRow {
  return {
    file,
    parsed: null,
    kind: 'generic',
    proposal:
      video === undefined
        ? {kind: 'unchanged'}
        : followVideo(file, video.file, video.proposal),
    missingTags: [],
    companionOf: video?.file.path ?? null,
  };
}

function followVideo(
  file: ScannedFile,
  video: ScannedFile,
  videoProposal: NameProposal
): NameProposal {
  if (videoProposal.kind !== 'renamed') return {kind: 'unchanged'};
  const newStem = videoProposal.name.slice(
    0,
    videoProposal.name.length - video.extension.length
  );
  const currentName = file.name.normalize('NFC');
  const suffix = sanitiseCompanionSuffix(
    currentName.slice(video.stem.normalize('NFC').length)
  );
  const name = (newStem + suffix).normalize('NFC');
  return name === currentName ? {kind: 'unchanged'} : {kind: 'renamed', name};
}

function propose(file: ScannedFile, stem: string): NameProposal {
  if (stem.normalize('NFC') === collapseSpaces(file.stem).normalize('NFC'))
    return {kind: 'unchanged'};
  const name = sanitiseFileName(stem, file.extension);
  if (name === '') return {kind: 'emptyName'};
  if (name === file.name.normalize('NFC')) return {kind: 'unchanged'};
  return {kind: 'renamed', name};
}

function withCounters(
  files: Array<ScannedFile>
): Array<{file: ScannedFile; counter: CounterIndexes}> {
  const seenPerFolder = new Map<string, number>();
  return files.map((file, batch) => {
    const folder = seenPerFolder.get(file.directory) ?? 0;
    seenPerFolder.set(file.directory, folder + 1);
    return {file, counter: {folder, batch}};
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
            companionOf: row.companionOf,
          },
        ]
      : []
  );
}
