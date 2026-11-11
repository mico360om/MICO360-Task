/**
 * Notification & Scheduling centre: the company's notification rules (the admin panel) and how a
 * person's own choices sit on top of them. Pure — no database, no clock — so the planner, the
 * delivery rules, the routes and the tests share one reading.
 *
 *   - A notice `type` (TASK_OVERDUE, MENTION, …) belongs to one *kind* (overdue, mentions, …): the
 *     rows of the settings tables. Types in no kind (MICO AI answers, direct messages, the digest)
 *     follow quiet hours only.
 *   - Each kind has three channels: the bell (the in-app notice), the phone push (the bell's copy on
 *     the phone, so it needs the bell) and email. The company sets their defaults; a person fine-tunes.
 *   - A kind the company marks *required* keeps its bell and push on for everyone (email stays each
 *     person's choice; quiet hours and Pause still hold the push).
 *   - `muted` (the list of types older apps save) still means "bell off" for that type: older apps
 *     keep working, and a type muted before the upgrade stays off on every channel.
 */

/** The kinds, in the order the settings tables show them. */
export const POLICY_KINDS = [
  'assigned',
  'dueSoon',
  // Calendar scheduling: a person's own reminders on tasks (and those their manager set for them).
  'reminders',
  'overdue',
  'escalation',
  'escalationAdmin',
  'approvals',
  'approvalWaiting',
  'inactivity',
  'mentions',
  'comments',
  'status',
  'projectAdded',
  'meetings',
] as const;
export type PolicyKind = (typeof POLICY_KINDS)[number];

/** The notice types of each kind. */
export const KIND_TYPES: Record<PolicyKind, readonly string[]> = {
  assigned: ['TASK_ASSIGNED'],
  dueSoon: ['TASK_DUE_SOON'],
  reminders: ['TASK_REMINDER'],
  overdue: ['TASK_OVERDUE'],
  // Step 1 (and Blocked tasks): to whoever runs the project.
  escalation: ['TASK_ESCALATION'],
  // Step 2: to the company's admins or the people chosen (overdue tasks and approvals waiting).
  escalationAdmin: ['TASK_ESCALATION_ADMIN'],
  approvals: ['TASK_APPROVAL', 'TASK_CLIENT_SIGN_OFF'],
  // An approval waiting too long: to the approver.
  approvalWaiting: ['TASK_APPROVAL_WAITING'],
  inactivity: ['TASK_INACTIVE'],
  mentions: ['MENTION', 'CHAT_MENTION'],
  comments: ['TASK_COMMENT'],
  status: ['TASK_STATUS'],
  projectAdded: ['PROJECT_ADDED'],
  meetings: ['MEETING_REMINDER'],
};

/** The reminders the planner makes; an admin can turn each off for the company. */
export const REMINDER_KINDS = ['dueSoon', 'overdue', 'escalation', 'escalationAdmin', 'approvalWaiting', 'inactivity'] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];

/** Kinds whose email the company's other settings decide (meeting reminder times have their own "also by email"). */
export const NO_EMAIL_CHANNEL: readonly PolicyKind[] = ['meetings'];

const KIND_OF_TYPE = new Map<string, PolicyKind>(POLICY_KINDS.flatMap((k) => KIND_TYPES[k].map((t) => [t, k] as const)));

export function policyKindOfType(type: string): PolicyKind | null {
  return KIND_OF_TYPE.get(type) ?? null;
}

export interface Channels {
  bell: boolean;
  push: boolean;
  email: boolean;
}

export type QuietMode = 'workingHours' | 'custom';

/** The company's quiet hours: outside working hours (and on days off), or nightly between two times. */
export interface CompanyQuietHours {
  mode: QuietMode;
  /** For 'custom': quiet from `start` until `end` the next morning (company time). */
  start: string;
  end: string;
  /** Whether meeting reminders and @mentions come through quiet hours (each person can change theirs). */
  meetings: boolean;
  mentions: boolean;
}

