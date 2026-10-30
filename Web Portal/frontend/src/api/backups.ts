import type { ApiClient } from '../lib/api-client';

/** nightly / weekly: kept by the 7 + 4 rule; manual: one of the 3 newest made with Back up now. */
export type BackupKind = 'nightly' | 'weekly' | 'manual';
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
  /** What the kept copies take on the server's disk, all together. */
  keptBytes: number;
  /** `stored`: a connection is kept (also one this server can't use, being without the Google settings). */
  drive: { configured: boolean; connected: boolean; stored: boolean; email: string | null; connectedAt: string | null; problem: string | null; warning: string | null };
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
