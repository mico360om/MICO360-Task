import type { TaskSection } from './task-detail';

/** The task screen's sections with Stage 4's cards: Client view (whoever runs the project). */
export type TaskPart = TaskSection | 'client';

type Layout = { top: TaskPart[]; main: TaskPart[]; side: TaskPart[] };

/**
 * Stage 4's cards placed in the task screen's order (lib/task-detail taskSections), as the website's
 * TaskDrawer puts them: "Client view" first of the parts beside the work — after the comments on a
 * phone, under the details on a wide screen — before the approval, the files and the blockers.
 */
export function withTaskCards(l: { top: TaskSection[]; main: TaskSection[]; side: TaskSection[] }, o: { client: boolean }): Layout {
  const place = (list: TaskPart[]): TaskPart[] => {
    if (!list.includes('files')) return list;
    const out = [...list];
    if (o.client) out.splice(out.findIndex((p) => p === 'approval' || p === 'files'), 0, 'client');
    return out;
  };
  return { top: [...l.top], main: place(l.main), side: place(l.side) };
}