export interface NotificationPolicy {
  /** Which planner reminders the company sends at all. */
  remindersOn: Record<ReminderKind, boolean>;
  /** Kinds whose bell and push nobody can turn off. */
  required: PolicyKind[];
  /** Overdue tasks: step 1 after N working days → whoever runs the project; step 2 after M more → admins / chosen people. */
  escalation: { step1Days: number; step2Days: number; admins: boolean; userIds: string[] };
  /** Approvals waiting: step 1 after N working days → the approver; step 2 after M more → as escalation step 2. */
  approvals: { step1Days: number; step2Days: number };
  /** Started tasks with no activity: the assignees after N working days, whoever runs the project after M. */
  inactivity: { assigneeDays: number; managerDays: number };
  quietHours: CompanyQuietHours;
  /** Each kind's channel defaults. */
  channels: Record<PolicyKind, Channels>;
}

export const MIN_STEP_DAYS = 1;
export const MAX_STEP_DAYS = 60;

const allOn = (): Record<ReminderKind, boolean> => Object.fromEntries(REMINDER_KINDS.map((k) => [k, true])) as Record<ReminderKind, boolean>;
const defaultChannels = (): Record<PolicyKind, Channels> =>
  Object.fromEntries(
    // Email is new for task notices (the daily email covers them): on only for escalation step 2 —
    // rare, to admins — and @mentions, whose email people get today.
    POLICY_KINDS.map((k) => [k, { bell: true, push: true, email: k === 'escalationAdmin' || k === 'mentions' }]),
  ) as Record<PolicyKind, Channels>;

/**
 * The rules until an admin changes them: today's behaviour carried over (escalation after 3 days),
 * the new reminders on, quiet hours = outside working hours with meetings and @mentions coming
 * through. Required at first: only kinds nobody could turn off before (so nothing comes back on).
 */
export const DEFAULT_POLICY: NotificationPolicy = Object.freeze({
  remindersOn: allOn(),
  required: ['escalation', 'escalationAdmin', 'approvalWaiting'],
  escalation: { step1Days: 3, step2Days: 5, admins: true, userIds: [] },
  approvals: { step1Days: 2, step2Days: 5 },
  inactivity: { assigneeDays: 5, managerDays: 10 },
  quietHours: { mode: 'workingHours', start: '18:00', end: '07:00', meetings: true, mentions: true },
  channels: defaultChannels(),
}) as NotificationPolicy;

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;
/** 'H:MM' or 'HH:MM' → 'HH:MM'; anything else → null. */
export function cleanTime(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = HHMM.exec(v.trim());
  return m ? `${m[1]!.padStart(2, '0')}:${m[2]}` : null;
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const days = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(MAX_STEP_DAYS, Math.max(MIN_STEP_DAYS, Math.round(v))) : fallback;

/** Stored or sent JSON → a whole, valid policy (unknown keys dropped, numbers bounded, the defaults filling gaps). */
export function normalizePolicy(input: unknown): NotificationPolicy {
  const raw = obj(input);
  const d = DEFAULT_POLICY;
  const on = obj(raw.remindersOn);
  const esc = obj(raw.escalation);
  const apr = obj(raw.approvals);
  const idle = obj(raw.inactivity);
  const quiet = obj(raw.quietHours);
  const chans = obj(raw.channels);
  const assigneeDays = days(idle.assigneeDays, d.inactivity.assigneeDays);
  const userIds = Array.isArray(esc.userIds) ? [...new Set(esc.userIds.filter((u): u is string => typeof u === 'string' && u.length > 0 && u.length <= 64))].slice(0, 50) : [];
  return {
    remindersOn: Object.fromEntries(REMINDER_KINDS.map((k) => [k, bool(on[k], true)])) as Record<ReminderKind, boolean>,
    required: Array.isArray(raw.required) ? POLICY_KINDS.filter((k) => (raw.required as unknown[]).includes(k)) : [...d.required],
    escalation: { step1Days: days(esc.step1Days, d.escalation.step1Days), step2Days: days(esc.step2Days, d.escalation.step2Days), admins: bool(esc.admins, true), userIds },
    approvals: { step1Days: days(apr.step1Days, d.approvals.step1Days), step2Days: days(apr.step2Days, d.approvals.step2Days) },
    inactivity: { assigneeDays, managerDays: Math.max(assigneeDays, days(idle.managerDays, d.inactivity.managerDays)) },
    quietHours: {
      mode: quiet.mode === 'custom' ? 'custom' : 'workingHours',
      start: cleanTime(quiet.start) ?? d.quietHours.start,
      end: cleanTime(quiet.end) ?? d.quietHours.end,
      meetings: bool(quiet.meetings, true),
      mentions: bool(quiet.mentions, true),
    },
    channels: Object.fromEntries(
      POLICY_KINDS.map((k) => {
        const c = obj(chans[k]);
        const def = d.channels[k];
        return [k, { bell: bool(c.bell, def.bell), push: bool(c.push, def.push), email: NO_EMAIL_CHANNEL.includes(k) ? false : bool(c.email, def.email) }];
      }),
    ) as Record<PolicyKind, Channels>,
  };
}

// ── Reminder schedules ("reminder templates") ───────────────────────────────

/** When a task's assignees are reminded, in working days around its due day. */
export interface ScheduleSteps {
  /** Working days before the due day (latest first). */
  before: number[];
  /** On the due day's morning. */
  onDue: boolean;
  /** Working days after the due day (earliest first). */
  after: number[];
  /** Then every N working days while overdue (null: no more). */
  repeatEvery: number | null;
}

export const MAX_SCHEDULE_DAYS = 30;
export const MAX_REPEAT_DAYS = 10;

/** The two schedules every company starts with (owner, 11 Nov). */
export type BuiltInSchedule = 'STANDARD' | 'CRITICAL';
export const BUILT_IN_SCHEDULES: Readonly<Record<BuiltInSchedule, { name: string; steps: ScheduleSteps }>> = {
  STANDARD: { name: 'Standard', steps: { before: [2], onDue: true, after: [1], repeatEvery: 2 } },
  CRITICAL: { name: 'Critical', steps: { before: [5, 2, 1], onDue: true, after: [], repeatEvery: 1 } },
};

const stepList = (v: unknown, max: number): number[] =>
  Array.isArray(v) ? [...new Set(v.filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= max))] : [];

