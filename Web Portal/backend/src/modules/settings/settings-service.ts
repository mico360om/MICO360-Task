import { z } from 'zod';
import { HttpError, ValidationError } from '../../lib/http-errors';
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
    if (!parsed.success) throw new ValidationError(`Invalid value for ${key}.`, parsed.error.flatten());
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

  return { getAll, get, set, getCarryForward, workingHours };
}

export type SettingsService = ReturnType<typeof createSettingsService>;
