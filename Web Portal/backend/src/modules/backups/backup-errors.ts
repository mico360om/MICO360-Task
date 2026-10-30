/**
 * A problem with a backup copy or a restore, said in plain words (shown to the person running it).
 * `kind` 'key': the backup key is missing, too short or doesn't open the copy.
 */
export class RestoreError extends Error {
  constructor(
    message: string,
    readonly kind: 'key' | 'other' = 'other',
  ) {
    super(message);
    this.name = 'RestoreError';
  }
}

/** A backup that could not be made, with the reason to show administrators. */
export class BackupFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupFailedError';
  }
}
