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
