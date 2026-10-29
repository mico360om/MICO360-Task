import type { ApiClient } from '../lib/api-client';

export type BackupKind = 'nightly' | 'weekly';
export type BackupTrigger = 'NIGHTLY' | 'MANUAL';

export interface BackupCopy {
  id: string;
  fileName: string;
  createdAt: string;
  sizeBytes: number;
  kind: BackupKind;
  trigger: BackupTrigger;
  encrypted: boolean;
  /** The Google Drive copy: null when Drive wasn't connected for it. */
  drive: 'UPLOADED' | 'FAILED' | 'SKIPPED' | null;
  driveError: string | null;
}

export interface BackupOverview {
  /** Where the copies are kept on the server. */
  folder: string;
  folderWarning: string | null;
  encrypted: boolean;
  nightly: { enabled: boolean; hour: number; timeZone: string };
  running: { id: string; trigger: BackupTrigger; startedAt: string } | null;
  lastSuccess: { at: string; sizeBytes: number } | null;
  /** "Last night's backup failed: …" and the like. */
  warning: string | null;
  copies: BackupCopy[];
  drive: { configured: boolean; connected: boolean; email: string | null; connectedAt: string | null; problem: string | null; warning: string | null };
}

/** System Settings → Backups (administrators only). */
export function backupsApi(client: ApiClient) {
  return {
    overview: () => client.get<{ data: BackupOverview }>('/backups').then((r) => r.data),
    start: () => client.post<{ data: { id: string; status: string; trigger: BackupTrigger; startedAt: string } }>('/backups').then((r) => r.data),
    /** A 2-minute, single-use address the browser downloads the copy from. */
    downloadLink: (id: string) => client.post<{ data: { url: string } }>(`/backups/${encodeURIComponent(id)}/download-link`).then((r) => r.data.url),
    /** Google's page to allow the connection. */
    connectDrive: () => client.post<{ data: { url: string } }>('/backups/google/connect').then((r) => r.data.url),
    disconnectDrive: () => client.del('/backups/google'),
  };
}
