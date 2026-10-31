import { ApiError } from './api-client';
import { dayText, instantDayText } from './day-words';
import { defaultScheduleName, firstCheckDay, presetOf, presetRule, shortDay, type SchedulePreset } from './inspection-schedule';
import type { InspectionSchedule } from './inspection-types';
import type { RecurrenceRule } from './recurrence';
import type { ApiColumn } from './types';

/**
 * Schedule an inspection (or change a schedule), as the website's schedule dialog: which form, what
 * the checks are called, where, who does them, from when and how often. Every check is a task due
 * on its day for the inspectors, made on schedule whether or not the one before was done — saved
 * through the tasks API (the schedule is the series' newest copy, which carries the repeat). Online
 * only, as on the website.
 */

export interface ScheduleDraft {
  formId: string;
  formTitle: string;
  place: string;
  name: string;
  /** The person typed the name: it no longer follows the form and place. */
  nameTyped: boolean;
  inspectorIds: string[];
  /** 'YYYY-MM-DD' (a new schedule only). */
  startsOn: string;
  preset: SchedulePreset;
  rule: RecurrenceRule;
}

export type ScheduleCreateBody = {
  title: string;
  projectId: string;
  columnId: string;
  dueDate: string;
  recurrenceRule: RecurrenceRule;
  assigneeIds: string[];
  inspectionFormId: string;
  inspectionPlace: string | null;
};

const onSchedule = (rule: RecurrenceRule): RecurrenceRule => ({ ...rule, createNext: 'ON_SCHEDULE' });
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** How the series ends is kept when another preset (or start day) is picked. */
const keepEnds = (from: RecurrenceRule, next: RecurrenceRule): RecurrenceRule => ({ ...next, ...(from.count != null ? { count: from.count } : {}), ...(from.until ? { until: from.until } : {}) });

const named = (d: ScheduleDraft): ScheduleDraft => (d.nameTyped ? d : { ...d, name: defaultScheduleName(d.formTitle, d.place) });

/** A new schedule: from today, every working day. */
export function newScheduleDraft(today: string, workingDays: number[]): ScheduleDraft {
  return { formId: '', formTitle: '', place: '', name: '', nameTyped: false, inspectorIds: [], startsOn: today, preset: 'WORKING_DAYS', rule: presetRule('WORKING_DAYS', today, workingDays) };
}

/** A schedule to change: its preset worked out from its repeat; a name unlike the form's and place's counts as typed. */
export function editScheduleDraft(s: InspectionSchedule, workingDays: number[]): ScheduleDraft {
  return {
    formId: s.form.id,
    formTitle: s.form.title,
    place: s.place ?? '',
    name: s.title,
    nameTyped: s.title !== defaultScheduleName(s.form.title, s.place ?? ''),
    inspectorIds: s.assignees.map((a) => a.id),
    startsOn: s.nextDue ?? '',
    preset: presetOf(s.rule, workingDays),
    rule: onSchedule(s.rule),
  };
}

export const withForm = (d: ScheduleDraft, form: { id: string; title: string }): ScheduleDraft => named({ ...d, formId: form.id, formTitle: form.title });
export const withPlace = (d: ScheduleDraft, place: string): ScheduleDraft => named({ ...d, place });
export const withName = (d: ScheduleDraft, name: string): ScheduleDraft => ({ ...d, name, nameTyped: true });

/** "Weekly on…" and "Monthly" follow the start day's weekday and date until changed by hand. */
export function withStartsOn(d: ScheduleDraft, day: string, workingDays: number[]): ScheduleDraft {
  const next = { ...d, startsOn: day };
  if (DAY_KEY.test(day) && (d.preset === 'WEEKLY' || d.preset === 'MONTHLY')) next.rule = keepEnds(d.rule, presetRule(d.preset, day, workingDays));
  return next;
}

export function withPreset(d: ScheduleDraft, preset: SchedulePreset, workingDays: number[]): ScheduleDraft {
  if (preset === 'CUSTOM') return { ...d, preset };
  return { ...d, preset, rule: keepEnds(d.rule, presetRule(preset, d.startsOn, workingDays)) };
}

/** The first check's day for a new schedule (null when editing, or before a valid start day). */
export function firstDayOf(d: ScheduleDraft, editing: boolean): string | null {
  return editing || !DAY_KEY.test(d.startsOn) ? null : firstCheckDay(d.startsOn, d.rule);
}

/** What is wrong, in the website's order: form, inspectors, name, start day (new only), the end. */
export function checkSchedule(d: ScheduleDraft, o: { today: string; editing: boolean }): { ok: true } | { ok: false; field: 'form' | 'inspectors' | 'name' | 'startsOn' | 'repeat'; message: string } {
  const firstDay = firstDayOf(d, o.editing);
  if (!d.formId) return { ok: false, field: 'form', message: 'Pick a form.' };
  if (!d.inspectorIds.length) return { ok: false, field: 'inspectors', message: 'Pick at least one inspector.' };
  if (!d.name.trim()) return { ok: false, field: 'name', message: 'Give the schedule a name.' };
  if (!o.editing && (!DAY_KEY.test(d.startsOn) || d.startsOn < o.today)) return { ok: false, field: 'startsOn', message: 'Pick today or a later day to start.' };
  if (d.rule.until && firstDay && String(d.rule.until).slice(0, 10) < firstDay) return { ok: false, field: 'repeat', message: 'The repeat can’t end before the first check.' };
  return { ok: true };
}

