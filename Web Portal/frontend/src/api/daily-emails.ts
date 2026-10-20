import type { ApiClient } from '../lib/api-client';

export type DailyEmailStatus = 'SENDING' | 'SENT' | 'SKIPPED' | 'RETRY' | 'FAILED';

/** One morning email in the delivery log (administrators). */
export interface DailyEmailLogRow {
  id: string;
  userId: string;
  day: string;
  kind: 'PENDING' | 'COMPLETED';
  status: DailyEmailStatus;
  attempts: number;
  taskCount: number;
  nextAttemptAt: string | null;
  lastError: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
  userName: string;
  email: string;
}

export function dailyEmailsApi(client: ApiClient) {
  return {
    log: (filter: { day?: string; status?: DailyEmailStatus }) => {
      const qs = new URLSearchParams();
      if (filter.day) qs.set('day', filter.day);
      if (filter.status) qs.set('status', filter.status);
      return client.get<{ data: DailyEmailLogRow[]; meta?: { emailEnabled: boolean } }>(`/admin/daily-emails${qs.size ? `?${qs}` : ''}`);
    },
  };
}
