/**
 * Activity lines in words, as the Activity page shows them (1.23.5: the project page's Recent activity
 * reads the same): the verb and its colour, the dot, the task's title and what changed.
 */
import type { ApiActivity } from '../api/activity';

export const ACTION_VERB: Record<string, string> = {
  CREATED: 'created',
  MOVED: 'moved',
  COMPLETED: 'completed',
  REOPENED: 'reopened',
  ASSIGNED: 'assigned',
  PROJECT_CHANGED: 'moved',
  PROJECT_MOVED_OUT: 'moved',
  // Task approvals.
  APPROVAL_REQUESTED: 'asked for approval on',
  APPROVED: 'approved',
  SENT_BACK: 'sent back',
  APPROVAL_WITHDRAWN: 'withdrew the approval request on',
  // Companies: a line on the project itself (no task).
  PROJECT_COMPANIES_CHANGED: 'changed the companies of',
};
/** Lines about a project itself: they name the project, not "a task". */
export const PROJECT_LINES = new Set(['PROJECT_COMPANIES_CHANGED']);
export const ACTION_TONE: Record<string, string> = {
  CREATED: 'text-info',
  MOVED: 'text-ink-2',
  COMPLETED: 'text-success',
  REOPENED: 'text-warning',
  ASSIGNED: 'text-brand',
  PROJECT_CHANGED: 'text-ink-2',
  PROJECT_MOVED_OUT: 'text-ink-2',
  APPROVAL_REQUESTED: 'text-brand',
  APPROVED: 'text-success',
  SENT_BACK: 'text-warning',
  APPROVAL_WITHDRAWN: 'text-ink-2',
};
export const ACTION_DOT: Record<string, string> = {
  CREATED: 'bg-info',
  MOVED: 'bg-ink-3',
  COMPLETED: 'bg-success',
  REOPENED: 'bg-warning',
  ASSIGNED: 'bg-brand',
  APPROVAL_REQUESTED: 'bg-brand',
  APPROVED: 'bg-success',
  SENT_BACK: 'bg-warning',
};
const str = (v: unknown) => (typeof v === 'string' ? v : null);

/** The task's title — for a line on no task (the old project's "moved out" line), the one it recorded. */
export const titleOf = (a: ApiActivity): string => a.task?.title ?? str(a.meta?.title) ?? '';

/** The human "what happened" line, using the recorded old→new meta where available. */
export function detailOf(a: ApiActivity): string {
  const m = a.meta ?? {};
  const from = str(m.from);
  const to = str(m.to);
  switch (a.action) {
    case 'MOVED':
      return to ? `${from ?? '—'} → ${to}` : '';
    case 'COMPLETED':
      return to ? `marked complete in ${to}` : 'marked complete';
    case 'REOPENED':
      return to ? `re-opened in ${to}` : 're-opened';
    case 'APPROVED':
      return to ? `done in ${to}` : '';
    case 'SENT_BACK':
      return str(m.reason) ? `“${str(m.reason)}”` : '';
    case 'ASSIGNED':
      return str(m.assignee) ? `→ ${str(m.assignee)}` : '';
    case 'PROJECT_CHANGED': {
      // To another project: from where, by the key it had there ("from Rig Inspection (RIG-4) to Operations").
      const fromProject = str(m.fromProject);
      const toProject = str(m.toProject);
      const fromKey = str(m.fromKey);
      if (!fromProject || !toProject) return toProject ? `to ${toProject}` : 'to another project';
      return `from ${fromProject}${fromKey ? ` (${fromKey})` : ''} to ${toProject}`;
    }
    case 'PROJECT_MOVED_OUT': {
      // The old project's line, on no task: the key it had here, and where it went ("RIG-4 to Operations (OPS-17)").
      const key = str(m.key);
      const toProject = str(m.toProject);
      const toKey = str(m.toKey);
      const where = toProject ? `to ${toProject}${toKey ? ` (${toKey})` : ''}` : 'to another project';
      return key ? `${key} ${where}` : where;
    }
    case 'PROJECT_COMPANIES_CHANGED': {
      // "added Alpha Co; removed Prolens Projects LLC; main company now Alpha Co"
      const names = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
      const list = (n: string[]) => (n.length < 2 ? n.join('') : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`);
      const added = names(m.added);
      const removed = names(m.removed);
      const main = str(m.main);
      return [added.length ? `added ${list(added)}` : null, removed.length ? `removed ${list(removed)}` : null, main ? `main company now ${main}` : null].filter(Boolean).join('; ');
    }
    default:
      return '';
  }
}
