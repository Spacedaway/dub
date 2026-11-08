import type {LookupNote} from '@/domain/lookups/match-episodes';
import type {EpisodeFlag} from '@/domain/suggestions/episode-flags';
import type {
  PlanProblem,
  PlanWarning,
  RenameFailure,
  SkipReason,
} from '@/ipc/contracts';

export function describeProblem(problem: PlanProblem): string {
  switch (problem.kind) {
    case 'emptyName':
      return 'The new name is empty.';
    case 'invalidCharacters':
      return `Contains characters that aren't allowed in file names: ${problem.characters.join(' ')}`;
    case 'reservedName':
      return `“${problem.reserved}” is a name Windows reserves for devices.`;
    case 'endsWithDotOrSpace':
      return 'Ends with a dot or a space, which Windows strips.';
    case 'startsWithDot':
      return 'Starts with a dot, which would hide the file.';
    case 'notNormalised':
      return 'Contains characters in an unusual Unicode form.';
    case 'nameTooLong':
      return `The name is ${problem.length} characters long; the limit is ${problem.limit}.`;
    case 'duplicateTarget':
      return problem.otherRowIds.length === 1
        ? 'Another file would get the same name.'
        : `${problem.otherRowIds.length} other files would get the same name.`;
    case 'duplicateSource':
      return 'This file is listed more than once.';
    case 'targetExists':
      return 'A file with this name is already in the folder.';
    case 'blockedByRow':
      return "Its new name belongs to a file that can't be renamed.";
    case 'groupBlocked':
      return `It renames together with “${fileName(problem.rowId)}”, which can't be renamed.`;
    case 'sourceMissing':
      return 'The file is no longer where it was found.';
    case 'readOnlyVolume':
      return 'The drive is read-only.';
    case 'volumeUnavailable':
      return "The drive holding this file couldn't be read.";
    case 'folderNotWritable':
      return "You don't have permission to change files in this folder.";
  }
}

export function describeWarning(warning: PlanWarning): string {
  switch (warning.kind) {
    case 'pathTooLongForWindows':
      return `The full path is ${warning.length} characters, longer than Windows normally allows (${warning.limit}).`;
  }
}

export function describeFailure(failure: RenameFailure): string {
  switch (failure.kind) {
    case 'targetExists':
      return 'a file with the new name appeared in the meantime';
    case 'sourceMissing':
      return 'the file had been moved or deleted';
    case 'fileInUse':
      return 'another program has the file open';
    case 'permissionDenied':
      return 'permission was denied';
    case 'readOnlyVolume':
      return 'the drive is read-only';
    case 'differentVolume':
      return 'the new location is on a different drive';
    case 'nameTooLong':
      return 'the name is too long for this drive';
    case 'other':
      return failure.message;
  }
}

export function describeSkip(reason: SkipReason): string {
  switch (reason) {
    case 'fileChanged':
      return 'it changed after it was renamed';
    case 'fileMissing':
      return "it's no longer there";
    case 'originalNameTaken':
      return 'another file now has its original name';
  }
}

export function describeFlag(flag: EpisodeFlag): string {
  switch (flag.kind) {
    case 'gapBefore':
      return flag.from === flag.to
        ? `Episode ${flag.from} is missing before this one.`
        : `Episodes ${flag.from}–${flag.to} are missing before this one.`;
    case 'duplicateEpisode':
      return flag.episodes.length === 1
        ? `Another file is also episode ${flag.episodes.join(', ')}.`
        : `Another file also has episodes ${flag.episodes.join(', ')}.`;
    case 'decimalEpisode':
      return `Episode ${flag.episode} is usually a special.`;
  }
}

export function describeLookupNote(note: LookupNote): string {
  switch (note.kind) {
    case 'numbersDiffer':
      return `The file says ${note.inFile}; TVmaze lists it as ${note.onTvmaze}.`;
    case 'notListed':
      return `TVmaze doesn't list ${note.episode}.`;
    case 'nearbyDate':
      return `Matched to the episode TVmaze lists a day apart, on ${note.airDate}.`;
    case 'sharedDate':
      return `TVmaze lists more than one episode on ${note.airDate}, so there's no title.`;
    case 'unnumberedSpecial':
      return "TVmaze doesn't number specials, so there's no title.";
    case 'seasonFolderDiffers':
      return `TVmaze lists this as ${note.onTvmaze}, not in season ${note.folderSeason}, so there's no title.`;
    case 'yearDiffers':
      return note.premiered === null
        ? `The file says ${note.inFile}, but the chosen show has no premiere date, so nothing comes from TVmaze.`
        : `The file says ${note.inFile}, but the chosen show premiered in ${note.premiered}, so nothing comes from TVmaze.`;
    case 'chooseShow':
      return 'Choose a show in the sidebar to add episode titles.';
    case 'notFound':
      return 'TVmaze has no show by this name. Search for it in the sidebar.';
    case 'lookupFailed':
      return "Couldn't reach TVmaze, so this name comes from the file.";
  }
}

function fileName(path: string): string {
  return path.split(/[\\/]/).at(-1) ?? path;
}