export function normalizeSchedule(input: unknown): ScheduleSteps {
  const raw = obj(input);
  const repeat = raw.repeatEvery;
  return {
    before: stepList(raw.before, MAX_SCHEDULE_DAYS).sort((a, b) => b - a),
    onDue: raw.onDue === true,
    after: stepList(raw.after, MAX_SCHEDULE_DAYS).sort((a, b) => a - b),
    repeatEvery: typeof repeat === 'number' && Number.isInteger(repeat) && repeat >= 1 && repeat <= MAX_REPEAT_DAYS ? repeat : null,
  };
}

/** The schedule's fixed steps as working-day offsets from the due day (before negative, the due day 0, after positive). */
export function scheduleOffsets(steps: ScheduleSteps): number[] {
  return [...steps.before.map((n) => -n), ...(steps.onDue ? [0] : []), ...steps.after].sort((a, b) => a - b);
}

/**
 * The overdue step reached once a task is `n` working days late: the latest of the explicit days after
 * the due day and the repeats every `repeatEvery` working days after the last of them (or after the
 * due day). Null before the first. Each step is sent once, so a missed sweep sends only the latest.
 */
export function overdueStepAt(steps: ScheduleSteps, n: number): number | null {
  if (n < 1) return null;
  const explicit = steps.after.filter((s) => s <= n);
  let best = explicit.length ? explicit[explicit.length - 1]! : null;
  if (steps.repeatEvery) {
    const last = steps.after.length ? steps.after[steps.after.length - 1]! : 0;
    if (n >= last + steps.repeatEvery) {
      const repeat = last + Math.floor((n - last) / steps.repeatEvery) * steps.repeatEvery;
      best = best === null ? repeat : Math.max(best, repeat);
    }
  }
  return best;
}

// ── A person's choices on top of the company's ──────────────────────────────

/** What a person chose per kind (each channel unset = the company's default). */
export type ChannelChoices = Partial<Record<PolicyKind, Partial<Channels>>>;

/** The parts of a person's preferences the channel rules read. */
export interface ChannelPrefs {
  muted: string[];
  channels?: ChannelChoices;
}

