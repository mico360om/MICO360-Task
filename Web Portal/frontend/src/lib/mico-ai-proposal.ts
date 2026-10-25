/**
 * MICO AI's card of proposed changes, in words: what the card is called, each change's tick-box
 * label, which changes start ticked, what Confirm sends (the ticks and only the edits the person
 * made, which the server checks again), the results and Undo summed up, and the Undo countdown.
 */
import type { ConfirmBody, MeetingFields, ProposalChange } from '../api/mico-ai';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'YYYY-MM-DD' → 'Tue 27 Oct' (a calendar day, read as it is, never shifted). */
export function shortDay(key: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(key ?? '');
  if (!m) return 'No date';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return `${DAYS[d.getUTCDay()]} ${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}`;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The card's heading: "3 new tasks", "2 task changes", "1 meeting to schedule", or "4 changes to make". */
export function cardHeading(items: ProposalChange[]): string {
  const types = new Set(items.map((i) => i.type));
  const n = items.length;
  if (types.size === 1) {
    switch (items[0]!.type) {
      case 'create_task':
        return count(n, 'new task', 'new tasks');
      case 'update_task':
        return count(n, 'task change', 'task changes');
      case 'schedule_meeting':
        return count(n, 'meeting to schedule', 'meetings to schedule');
      case 'draft_minutes':
        return n === 1 ? 'Final minutes draft' : `${n} final minutes drafts`;
    }
  }
  return count(n, 'change to make', 'changes to make');
}

/** What a change's tick box says. */
export function changeLabel(item: ProposalChange): string {
  switch (item.type) {
    case 'create_task':
      return `Create “${item.fields.title.trim() || 'a task'}”`;
    case 'update_task':
      return `Change ${item.task.key}`;
    case 'draft_minutes':
      return `Draft the final minutes of ${item.meeting.title}`;
    case 'schedule_meeting':
      return `Schedule “${item.fields.title.trim() || 'a meeting'}”`;
  }
}

/** Ticked to begin with: every change, except one with something to put right first and one that can't go ahead. */
export function initialTicks(items: ProposalChange[]): Record<string, boolean> {
  return Object.fromEntries(items.map((i) => [i.id, !i.locked && !i.problem]));
}

/**
 * What Confirm sends. A locked change is never included; an edit goes only when one was made — and
 * for a task change only the fields it changes. "Email the invitations" goes only when a meeting is on the card.
 */
export function confirmBody(items: ProposalChange[], ticks: Record<string, boolean>, edits: Record<string, Record<string, unknown>>, sendInvites: boolean): ConfirmBody {
  const out: ConfirmBody = {
    items: items.map((item) => {
      let e = edits[item.id] ?? {};
      if (item.type === 'update_task') e = Object.fromEntries(Object.entries(e).filter(([k]) => k in item.fields));
      const include = !item.locked && !!ticks[item.id];
      return Object.keys(e).length && include ? { id: item.id, include, edits: e } : { id: item.id, include };
    }),
  };
  if (items.some((i) => i.type === 'schedule_meeting')) out.sendInvites = sendInvites;
  return out;
}

/** "2 done, 1 refused, 1 skipped" — or "Nothing was changed: …" when nothing was done. */
export function resultSummary(items: ProposalChange[]): string {
  const n = (s: string) => items.filter((i) => i.result?.status === s).length;
  const done = n('done');
  const rest = [
    [n('refused'), 'refused'],
    [n('failed'), 'failed'],
    [n('skipped'), 'skipped'],
  ]
    .filter(([c]) => Number(c) > 0)
    .map(([c, w]) => `${c} ${w}`);
  if (done === 0) return rest.length ? `Nothing was changed: ${rest.join(', ')}` : 'Nothing was changed';
  return [`${done} done`, ...rest].join(', ');
}

/** "1 put back, 1 left as it was". */
export function undoSummary(items: ProposalChange[]): string {
  const back = items.filter((i) => i.undo?.status === 'undone').length;
  const left = items.filter((i) => i.undo && i.undo.status !== 'undone').length;
  return [`${back} put back`, ...(left ? [`${left} left as ${left === 1 ? 'it was' : 'they were'}`] : [])].join(', ');
}

/** Time left on Undo: "14:32". */
export function countdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** A list edited one item a line. */
export const linesOf = (text: string): string[] =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
export const textOf = (list: string[]): string => list.join('\n');

/** How long a meeting lasts: "30 min", "1 h", "1 h 30 min". */
export function lengthLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h ? `${h} h` : '', m ? `${m} min` : ''].filter(Boolean).join(' ') || '0 min';
}

/** When a meeting is: "Tue 27 Oct, 10:00–10:30" (in the company's time, as the card gives it). */
export function meetingWhen(f: Pick<MeetingFields, 'date' | 'time' | 'minutes'>): string {
  const day = shortDay(f.date);
  const t = /^(\d{2}):(\d{2})$/.exec(f.time ?? '');
  if (!t) return `${day}, time to pick`;
  const end = (Number(t[1]) * 60 + Number(t[2]) + f.minutes) % (24 * 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${day}, ${f.time}–${pad(Math.floor(end / 60))}:${pad(end % 60)}`;
}
