import { z } from 'zod';
import { HttpError, ValidationError } from '../../lib/http-errors';
import { validationDetails } from '../../lib/validation-errors';
import type { SettingRecord, SettingsRepository } from './settings-repository';

const CARRY_STATUSES = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'BLOCKED', 'REVIEW'] as const;

/** A time of day as HH:MM (00:00–23:59). */
const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM.');

/** The company's working hours for meetings: days (0 = Sunday … 6 = Saturday) and times, company time. */
export interface WorkingHours {
  days: number[];
  start: string;
  end: string;
}

/** Until an admin sets them: Sunday to Thursday, 08:00 to 17:00. */
export const DEFAULT_WORKING_HOURS: WorkingHours = { days: [0, 1, 2, 3, 4], start: '08:00', end: '17:00' };

/** Until an admin sets it: five open tasks due a day per person (the Workload page). */
export const DEFAULT_DAILY_LIMIT = 5;

/** Until an admin sets it: the company week starts on Sunday. */
export const DEFAULT_COMPANY_WEEK_START = 0 as const;

/** One automatic meeting reminder: how long before the start, and whether it also goes by email. */
export interface MeetingReminderTime {
  minutes: number;
  email: boolean;
}

/** System Settings → Meeting reminders: the master switch and the reminder times (longest first). */
export interface MeetingReminderSettings {
  enabled: boolean;
  times: MeetingReminderTime[];
}

/** Each reminder time: from 5 minutes to 7 days before the meeting; at most five of them. */
export const MEETING_REMINDER_MIN_MINUTES = 5;
export const MEETING_REMINDER_MAX_MINUTES = 7 * 24 * 60;
export const MEETING_REMINDER_MAX_TIMES = 5;

/** Until an admin changes them: 24 hours (also by email), 12 hours and 15 minutes before (owner, 31 Oct). */
export const DEFAULT_MEETING_REMINDERS: MeetingReminderSettings = {
  enabled: true,
  times: [
    { minutes: 24 * 60, email: true },
    { minutes: 12 * 60, email: false },
    { minutes: 15, email: false },
  ],
};

/** 1.23.6: how long an invitation link (and an unused temporary password) lasts, in days. */
export const INVITATION_DAY_CHOICES = [1, 3, 7, 14] as const;
export type InvitationDays = (typeof INVITATION_DAY_CHOICES)[number];
export const DEFAULT_INVITATION_DAYS: InvitationDays = 7;
export const invitationDaysSchema = z.union([z.literal(1), z.literal(3), z.literal(7), z.literal(14)]);

const meetingReminderTime = z
  .object({ minutes: z.number().int().min(MEETING_REMINDER_MIN_MINUTES).max(MEETING_REMINDER_MAX_MINUTES), email: z.boolean() })
  .strict();

/**
 * The system settings that can be read and written through the generic settings API, each with
 * its own schema. Anything else in system_settings (e.g. `ai.config`, which holds provider API
 * keys) is managed by its own module and is never exposed or writable here.
 */
export const SETTING_SCHEMAS = {
  'carryForward.enabled': z.boolean(),
  'carryForward.statuses': z
    .array(z.enum(CARRY_STATUSES))
    .max(CARRY_STATUSES.length)
    .transform((list) => [...new Set(list)]),
  // Free-time suggestions for meetings stay inside these hours.
  'meetings.workingHours': z
    .object({ days: z.array(z.number().int().min(0).max(6)).min(1).max(7), start: HHMM, end: HHMM })
    .refine((h) => h.end > h.start, { message: 'The day has to end after it starts.', path: ['end'] })
    .transform((h) => ({ days: [...new Set(h.days)].sort((a, c) => a - c), start: h.start, end: h.end })),
  // The Workload page: how many open tasks a person may have due on one working day.
  'workload.dailyLimit': z.number().int().min(1).max(50),
  // The company week: the Management page's weeks and the weekly summary's day (0 Sunday, 1 Monday, 6 Saturday).
  'company.weekStart': z.union([z.literal(0), z.literal(1), z.literal(6)]),
  // The weekly management summary email, for everyone who can see the Management page (each can turn theirs off).
  'weeklySummary.enabled': z.boolean(),
  // 1.22.4: browsers send their errors, blocked files and slow pages to the Error log (on by default).
  'errorLog.collectBrowserErrors': z.boolean(),
  // 1.23.6 System Settings → Accounts: "Invitation links last: 1 · 3 · 7 · 14 days" (unused temporary passwords too).
  'accounts.invitationDays': invitationDaysSchema,
  // Automatic meeting reminders: on/off and when (each also by email or not); one of each time, longest first.
  'meetings.reminders': z
    .object({ enabled: z.boolean(), times: z.array(meetingReminderTime).min(1).max(MEETING_REMINDER_MAX_TIMES) })
    .strict()
    .transform((r) => {
      const seen = new Set<number>();
      const times = r.times.filter((t) => (seen.has(t.minutes) ? false : (seen.add(t.minutes), true))).sort((a, b) => b.minutes - a.minutes);
      return { enabled: r.enabled, times };
    }),
} as const;

export type SettingKey = keyof typeof SETTING_SCHEMAS;

export function isSettingKey(key: string): key is SettingKey {
  return Object.prototype.hasOwnProperty.call(SETTING_SCHEMAS, key);
}

export class UnknownSettingError extends HttpError {
  constructor(key: string) {
    super(`Unknown or read-only setting: ${key}`, 'UNKNOWN_SETTING', 400);
  }
}

