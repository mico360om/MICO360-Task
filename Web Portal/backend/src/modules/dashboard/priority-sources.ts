import type { ApprovalCandidate, DatedCandidate, Priority, TaskCandidate } from './priorities';

/**
 * 1.23.4 Smarter Dashboard — where "My Priorities Today" gets its rows. Each source gathers one kind of
 * thing for the signed-in person, inside the company they picked, as the page that lists that thing today
 * scopes it (rulings in .superpowers/dashboard/progress.md):
 *
 *   tasks            their own open tasks (My Tasks' scope) and — for the people who run projects — the
 *                    tasks there that need them (prisma-priority-sources.ts)
 *   approvals        the tasks waiting for their approval (the To approve list's scope)
 *   action-items     their meeting action items (My Action Items' scope)
 *   checklist-items  1.23.3: open checklist items assigned to them that are overdue or due within 3 days
 *                    (leaves only; a parent follows its sub-items) — CHECKLIST_ITEMS_STUB until then
 *
 * A source gives the facts the ranking needs (priorities.ts) and, in `row`, what the page shows and acts
 * on. Only actions the person may do are offered (`can`); the server's own routes still decide.
 */

/** A signed-in person as a request knows them. */
export interface PriorityViewer {
  id: string;
  roles: string[];
}

export interface SourceRequest {
  viewer: PriorityViewer;
  /** The picked company (X-Company-Id), or null: all of the person's companies. */
  pick: string | null;
  /** Today, 'YYYY-MM-DD' in the company time zone. */
  today: string;
  timeZone: string;
}

export interface ProjectBadge {
  id: string;
  code: string;
  name: string;
  color: string | null;
  icon: string | null;
  imageUrl: string | null;
}

export interface PersonName {
  id: string;
  name: string;
}

/** A task row (own, a team row, or one waiting for approval). Dates are company days, 'YYYY-MM-DD'. */
export interface TaskRowData {
  id: string;
  key: string;
  title: string;
  priority: Priority;
  dueDate: string | null;
  startDate: string | null;
  /** The start date as stored (an Undo of a reschedule that moved it puts this back). */
  startAt: string | null;
  version: number;
  columnId: string;
  project: ProjectBadge;
  assignees: PersonName[];
  /** Its open blockers the person may open ("Blocked by RIG-4"). */
  blockers: { id: string; key: string }[];
  /** The project's Done column a Complete moves it to (its first enabled one); null when it has none. */
  doneColumnId: string | null;
  /** Its repeat rule (a reschedule moves only this occurrence). */
  recurrenceRule: unknown;
  can: { complete: boolean; reschedule: boolean; assign: boolean; approve: boolean };
  /** Waiting for approval: who finished it, and when. */
  requestedBy?: PersonName | null;
  requestedAt?: string | null;
}

export interface ActionItemRowData {
  id: string;
  description: string;
  dueDate: string | null;
  priority: Priority;
  status: string;
  /** Its meeting, when the person may open it. */
  meeting: { id: string; title: string } | null;
  projectId: string | null;
  can: { done: boolean; reschedule: boolean };
}

/** 1.23.3: a checklist item assigned to the person (a leaf), on its task. */
export interface ChecklistItemRowData {
  id: string;
  text: string;
  dueDate: string | null;
  task: { id: string; key: string; title: string; projectId: string };
  can: { tick: boolean; reschedule: boolean };
}

export interface PriorityRowData {
  task?: TaskRowData;
  actionItem?: ActionItemRowData;
  checklistItem?: ChecklistItemRowData;
}

interface Sourced {
  row: PriorityRowData;
  /** The projects whose live events change this row (the page listens to them). */
  watch: string[];
  /** An action item tracked as a board task: left out when that task is a row itself. */
  linkedTaskId?: string | null;
}
export type SourcedCandidate = (TaskCandidate & Sourced) | (ApprovalCandidate & Sourced) | (DatedCandidate & Sourced);

export interface PrioritySource {
  name: string;
  collect(req: SourceRequest): Promise<SourcedCandidate[]>;
}

/**
 * The checklist-items source until 1.23.3 is merged: nothing. The real one returns `kind: 'checklist-item'`
 * candidates — open leaf items assigned to the person, overdue or due within 3 days (their own due date,
 * NORMAL priority unless the item says) — with `row.checklistItem` (`can.tick` false for a parent, which
 * follows its sub-items) and the task's project in `watch`. Already in place: the ranking (overdue / today /
 * upcoming groups and chips), and the page's Tick (PUT /checklist/:itemId { done }, Undo unticks), Reschedule
 * (PUT /checklist/:itemId { dueDate } — the merge confirms the field name, website api/dashboard.ts) and Open
 * task. Left for the merge: opening the task panel AT the item (the 1.23.3 panel's item anchor).
 */
export const CHECKLIST_ITEMS_STUB: PrioritySource = {
  name: 'checklist-items',
  async collect() {
    return [];
  },
};
