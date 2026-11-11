import type { ScheduleSteps } from '../../api/notification-settings';

const wd = (n: number) => `${n} working day${n === 1 ? '' : 's'}`;
const list = (ns: number[]) => (ns.length === 1 ? String(ns[0]) : `${ns.slice(0, -1).join(', ')} and ${ns.at(-1)}`);

/** A schedule in words: "2 working days before · on the due morning · 1 working day after · then every 2 working days". */
export function scheduleText(s: ScheduleSteps): string {
  const parts: string[] = [];
  if (s.before.length) parts.push(`${s.before.length === 1 ? wd(s.before[0]!) : `${list(s.before)} working days`} before`);
  if (s.onDue) parts.push('on the due morning');
  if (s.after.length) parts.push(`${s.after.length === 1 ? wd(s.after[0]!) : `${list(s.after)} working days`} after`);
  if (s.repeatEvery) parts.push(s.repeatEvery === 1 ? 'then every working day while overdue' : `then every ${wd(s.repeatEvery)} while overdue`);
  return parts.length ? parts.join(' · ') : 'No reminders';
}

/** "5, 2 1" → [5, 2, 1] (whole working days 1–30, each once); null when something else was typed. */
export function readDays(text: string): number[] | null {
  const bits = text.split(/[\s,;]+/).filter(Boolean);
  const ns = bits.map((b) => (/^\d+$/.test(b) ? Number(b) : NaN));
  if (ns.some((n) => !Number.isInteger(n) || n < 1 || n > 30)) return null;
  return [...new Set(ns)];
}

/** A schedule's steps from the editor's fields; a problem in words, or the steps. */
export function readSchedule(draft: { before: string; onDue: boolean; after: string; repeat: string }): { ok: true; steps: ScheduleSteps } | { ok: false; problem: string } {
  const before = readDays(draft.before);
  const after = readDays(draft.after);
  if (!before) return { ok: false, problem: 'Days before: whole working days from 1 to 30, like “5, 2, 1”.' };
  if (!after) return { ok: false, problem: 'Days after: whole working days from 1 to 30, like “1, 3”.' };
  const repeat = draft.repeat.trim() === '' ? null : Number(draft.repeat);
  if (repeat !== null && (!Number.isInteger(repeat) || repeat < 1 || repeat > 10)) return { ok: false, problem: 'Repeat every: 1 to 10 working days, or leave it empty.' };
  const steps: ScheduleSteps = { before: before.sort((a, b) => b - a), onDue: draft.onDue, after: after.sort((a, b) => a - b), repeatEvery: repeat };
  if (!steps.before.length && !steps.onDue && !steps.after.length && !steps.repeatEvery) return { ok: false, problem: 'Choose at least one reminder.' };
  return { ok: true, steps };
}

/** The editor's fields for a schedule. */
export function draftOf(s: ScheduleSteps): { before: string; onDue: boolean; after: string; repeat: string } {
  return { before: s.before.join(', '), onDue: s.onDue, after: s.after.join(', '), repeat: s.repeatEvery ? String(s.repeatEvery) : '' };
}
