import type { ApiClient } from '../lib/api-client';
import type { ApiTask } from './tasks';
import type { CalendarOccurrence } from '../lib/calendar-model';

export interface CalendarRange {
  from: string;
  to: string;
  timeZone: string;
  /** Tasks due in the range, in projects you can see. */
  tasks: ApiTask[];
  /** Days repeating tasks will be copied to (computed by the server, not stored). */
  occurrences: CalendarOccurrence[];
  /** The newest copy of each series the occurrences come from. */
  series: ApiTask[];
}

export function calendarApi(client: ApiClient) {
  return {
    /** One visible range of days ('YYYY-MM-DD', at most 101). */
    range: (from: string, to: string) => client.get<{ data: CalendarRange }>(`/calendar?from=${from}&to=${to}`).then((r) => r.data),
    /** Open tasks already past their due day (company time). */
    overdue: () => client.get<{ data: ApiTask[] }>('/tasks?overdue=true').then((r) => r.data),
  };
}