/** A new schedule as the tasks API makes it: the first check due on its day, its checks made on schedule. */
export function scheduleCreateBody(d: ScheduleDraft, projectId: string, columnId: string): ScheduleCreateBody {
  return {
    title: d.name.trim(),
    projectId,
    columnId,
    dueDate: firstCheckDay(d.startsOn, d.rule),
    recurrenceRule: onSchedule(d.rule),
    assigneeIds: d.inspectorIds,
    inspectionFormId: d.formId,
    inspectionPlace: d.place.trim() || null,
  };
}

/** An edit: only what changed, always for the series' newest copy as the list showed it (else 409, nothing saved). */
export function scheduleEditPatch(d: ScheduleDraft, s: InspectionSchedule): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const title = d.name.trim();
  if (title !== s.title) patch.title = title;
  if (d.formId !== s.form.id) patch.inspectionFormId = d.formId;
  if ((d.place.trim() || null) !== (s.place ?? null)) patch.inspectionPlace = d.place.trim() || null;
  const rule = onSchedule(d.rule);
  // Compared with the rule as stored: one that waits for each check is put on schedule by saving.
  if (JSON.stringify(rule) !== JSON.stringify(s.rule)) patch.recurrenceRule = rule;
  return { ...patch, expectedVersion: s.version, requireNewest: true };
}

/** The inspectors to add and to take off, after an edit is saved. */
export function inspectorChanges(d: Pick<ScheduleDraft, 'inspectorIds'>, s: Pick<InspectionSchedule, 'assignees'>): { add: string[]; remove: string[] } {
  const before = s.assignees.map((a) => a.id);
  return { add: d.inspectorIds.filter((id) => !before.includes(id)), remove: before.filter((id) => !d.inspectorIds.includes(id)) };
}

export const NO_COLUMNS = 'This project has no columns to put the checks in.';

/** Where the checks go: the first column (by position) that is on and not done, else the first that is on. */
export function checksColumn(columns: readonly ApiColumn[]): string | null {
  const sorted = [...columns].sort((a, b) => a.position - b.position);
  return (sorted.find((c) => c.enabled !== false && c.category !== 'DONE') ?? sorted.find((c) => c.enabled !== false))?.id ?? null;
}

export const STALE_SCHEDULE = 'This schedule changed — check it again.';

/** The schedule changed since the list was read (the repeat moved on to a newer copy, or an edit). */
export function isStaleSchedule(e: unknown): boolean {
  return e instanceof ApiError && e.status === 409 && (e.code === 'VERSION_CONFLICT' || e.code === 'RECURRENCE_NOT_NEWEST');
}

/** A schedule row's lines: its repeat, the next check (or Paused / No more checks), the last done, how many late. */
export function scheduleLines(s: InspectionSchedule, timeZone: string): { repeat: string; next: string | null; last: string; late: string | null } {
  const last = s.lastDone ? `Last done ${DAY_KEY.test(s.lastDone) ? dayText(s.lastDone) : instantDayText(s.lastDone, timeZone)}` : 'Not done yet';
  const next = s.nextDue ? `Next due ${shortDay(s.nextDue)}` : s.paused ? 'Paused' : s.onSchedule !== false ? 'No more checks' : null;
  return { repeat: s.repeat, next, last, late: s.lateChecks > 0 ? `${s.lateChecks} late` : null };
}

/** The schedule sheet's and the schedules section's words, the website's. */
export const SCHEDULE_WORDS = {
  newTitle: 'Schedule an inspection',
  editTitle: 'Edit schedule',
  newIntro: 'Each check arrives as a task on its day, for the inspectors. A missed one stays open as late, and can still be done.',
  editIntro: 'Changes apply to the checks made from now on. Checks already made stay as they are.',
  form: 'Form',
  loadingForms: 'Loading forms…',
  chooseForm: 'Choose a form',
  noForms: 'No inspection forms yet',
  formsFailed: 'Couldn’t load the forms.',
  place: 'Place (optional)',
  placePlaceholder: 'e.g. Rig 3',
  name: 'Name',
  namePlaceholder: 'Picked from the form and place',
  inspectors: 'Inspectors',
  addInspectors: 'Add inspectors',
  allInspectors: 'Everyone on this project is an inspector.',
  inspectorsNote: 'The same people get every check. They can change it on the schedule later.',
  startsOn: 'Starts on',
  repeat: 'Repeat',
  cancel: 'Cancel',
  save: 'Save changes',
  schedule: 'Schedule it',
  saveFailed: 'Couldn’t save the changes. Check your connection and try again.',
  scheduleFailed: 'Couldn’t schedule it. Check your connection and try again.',
  schedules: 'Schedules',
  add: 'Schedule an inspection',
  loadFailed: 'Couldn’t load the schedules.',
  retry: 'Retry',
  none: 'No schedules yet.',
  noneCanChange: 'Schedule an inspection to have each check arrive as a task on its day, for its inspectors.',
  edit: 'Edit',
  editLabel: 'Edit {title}',
  stop: 'Stop',
  stopLabel: 'Stop {title}',
  saved: 'Saved. The checks made from now on follow the new schedule.',
  scheduled: 'Scheduled. The first check is on its way to the inspectors.',
  stopTitle: 'Stop scheduling?',
  stopConfirm: 'Stop scheduling',
  stopBody: 'No more checks of “{title}” will be made. Checks already created stay.',
  stopped: 'Stopped “{title}”. Checks already made stay.',
  stopFailed: 'Couldn’t stop it. Check your connection and try again.',
} as const;
