import type { ApiClient } from '../lib/api-client';

/**
 * Calendar scheduling on one task: its planned time (work blocks — each person's time to work on it)
 * and my reminders about it (and the ones I set for its people). The server owns the rules
 * (modules/calendar): who plans or reminds whom, who may change what.
 */

export interface TaskBlock {
  id: string;
  taskId: string;
  userId: string;
  userName: string;
  plannedById: string;
  plannedByName: string;
  startAt: string;
  endAt: string;
  canChange: boolean;
}

export type ReminderState = 'wait' | 'send' | 'sent' | 'missed' | 'muted' | 'hidden' | 'none';

export interface TaskReminder {
  id: string;
  taskId: string;
  userId: string;
  userName: string;
  setById: string;
  setByName: string;
  at: string | null;
  anchor: 'start' | 'due' | null;
  offsetMinutes: number | null;
  fireAt: string | null;
  state: ReminderState;
  muted: boolean;
  snoozedUntil: string | null;
  sentAt: string | null;
  /** I set it: I change or remove it. */
  canChange: boolean;
  /** Someone else set it for me: I mute it for myself. */
  canMute: boolean;
}

/** Whose time I may plan / whom I may remind on this task (me, and its people when I made it or run its project). */
export interface ForPeople {
  forPeople: string[];
}

export type ReminderTiming = { at: string } | { anchor: 'start' | 'due'; offsetMinutes: number };

const base = (taskId: string) => `/tasks/${encodeURIComponent(taskId)}`;

export function schedulingApi(client: ApiClient) {
  return {
    blocks: (taskId: string) => client.get<{ data: TaskBlock[]; meta?: ForPeople }>(`${base(taskId)}/work-blocks`).then((r) => ({ blocks: r.data, forPeople: r.meta?.forPeople ?? [] })),
    addBlock: (taskId: string, body: { userId?: string; startAt: string; endAt: string }) =>
      client.post<{ data: TaskBlock }>(`${base(taskId)}/work-blocks`, body).then((r) => r.data),
    moveBlock: (taskId: string, blockId: string, body: { startAt: string; endAt: string }) =>
      client.put<{ data: TaskBlock }>(`${base(taskId)}/work-blocks/${encodeURIComponent(blockId)}`, body).then((r) => r.data),
    removeBlock: (taskId: string, blockId: string) => client.del<void>(`${base(taskId)}/work-blocks/${encodeURIComponent(blockId)}`),
    reminders: (taskId: string) =>
      client.get<{ data: TaskReminder[]; meta?: ForPeople }>(`${base(taskId)}/reminders`).then((r) => ({ reminders: r.data, forPeople: r.meta?.forPeople ?? [] })),
    addReminder: (taskId: string, body: ReminderTiming & { userId?: string }) => client.post<{ data: TaskReminder }>(`${base(taskId)}/reminders`, body).then((r) => r.data),
    changeReminder: (taskId: string, reminderId: string, body: ReminderTiming) =>
      client.put<{ data: TaskReminder }>(`${base(taskId)}/reminders/${encodeURIComponent(reminderId)}`, body).then((r) => r.data),
    removeReminder: (taskId: string, reminderId: string) => client.del<void>(`${base(taskId)}/reminders/${encodeURIComponent(reminderId)}`),
    mute: (taskId: string, reminderId: string, muted: boolean) =>
      client.post<{ data: TaskReminder }>(`${base(taskId)}/reminders/${encodeURIComponent(reminderId)}/mute`, { muted }).then((r) => r.data),
    snooze: (taskId: string, reminderId: string, body: { minutes: number } | { until: null }) =>
      client.post<{ data: TaskReminder }>(`${base(taskId)}/reminders/${encodeURIComponent(reminderId)}/snooze`, body).then((r) => r.data),
  };
}
