export type BackupTrigger = 'NIGHTLY' | 'MANUAL';
export type BackupStatus = 'RUNNING' | 'OK' | 'FAILED';
export type BackupDriveStatus = 'UPLOADED' | 'FAILED' | 'SKIPPED';

/** One backup copy, or a try at one (the backup_runs table). */
export interface BackupRunRecord {
  id: string;
  trigger: BackupTrigger;
  status: BackupStatus;
  /** The company date it was made on ('YYYY-MM-DD'). */
  localDate: string;
  startedAt: Date;
  finishedAt: Date | null;
  fileName: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  encrypted: boolean;
  tableCount: number | null;
  rowCount: number | null;
  fileCount: number | null;
  error: string | null;
  driveStatus: BackupDriveStatus | null;
  driveFileId: string | null;
  driveError: string | null;
  requestedById: string | null;
}

export type BackupRunChange = Partial<Omit<BackupRunRecord, 'id' | 'trigger' | 'localDate' | 'startedAt' | 'requestedById'>>;

export interface BackupRepository {
  create(data: { trigger: BackupTrigger; localDate: string; startedAt: Date; requestedById: string | null }): Promise<BackupRunRecord>;
  update(id: string, change: BackupRunChange): Promise<BackupRunRecord>;
  /** Change a row only while it is still RUNNING (true when it was). */
  updateIfRunning(id: string, change: BackupRunChange): Promise<boolean>;
  find(id: string): Promise<BackupRunRecord | null>;
  /** The newest rows first. */
  recent(limit: number): Promise<BackupRunRecord[]>;
  /** Every good copy, newest first. */
  ok(): Promise<BackupRunRecord[]>;
  running(): Promise<BackupRunRecord[]>;
  nightlyOn(localDate: string): Promise<BackupRunRecord[]>;
  remove(ids: string[]): Promise<void>;
  /** Delete failed tries started before `before`; returns how many. */
  pruneFailed(before: Date): Promise<number>;
}

/**
 * One backup at a time, across server instances: a lease renewed while a backup runs, so a server
 * that stops part-way frees it within minutes.
 */
export interface BackupRunLock {
  acquire(now: Date): Promise<boolean>;
  renew(now: Date): Promise<void>;
  release(): Promise<void>;
  isHeld(now: Date): Promise<boolean>;
}
