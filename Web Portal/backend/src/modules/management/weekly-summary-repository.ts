export type WeeklySummaryStatus = 'SENDING' | 'SENT' | 'SKIPPED' | 'RETRY' | 'FAILED';

/** One person's weekly management summary for one company week: the guard against a second send, and its delivery log. */
export interface WeeklySummaryRecord {
  id: string;
  userId: string;
  /** The company week's first day ('YYYY-MM-DD'). */
  week: string;
  status: WeeklySummaryStatus;
  attempts: number;
  projectCount: number;
  nextAttemptAt: Date | null;
  lastError: string | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WeeklySummaryFinish {
  status: 'SENT' | 'SKIPPED' | 'RETRY' | 'FAILED';
  projectCount?: number;
  nextAttemptAt?: Date | null;
  lastError?: string | null;
  sentAt?: Date | null;
}

/** The same record keeping as the daily task emails (daily-email-repository), per person and week. */
export interface WeeklySummaryRepository {
  /** Takes the send for (person, week): a new SENDING row, or null when there is one already. */
  claim(userId: string, week: string): Promise<WeeklySummaryRecord | null>;
  /** Every record for these weeks. */
  forWeeks(weeks: string[]): Promise<WeeklySummaryRecord[]>;
  /** RETRY rows whose time has come, and SENDING rows left since `staleBefore` (a restart mid-send). */
  dueForRetry(now: Date, staleBefore: Date): Promise<WeeklySummaryRecord[]>;
  /** Takes a row for another attempt (SENDING, one more attempt) unless someone else already did: null then. */
  retake(row: WeeklySummaryRecord): Promise<WeeklySummaryRecord | null>;
  /** Writes down how an attempt went, only while that attempt still holds the row. */
  finish(taken: Pick<WeeklySummaryRecord, 'id' | 'attempts'>, patch: WeeklySummaryFinish): Promise<boolean>;
}
