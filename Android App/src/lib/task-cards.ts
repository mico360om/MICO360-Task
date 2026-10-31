import type { TaskSection } from './task-detail';

/** The task screen's sections with Stage 4's cards: Client view (whoever runs the project) and Inspections. */
export type TaskPart = TaskSection | 'client' | 'inspections';

type Layout = { top: TaskPart[]; main: TaskPart[]; side: TaskPart[] };

/**
 * Stage 4's cards placed in the task screen's order (lib/task-detail taskSections), as the website's
 * TaskDrawer puts them: "Client view" first of the parts beside the work — after the comments on a
 * phone, under the details on a wide screen — then the approval, then a task's Inspections (any task
 * but a check), then the files and the blockers. A check (a task that carries a form) is done by
 * carrying out its inspection: its Inspections card comes first, after an approval that waits.
 */
export function withTaskCards(
  l: { top: TaskSection[]; main: TaskSection[]; side: TaskSection[] },
  o: { client: boolean; inspections?: 'check' | 'other' | null },
): Layout {
  const place = (list: TaskPart[]): TaskPart[] => {
    if (!list.includes('files')) return list;
    const out = [...list];
    if (o.inspections === 'other') out.splice(out.indexOf('files'), 0, 'inspections');
    if (o.client) out.splice(out.findIndex((p) => p === 'approval' || p === 'inspections' || p === 'files'), 0, 'client');
    return out;
  };
  return { top: o.inspections === 'check' ? [...l.top, 'inspections'] : [...l.top], main: place(l.main), side: place(l.side) };
}