/** Any of the kind's types muted (older apps mute one type of a kind — "Mentions" was MENTION only). */
const anyMuted = (prefs: ChannelPrefs, kind: PolicyKind) => KIND_TYPES[kind].some((t) => prefs.muted.includes(t));

/**
 * Types whose email is never on by default, only when the person chose it: a chat @mention never had an
 * email (the task-comment @mention's email carries over).
 */
const EMAIL_ONLY_WHEN_CHOSEN = new Set(['CHAT_MENTION']);

/** A kind's channels for a person (the settings table): a kind shows off on the bell once any of its types is muted. */
export function channelsFor(prefs: ChannelPrefs, kind: PolicyKind, policy: NotificationPolicy): Channels & { required: boolean } {
  return channelsOf(prefs, kind, policy, anyMuted(prefs, kind), null);
}

/** One notice type's channels for a person (delivery): that type muted = its bell off. */
export function channelsForType(prefs: ChannelPrefs, type: string, policy: NotificationPolicy): (Channels & { required: boolean }) | null {
  const kind = policyKindOfType(type);
  return kind ? channelsOf(prefs, kind, policy, prefs.muted.includes(type), type) : null;
}

function channelsOf(prefs: ChannelPrefs, kind: PolicyKind, policy: NotificationPolicy, muted: boolean, type: string | null): Channels & { required: boolean } {
  const choice = prefs.channels?.[kind] ?? {};
  const def = policy.channels[kind];
  const required = policy.required.includes(kind);
  const bell = required || (!muted && (choice.bell ?? def.bell));
  const push = bell && (required || (choice.push ?? def.push));
  // A kind any of whose types was muted before stays off by email too, unless the person chose email since.
  const fallback = anyMuted(prefs, kind) || (type !== null && EMAIL_ONLY_WHEN_CHOSEN.has(type)) ? false : def.email;
  const email = NO_EMAIL_CHANNEL.includes(kind) ? false : (choice.email ?? fallback);
  return { bell, push, email, required };
}

/** The `muted` list older apps read: every type whose bell is off (a required kind never). */
export function legacyMutedView(prefs: ChannelPrefs, policy: NotificationPolicy): string[] {
  const out = new Set<string>();
  for (const kind of POLICY_KINDS) {
    if (policy.required.includes(kind)) continue;
    for (const t of KIND_TYPES[kind]) if (!channelsForType(prefs, t, policy)!.bell) out.add(t);
  }
  // Types in no kind keep their stored mute (an older app may have muted one).
  for (const t of prefs.muted) if (!policyKindOfType(t)) out.add(t);
  return [...out];
}

/**
 * An older app saved its `muted` list (what legacyMutedView showed, with its changes). Only the changes
 * count: a type taken off the list turns its kind's bell on (the person's choice; any other type still on
 * the list stays muted); a type put on it is muted (all of a kind's types = the kind off). What the app
 * was only shown — off by the company's default or the person's website choice — is never pinned as a
 * mute, and what it wasn't shown (a required kind's old mutes) stays as it was.
 */
export function mergeLegacyMuted<P extends ChannelPrefs>(prefs: P, muted: string[], policy: NotificationPolicy): P {
  const before = new Set(legacyMutedView(prefs, policy));
  const next = new Set(muted);
  const channels: ChannelChoices = { ...(prefs.channels ?? {}) };
  const stored = new Set<string>();
  for (const t of next) if (prefs.muted.includes(t) || !before.has(t)) stored.add(t);
  for (const t of prefs.muted) if (!before.has(t)) stored.add(t);
  for (const kind of POLICY_KINDS) {
    const types = KIND_TYPES[kind];
    const turnedOn = types.filter((t) => before.has(t) && !next.has(t));
    if (turnedOn.length) {
      channels[kind] = { ...channels[kind], bell: true };
      for (const t of turnedOn) stored.delete(t);
    } else if (types.some((t) => !before.has(t) && next.has(t)) && types.every((t) => next.has(t))) {
      channels[kind] = { ...channels[kind], bell: false };
    }
  }
  return { ...prefs, muted: [...stored], channels };
}
