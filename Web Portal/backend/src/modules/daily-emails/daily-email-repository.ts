export type DailyEmailKind = 'PENDING' | 'COMPLETED';
export type DailyEmailStatus = 'SENDING' | 'SENT' | 'SKIPPED' | 'RETRY' | 'FAILED';

/** One morning email for one person and day: the guard against a second send, and its delivery log. */
export interface DailyEmailRecord {
  id: string;
  userId: string;
  /** The person's calendar day ('YYYY-MM-DD', their time zone). */
  day: string;
  kind: DailyEmailKind;
  status: DailyEmailStatus;
  attempts: number;
  taskCount: number;
  nextAttemptAt: Date | null;
  lastError: string | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A row of the admins' delivery log: the record plus who it was for. */
export interface DailyEmailLogRow extends DailyEmailRecord {
  userName: string;
  email: string;
}

/** A record of a day with who it was for (and their username), and their own time zone (null: the company's). */
export interface DailyEmailDayRow extends DailyEmailLogRow {
  username: string;
  timeZone: string | null;
}

export interface DailyEmailFinish {
  status: 'SENT' | 'SKIPPED' | 'RETRY' | 'FAILED';
  /** Set back (an administrator's try that failed doesn't use up the automatic retries). */
  attempts?: number;
  taskCount?: number;
  nextAttemptAt?: Date | null;
  lastError?: string | null;
  sentAt?: Date | null;
}

export interface DailyEmailRepository {
  /** Takes the send for (person, day, email): a new SENDING row, or null when there is one already. */
  claim(userId: string, day: string, kind: DailyEmailKind): Promise<DailyEmailRecord | null>;
  /** Rows to try again: RETRY whose time has come, and SENDING ones left since `staleBefore` (a crash mid-send). */
  dueForRetry(now: Date, staleBefore: Date): Promise<DailyEmailRecord[]>;
  /**
   * Takes a row for another attempt (SENDING, one more attempt) unless someone else already did — another
   * sweep, or an administrator's send: null then. The sweep retakes due retries; an administrator's send
   * also retakes a failed, skipped or (a resend) sent one.
   */
  retake(row: DailyEmailRecord): Promise<DailyEmailRecord | null>;
  /**
   * Writes down how an attempt went — only while that attempt still holds the row (SENDING, with the
   * attempt count it took it at). False when someone else took it meanwhile (a send that hung so long
   * it was taken again): what they wrote down stands.
   */
  finish(taken: Pick<DailyEmailRecord, 'id' | 'attempts'>, patch: DailyEmailFinish): Promise<boolean>;
  /** The record for (person, day, email), or null when there is none yet. */
  find(userId: string, day: string, kind: DailyEmailKind): Promise<DailyEmailRecord | null>;
  /** Every record for these days ('YYYY-MM-DD'), with who it was for: the admins' overview of a day. */
  forDays(days: string[]): Promise<DailyEmailDayRow[]>;
  /** The delivery log, newest first. */
  list(filter: { day?: string; status?: DailyEmailStatus; limit?: number }): Promise<DailyEmailLogRow[]>;
}
