import type { FinalMinutesContent } from '../meetings/final-minutes';

/**
 * What MICO AI proposes when the person asks it to make or change something: a card of changes,
 * each one checked by the server for that person (names resolved to records, days worked out in
 * company time, permissions applied) and stored with the answer. Nothing happens until the person
 * confirms the card; Confirm acts on this stored version, with only the person's own edits (checked
 * again) on top. After it, each change can be undone for 15 minutes.
 */

export type ChangeType = 'create_task' | 'update_task' | 'draft_minutes' | 'schedule_meeting';
export const CHANGE_TYPES: readonly ChangeType[] = ['create_task', 'update_task', 'draft_minutes', 'schedule_meeting'];
export type Priority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
export const PRIORITIES: readonly Priority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

/** At most this many changes on one card. */
export const MAX_CHANGES = 50;
/** How long Undo stays available after Confirm. */
export const UNDO_WINDOW_MS = 15 * 60_000;

export interface Named {
  id: string;
  name: string;
}

interface ItemBase {
  /** c1, c2 … within the card. */
  id: string;
  type: ChangeType;
  /** Something to put right first (by editing it): the change starts unticked. */
  problem: string | null;
  /** It can't go ahead at all (no permission, nothing to change): no tick box. */
  locked: boolean;
  /** Worth a look but fine ("This replaces the draft saved on …"). */
  warning: string | null;
}

export interface CreateTaskFields {
  title: string;
  projectId: string | null;
  assigneeIds: string[];
  /** 'YYYY-MM-DD' or none. */
  due: string | null;
  priority: Priority;
  description: string;
}

export interface CreateTaskItem extends ItemBase {
  type: 'create_task';
  fields: CreateTaskFields;
  labels: { project: string | null; assignees: Named[] };
  /** No one was named, so it goes to the project's owner (as any new task does). */
  ownerDefault?: boolean;
}

/** A task's fields MICO AI can change. */
export interface TaskChangeFields {
  /** 'YYYY-MM-DD'; null removes the due date. */
  due?: string | null;
  priority?: Priority;
  /** The column (status) it moves to, in its own project. */
  columnId?: string;
  /** Who it is assigned to afterwards. */
  assigneeIds?: string[];
}

export interface UpdateTaskItem extends ItemBase {
  type: 'update_task';
  task: { id: string; key: string; title: string; projectId: string; project: string; url: string };
  /** The task as it was when proposed: Confirm refuses if it changed since. */
  base: { version: number; assigneeIds: string[] };
  /** Its fields before the change (each changed field, shown "before → after"). */
  before: { due: string | null; priority: Priority; columnId: string; column: string; assignees: Named[] };
  /** Only the fields that change. */
  fields: TaskChangeFields;
  labels: { column?: string; assignees?: Named[] };
}

export interface MinutesItem extends ItemBase {
  type: 'draft_minutes';
  meeting: { id: string; title: string; startAt: string; url: string };
  fields: { content: FinalMinutesContent };
  /** The final minutes as they were when proposed: Confirm refuses if they changed since. */
  base: { status: 'NONE' | 'DRAFT' | 'APPROVED'; savedAt: string | null };
}

export interface MeetingFields {
  title: string;
  projectId: string | null;
  /** 'YYYY-MM-DD' and 'HH:MM' in the company time zone. */
  date: string | null;
  time: string | null;
  /** How long, in minutes. */
  minutes: number;
  /** Who is invited (the person is the organizer). */
  attendeeIds: string[];
  agenda: string[];
  description: string;
}

export interface MeetingItem extends ItemBase {
  type: 'schedule_meeting';
  fields: MeetingFields;
  labels: { project: string | null; attendees: Named[] };
}

export type ProposalItem = CreateTaskItem | UpdateTaskItem | MinutesItem | MeetingItem;

/** A card as the checks made it, before it is stored. */
export interface ProposalDraft {
  items: ProposalItem[];
  /** A note for the whole card ("Only the first 50 changes are here"). */
  note: string | null;
}

/** What Undo needs to put a change back (kept on the server only). */
export type UndoData =
  | { kind: 'task-created'; taskId: string; projectId: string; version: number; activity: number; assigneeIds: string[] }
  | {
      kind: 'task-updated';
      taskId: string;
      projectId: string;
      version: number;
      activity: number;
      assigneeIds: string[];
      /** The changed fields as they were before. */
      before: TaskChangeFields;
    }
  | { kind: 'meeting-created'; meetingId: string; stamp: string; invited: boolean }
  | {
      kind: 'minutes-saved';
      meetingId: string;
      savedAt: string;
      previous: { content: FinalMinutesContent; status: 'DRAFT' | 'APPROVED'; approvedById: string | null; approvedAt: string | null } | null;
    };

export type ResultStatus = 'done' | 'refused' | 'failed' | 'skipped';
export interface ItemResult {
  status: ResultStatus;
  message: string | null;
  /** Where to see it ("Open RIG-31"). */
  link: { label: string; url: string } | null;
  undo?: UndoData;
}

export interface ItemUndo {
  status: 'undone' | 'refused' | 'failed';
  message: string | null;
}

export type ProposalStatus = 'PROPOSED' | 'CONFIRMING' | 'DONE' | 'CANCELLED' | 'UNDOING' | 'UNDONE';

/** A card as stored with its answer. */
export interface ProposalRecord {
  id: string;
  messageId: string;
  userId: string;
  status: ProposalStatus;
  items: ProposalItem[];
  note: string | null;
  /** The card's "Email the invitations" tick box (on by default), as confirmed. */
  sendInvites: boolean;
  /** Per change, once confirmed. */
  results: Record<string, ItemResult> | null;
  /** Per change, once undone. */
  undo: Record<string, ItemUndo> | null;
  confirmedAt: Date | null;
  undoUntil: Date | null;
  undoneAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** The person's own changes to the card, sent with Confirm (checked again on the server). */
export interface ItemChoice {
  id: string;
  include: boolean;
  edits?: Record<string, unknown>;
}

/** A card as the page shows it. */
export interface ProposalView {
  id: string;
  status: 'proposed' | 'confirming' | 'done' | 'cancelled' | 'undoing' | 'undone';
  note: string | null;
  sendInvites: boolean;
  /** The card schedules a meeting (so "Email the invitations" applies). */
  hasMeetings: boolean;
  items: Array<ProposalItem & { result: Omit<ItemResult, 'undo'> | null; undo: ItemUndo | null }>;
  confirmedAt: string | null;
  undoUntil: string | null;
  /** Undo is open: confirmed, within 15 minutes, and something was done. */
  canUndo: boolean;
}

/** What the checks made of a "propose" reply. */
export type ProposeOutcome =
  | { kind: 'card'; card: ProposalDraft }
  /** A name or project could mean several: ask, with the candidates as quick replies. */
  | { kind: 'clarify'; question: string; options: string[] }
  /** Names nothing matched: told to the model once, so it can look them up or ask. */
  | { kind: 'retry'; problems: string[] }
  /** Nothing on it could be done: said plainly instead of an empty card. */
  | { kind: 'answer'; text: string };
