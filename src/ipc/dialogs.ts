import {open} from '@tauri-apps/plugin-dialog';

export async function pickFiles(): Promise<Array<string>> {
  return (
    (await open({multiple: true, directory: false, title: 'Add files'})) ?? []
  );
}

export async function pickFolders(): Promise<Array<string>> {
  return (
    (await open({multiple: true, directory: true, title: 'Add folders'})) ?? []
  );
}