export interface SettingsServiceDeps {
  settings: SettingsRepository;
}

export function createSettingsService({ settings }: SettingsServiceDeps) {
  /** Only the allow-listed settings — never secrets such as `ai.*`. */
  async function getAll(): Promise<SettingRecord[]> {
    return (await settings.getAll()).filter((s) => isSettingKey(s.key));
  }

  async function get(key: string): Promise<unknown> {
    if (!isSettingKey(key)) return undefined;
    return (await settings.getAll()).find((s) => s.key === key)?.value;
  }

  /** Validate a value against the key's schema, then store it. */
  async function set(key: string, value: unknown): Promise<SettingRecord> {
    if (!isSettingKey(key)) throw new UnknownSettingError(key);
    const parsed = SETTING_SCHEMAS[key].safeParse(value);
    if (!parsed.success) throw new ValidationError(`Invalid value for ${key}.`, validationDetails(parsed.error));
    return settings.set(key, parsed.data);
  }

  /** Carry-forward config with defaults; invalid stored values (e.g. the string "false") fall back safely. */
  async function getCarryForward(defaultStatuses: string[]): Promise<{ enabled: boolean; statuses: string[] }> {
    const all = await settings.getAll();
    const raw = (key: SettingKey) => all.find((s) => s.key === key)?.value;
    const enabled = SETTING_SCHEMAS['carryForward.enabled'].safeParse(raw('carryForward.enabled'));
    const statuses = SETTING_SCHEMAS['carryForward.statuses'].safeParse(raw('carryForward.statuses'));
    const legacyOff = raw('carryForward.enabled') === 'false' || raw('carryForward.enabled') === 0;
    return {
      enabled: enabled.success ? enabled.data : !legacyOff,
      statuses: statuses.success ? statuses.data : defaultStatuses,
    };
  }

  /** The meeting working hours, else the default (also when the stored value is broken). */
  async function workingHours(): Promise<WorkingHours> {
    const parsed = SETTING_SCHEMAS['meetings.workingHours'].safeParse(await get('meetings.workingHours'));
    return parsed.success ? parsed.data : { ...DEFAULT_WORKING_HOURS, days: [...DEFAULT_WORKING_HOURS.days] };
  }

  /** The workload daily limit, else the default (also when the stored value is broken). */
  async function dailyLimit(): Promise<number> {
    const parsed = SETTING_SCHEMAS['workload.dailyLimit'].safeParse(await get('workload.dailyLimit'));
    return parsed.success ? parsed.data : DEFAULT_DAILY_LIMIT;
  }

  /** The day the company week starts on (0 Sunday, 1 Monday, 6 Saturday), else Sunday (also when the stored value is broken). */
  async function companyWeekStart(): Promise<0 | 1 | 6> {
    const parsed = SETTING_SCHEMAS['company.weekStart'].safeParse(await get('company.weekStart'));
    return parsed.success ? parsed.data : DEFAULT_COMPANY_WEEK_START;
  }

  /** The weekly management summary is sent (on unless an administrator turned it off; a broken value keeps it on). */
  async function weeklySummaryEnabled(): Promise<boolean> {
    const parsed = SETTING_SCHEMAS['weeklySummary.enabled'].safeParse(await get('weeklySummary.enabled'));
    return parsed.success ? parsed.data : true;
  }

  /** 1.22.4 "Collect browser errors" (System Settings → Error log): on unless an administrator turned it off; a broken value keeps it on. */
  async function collectBrowserErrors(): Promise<boolean> {
    const parsed = SETTING_SCHEMAS['errorLog.collectBrowserErrors'].safeParse(await get('errorLog.collectBrowserErrors'));
    return parsed.success ? parsed.data : true;
  }

  /** The meeting reminder times in force: the saved ones, else the defaults (also when the stored value is broken). */
  async function meetingReminders(): Promise<MeetingReminderSettings> {
    const parsed = SETTING_SCHEMAS['meetings.reminders'].safeParse(await get('meetings.reminders'));
    return parsed.success ? parsed.data : { enabled: DEFAULT_MEETING_REMINDERS.enabled, times: DEFAULT_MEETING_REMINDERS.times.map((t) => ({ ...t })) };
  }

  /** The company week start and the weekly summary switch in one read (the public /config shows both). */
  async function invitationDays(): Promise<InvitationDays> {
    const parsed = SETTING_SCHEMAS['accounts.invitationDays'].safeParse(await get('accounts.invitationDays'));
    return parsed.success ? parsed.data : DEFAULT_INVITATION_DAYS;
  }

  async function companySettings(): Promise<{ weekStart: 0 | 1 | 6; weeklySummaryEnabled: boolean }> {
    const all = await settings.getAll();
    const raw = (key: SettingKey) => all.find((s) => s.key === key)?.value;
    const week = SETTING_SCHEMAS['company.weekStart'].safeParse(raw('company.weekStart'));
    const on = SETTING_SCHEMAS['weeklySummary.enabled'].safeParse(raw('weeklySummary.enabled'));
    return { weekStart: week.success ? week.data : DEFAULT_COMPANY_WEEK_START, weeklySummaryEnabled: on.success ? on.data : true };
  }

  return { getAll, get, set, getCarryForward, workingHours, dailyLimit, companyWeekStart, weeklySummaryEnabled, companySettings, meetingReminders, collectBrowserErrors, invitationDays };
}

export type SettingsService = ReturnType<typeof createSettingsService>;
