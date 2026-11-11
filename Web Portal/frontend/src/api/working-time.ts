import type { ApiClient } from '../lib/api-client';

/**
 * Working days, hours and days off (Notification & Scheduling centre): for a project the person can
 * see (its main company's), one of their companies, or — with neither — the picked company or their
 * own. The task form's due-date warning, the Timeline's shading and "N working days late" read it.
 */
export interface WorkingTime {
  companyId: string | null;
  timeZone: string;
  weekStart: 0 | 1 | 6;
  /** 0 Sunday … 6 Saturday. */
  workingDays: number[];
  hours: { start: string; end: string };
  from: string;
  to: string;
  /** Holidays and company days off in [from, to], yearly ones once per year. */
  daysOff: { day: string; name: string }[];
}

export interface WorkingTimeQuery {
  projectId?: string | null;
  companyId?: string | null;
  from: string;
  to: string;
}

export function workingTimeApi(client: ApiClient) {
  return {
    get: (q: WorkingTimeQuery) => {
      const params = new URLSearchParams({ from: q.from, to: q.to });
      if (q.projectId) params.set('projectId', q.projectId);
      if (q.companyId) params.set('companyId', q.companyId);
      return client.get<{ data: WorkingTime }>(`/working-time?${params.toString()}`).then((r) => r.data);
    },
  };
}
