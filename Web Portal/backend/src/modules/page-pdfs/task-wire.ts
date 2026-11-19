/** The task and project fields the page PDFs print, as the pages' own routes send them (JSON: dates as strings). */
import { dueDayKey } from '../../lib/due-date';

export interface TaskWire {
  id: string;
  key: string;
  title: string;
  projectId: string;
  columnId: string;
  columnCategory?: string | null;
  columnHidden?: boolean;
  priority: string;
  startDate: string | null;
  dueDate: string | null;
  progress: number;
  completedAt?: string | null;
  approvalRequestedAt?: string | null;
  isMilestone?: boolean;
  assignees?: { id: string; name: string }[];
  counts?: { comments: number; attachments: number; checklistDone: number; checklistTotal: number };
}

export interface ProjectRef {
  id: string;
  code: string;
  name: string;
  color?: string | null;
  number?: string | null;
}

/** A due date's company day ('YYYY-MM-DD'), as the pages read it. */
export const dueKeyOf = (value: string | null | undefined, timeZone: string): string | null => dueDayKey(value ?? null, timeZone);

/** Done: in a Done column or completed. */
export const isDone = (t: Pick<TaskWire, 'columnCategory' | 'completedAt'>): boolean => t.columnCategory === 'DONE' || !!t.completedAt;

/** Overdue as the pages say it: due before today, not done, not waiting for approval. */
export function isOverdue(t: TaskWire, today: string, timeZone: string): boolean {
  const due = dueKeyOf(t.dueDate, timeZone);
  return !!due && due < today && !isDone(t) && !t.approvalRequestedAt;
}

/** "Omar Said, Mariam +2". */
export function assigneeWords(t: Pick<TaskWire, 'assignees'>, max = 2): string {
  const names = (t.assignees ?? []).map((a) => a.name);
  if (names.length === 0) return 'Unassigned';
  return names.length > max ? `${names.slice(0, max).join(', ')} +${names.length - max}` : names.join(', ');
}

/** "3/5" checklist items done, or '' without a checklist. */
export function checklistWords(t: Pick<TaskWire, 'counts'>): string {
  const c = t.counts;
  return c && c.checklistTotal > 0 ? `${c.checklistDone}/${c.checklistTotal}` : '';
}
