import {Channel, invoke} from '@tauri-apps/api/core';

import type {
  BatchProgress,
  BatchResult,
  ExecuteRequest,
  JournalEntry,
  Plan,
  PlanRequest,
  ScanRequest,
  ScanResponse,
  BatchRequest,
  VolumeInfo,
} from '@/ipc/contracts';

export function scan(request: ScanRequest): Promise<ScanResponse> {
  return invoke('scan', {request});
}

export function volumeInfo(paths: Array<string>): Promise<Array<VolumeInfo>> {
  return invoke('volume_info', {request: {paths}});
}

export function plan(request: PlanRequest): Promise<Plan> {
  return invoke('plan', {request});
}

export function execute(
  request: ExecuteRequest,
  onProgress: (progress: BatchProgress) => void
): Promise<BatchResult> {
  return invoke('execute', {request, onProgress: progressChannel(onProgress)});
}

export function undo(
  request: BatchRequest,
  onProgress: (progress: BatchProgress) => void
): Promise<BatchResult> {
  return invoke('undo', {request, onProgress: progressChannel(onProgress)});
}

export function resume(
  request: BatchRequest,
  onProgress: (progress: BatchProgress) => void
): Promise<BatchResult> {
  return invoke('resume', {request, onProgress: progressChannel(onProgress)});
}

export function history(limit: number): Promise<Array<JournalEntry>> {
  return invoke('history', {request: {limit}});
}

function progressChannel(
  onProgress: (progress: BatchProgress) => void
): Channel<BatchProgress> {
  const channel = new Channel<BatchProgress>();
  channel.onmessage = onProgress;
  return channel;
}
