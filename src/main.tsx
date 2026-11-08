import React from 'react';
import ReactDOM from 'react-dom/client';

import {followFileDrops} from '@/ipc/file-drop';
import {followPlanning} from '@/store/live-plan';
import {followLookups} from '@/store/lookups';
import {addPaths, loadUndoableBatch} from '@/store/session-actions';
import {useSession} from '@/store/session-store';
import '@/styles/main.css';

import {App} from './app';
import {AppProviders} from './app-providers';

document.documentElement.dataset.platform = navigator.userAgent.includes('Mac')
  ? 'macos'
  : 'windows';

followPlanning();
followLookups();
followFileDrops({
  onDraggingOverChange: useSession.getState().setDraggingOver,
  onDrop: paths => void addPaths(paths),
});
void loadUndoableBatch();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </React.StrictMode>
);
