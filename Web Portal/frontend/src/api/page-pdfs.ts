import type { ApiClient } from '../lib/api-client';
import { periodParams, type KpiPeriodAsk } from './kpis';

/**
 * 1.24.3 "Download PDF" on the Workspace pages. Each asks the server for a PDF of what the page shows:
 * the server reads the page's own data as the signed-in person, so the PDF never holds more than the page.
 * Pages that filter, search, group or sort in the browser send the rows they show (ids, a board's card
 * keys, a calendar's day items) and their filters in words for the PDF's header.
 */
export interface CalendarPdfAsk {
  view: 'month' | 'week' | 'day' | 'agenda';
  from: string;
  to: string;
  team?: boolean;
  filters: string[];
  days: { day: string; items: { kind: 'task' | 'meeting'; id: string; status?: string }[] }[];
}
export interface ProjectsPdfAsk {
  all?: boolean;
  tab: string;
  ids: string[];
  filters: string[];
}
export interface BoardPdfAsk {
  projectId: string;
  date?: string;
  month?: string;
  columns: { id: string; keys: string[] }[];
  filters: string[];
}
export interface MyTasksPdfAsk {
  groups: { label: string; ids: string[] }[];
  filters: string[];
}

const query = (params: Record<string, string | undefined | null>) => {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  const s = qs.toString();
  return s ? `?${s}` : '';
};

/** The period exactly as the page asks for its KPIs. */
const periodQuery = (p: KpiPeriodAsk) => {
  const s = periodParams(p).toString();
  return s ? `?${s}` : '';
};

export function pagePdfApi(client: ApiClient) {
  return {
    /** My performance ('me') or a person's. */
    performance: (userId: string, period: KpiPeriodAsk) =>
      client.getBlob(userId === 'me' ? `/kpis/people/me/export.pdf${periodQuery(period)}` : `/kpis/people/${encodeURIComponent(userId)}/export.pdf${periodQuery(period)}`),
    workload: (q: { week: string; projectId?: string; q?: string }) => client.getBlob(`/workload.pdf${query({ week: q.week, projectId: q.projectId, q: q.q?.trim() })}`),
    timeline: (q: { from: string; to: string; weekStart: number; owner?: string; show?: string; sort?: string; expanded?: string[] }) =>
      client.getBlob(`/timeline.pdf${query({ from: q.from, to: q.to, weekStart: String(q.weekStart), owner: q.owner, show: q.show, sort: q.sort, expanded: q.expanded?.slice(0, 20).join(',') })}`),
    calendar: (ask: CalendarPdfAsk) => client.postBlob('/calendar.pdf', ask),
    projects: (ask: ProjectsPdfAsk) => client.postBlob('/projects/overview.pdf', ask),
    board: (ask: BoardPdfAsk) => client.postBlob('/board.pdf', ask),
    myTasks: (ask: MyTasksPdfAsk) => client.postBlob('/tasks/mine.pdf', ask),
  };
}
