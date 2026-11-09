import type {FileLookup} from '@/domain/lookups/derive-lookups';
import type {ParsedName} from '@/domain/parsing/parsed-name';
import {
  sanitiseCompanionSuffix,
  sanitiseFileName,
} from '@/domain/sanitising/sanitise-file-name';
import {applyTextStep} from '@/domain/steps/apply-text-step';
import type {NameStart, StepPipeline} from '@/domain/steps/compile-steps';
import type {StepKind} from '@/domain/steps/step';
import {classifyFile, type FileKind} from '@/domain/suggestions/classify-file';
import {defaultTemplates} from '@/domain/suggestions/default-templates';
import {fileTagValues, parsedTagValues} from '@/domain/tags/file-tags';
import type {TagName, TagValues} from '@/domain/tags/tags';
import {
  renderTemplate,
  type CounterIndexes,
  type RenderedTemplate,
} from '@/domain/templates/render-template';
import {collapseSpaces} from '@/domain/text/spaces';
import type {ProposedRename, ScannedFile} from '@/ipc/contracts';

export type NameProposal =
  | {kind: 'unchanged'}
  | {kind: 'renamed'; name: string}
  | {kind: 'emptyName'}
  | {kind: 'stepInvalid'}
  | {kind: 'excluded'};

export type TraceEntry = {step: StepKind; number: number; text: string};

export type PreviewRow = {
  file: ScannedFile;
  parsed: ParsedName | null;
  kind: FileKind;
  proposal: NameProposal;
  missingTags: Array<TagName>;
  trace: Array<TraceEntry>;
  companionOf: string | null;
  lookup: FileLookup | null;
};

export type RowEdits = {excluded: ReadonlySet<string>};

export const noRowEdits: RowEdits = {excluded: new Set()};

export function buildPreview(
  files: Array<ScannedFile>,
  parsedNames: ReadonlyMap<string, ParsedName | null>,
  companions: ReadonlyMap<string, string>,
  lookups: ReadonlyMap<string, FileLookup>,
  pipeline: StepPipeline,
  rowEdits: RowEdits
): Array<PreviewRow> {
  const mainFiles = files.filter(file => !companions.has(file.path));
  const includedFiles = mainFiles.filter(
    file => !rowEdits.excluded.has(file.path)
  );
  const mainRows = new Map(
    withCounters(includedFiles).map(({file, counter}) => [
      file.path,
      mainRow(
        file,
        parsedNames.get(file.path) ?? null,
        lookups.get(file.path) ?? null,
        pipeline,
        counter
      ),
    ])
  );
  for (const file of mainFiles) {
    if (!mainRows.has(file.path))
      mainRows.set(
        file.path,
        excludedRow(
          file,
          parsedNames.get(file.path) ?? null,
          lookups.get(file.path) ?? null
        )
      );
  }

  return files.map(
    file =>
      mainRows.get(file.path) ??
      companionRow(file, mainRows.get(companions.get(file.path) ?? ''))
  );
}

function mainRow(
  file: ScannedFile,
  parsed: ParsedName | null,
  lookup: FileLookup | null,
  pipeline: StepPipeline,
  counter: CounterIndexes
): PreviewRow {
  const kind = classifyFile(parsed);
  if (pipeline.kind === 'invalid') {
    return {
      file,
      parsed,
      kind,
      proposal: {kind: 'stepInvalid'},
      missingTags: [],
      trace: [],
      companionOf: null,
      lookup,
    };
  }

  const values = {
    ...fileTagValues(file),
    ...parsedTagValues(parsed),
    ...(lookup?.kind === 'resolved' ? lookup.tags : {}),
  };
  const start = renderStart(pipeline.start, file, kind, values, counter);
  let text = start.text.normalize('NFC');
  const trace: Array<TraceEntry> =
    pipeline.start.kind === 'original'
      ? []
      : [{step: 'template', number: 1, text}];
  for (const step of pipeline.textSteps) {
    text = applyTextStep(step, text).normalize('NFC');
    trace.push({step: step.kind, number: step.number, text});
  }
  return {
    file,
    parsed,
    kind,
    proposal: propose(file, text),
    missingTags: start.missingTags,
    trace,
    companionOf: null,
    lookup,
  };
}

function excludedRow(
  file: ScannedFile,
  parsed: ParsedName | null,
  lookup: FileLookup | null
): PreviewRow {
  return {
    file,
    parsed,
    kind: classifyFile(parsed),
    proposal: {kind: 'excluded'},
    missingTags: [],
    trace: [],
    companionOf: null,
    lookup,
  };
}

function renderStart(
  start: NameStart,
  file: ScannedFile,
  kind: FileKind,
  values: TagValues,
  counter: CounterIndexes
): RenderedTemplate {
  switch (start.kind) {
    case 'original':
      return {text: collapseSpaces(file.stem), missingTags: []};
    case 'suggested':
      return renderTemplate(defaultTemplates[kind], values, counter);
    case 'template':
      return renderTemplate(start.template, values, counter);
  }
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
    trace: [],
    companionOf: video?.file.path ?? null,
    lookup: null,
  };
}

function followVideo(
  file: ScannedFile,
  video: ScannedFile,
  videoProposal: NameProposal
): NameProposal {
  if (videoProposal.kind === 'excluded') return {kind: 'excluded'};
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
  if (comparableStem(stem) === comparableStem(file.stem))
    return {kind: 'unchanged'};
  const name = sanitiseFileName(stem, file.extension);
  if (name === '') return {kind: 'emptyName'};
  if (name === file.name.normalize('NFC')) return {kind: 'unchanged'};
  return {kind: 'renamed', name};
}

function comparableStem(stem: string): string {
  return collapseSpaces(stem.normalize('NFC'));
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
