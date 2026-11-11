import { ConflictError, NotFoundError, ValidationError } from '../../lib/http-errors';
import { holidaysInRange, shiftDay, zonedDay, type Holiday, type WorkCalendar, type WorkHours } from '../../lib/working-days';
import { starterHolidaysFor } from './oman-holidays';
import type { PlannerCompanyRules } from './planner';
import { BUILT_IN_SCHEDULES, DEFAULT_POLICY, normalizePolicy, normalizeSchedule, type NotificationPolicy, type ScheduleSteps } from './policy';
import type { HolidayRow, PolicyStore, ScheduleRow } from './policy-store';

/**
 * The Notification & Scheduling centre's company rules: the policy (System Settings → Notification &
 * Scheduling), the holidays and the reminder schedules of each company, and the rules the planner and
 * delivery read (cached briefly; a save here clears the cache at once).
 *
 * Each company is set up once — the starter public holidays of this year and next, and the Standard and
 * Critical schedules — at start-up or the first time its rules are read (a company made later).
 */

export interface CompanyHoursSource {
  /** A company's (null: the site's) week start and working hours as in force. */
  (companyId: string | null): Promise<{ weekStart: 0 | 1 | 6; hours: { days: number[]; start: string; end: string } }>;
}

export interface NotifyPolicyAudit {
  (entry: { userId: string | null; action: string; entityId: string; oldValue?: unknown; newValue?: unknown }): Promise<void>;
}

export interface NotifyPolicyServiceDeps {
  store: PolicyStore;
  companyHours: CompanyHoursSource;
  timeZone: string;
  now?: () => Date;
  audit?: NotifyPolicyAudit;
  /** How long rules are kept in memory (default 60 s). */
  cacheMs?: number;
}

/** A company's rules as the planner, delivery and the website read them. */
export interface CompanyRules extends PlannerCompanyRules {
  companyId: string | null;
  hours: WorkHours;
  weekStart: 0 | 1 | 6;
}

export interface ApiSchedule {
  id: string;
  name: string;
  steps: ScheduleSteps;
  builtIn: string | null;
  isDefault: boolean;
}

export interface ApiHoliday {
  id: string;
  day: string;
  name: string;
  recurring: boolean;
  source: 'STARTER' | 'ADMIN';
  expected: boolean;
}

/** "Confirm the Eid al-Adha 2027 date": an expected holiday coming within this many days. */
export const CONFIRM_BANNER_DAYS = 60;
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MAX_NAME = 120;
const MAX_SCHEDULE_NAME = 80;
const MAX_SCHEDULES = 20;

const validDay = (d: unknown): d is string => typeof d === 'string' && DAY.test(d) && new Date(`${d}T12:00:00Z`).toISOString().slice(0, 10) === d;
const cleanName = (v: unknown, max: number, what: string): string => {
  const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  if (!s) throw new ValidationError(`Give the ${what} a name.`);
  if (s.length > max) throw new ValidationError(`Keep the ${what}'s name under ${max + 1} characters.`);
  return s;
};
const toApiHoliday = (h: HolidayRow): ApiHoliday => ({ id: h.id, day: h.day, name: h.name, recurring: h.recurring, source: h.source, expected: h.expected });
const toApiSchedule = (s: ScheduleRow): ApiSchedule => ({ id: s.id, name: s.name, steps: normalizeSchedule(s.steps), builtIn: s.builtIn, isDefault: s.isDefault });
const isClash = (err: unknown) => !!(err as { clash?: boolean })?.clash;

/** The policy's sections an admin saves one tab at a time. */
export const POLICY_SECTIONS = ['remindersOn', 'required', 'escalation', 'approvals', 'inactivity', 'quietHours', 'channels'] as const;

export function createNotifyPolicyService(deps: NotifyPolicyServiceDeps) {
  const { store } = deps;
  const now = deps.now ?? (() => new Date());
  const ttl = deps.cacheMs ?? 60_000;
  const cache = new Map<string, { at: number; value: Promise<CompanyRules> }>();
  const seeded = new Set<string>();
  const clear = () => cache.clear();

  /** Set a company up once: starter holidays (this year and next) and the two schedules. Safe to run twice. */
  async function ensureCompany(companyId: string): Promise<void> {
    if (seeded.has(companyId)) return;
    const row = await store.getPolicy(companyId);
    const schedules = await store.schedules(companyId);
    if (schedules.length === 0) {
      await store.addSchedules(companyId, [
        { name: BUILT_IN_SCHEDULES.STANDARD.name, steps: BUILT_IN_SCHEDULES.STANDARD.steps, builtIn: 'STANDARD', isDefault: true },
        { name: BUILT_IN_SCHEDULES.CRITICAL.name, steps: BUILT_IN_SCHEDULES.CRITICAL.steps, builtIn: 'CRITICAL', isDefault: false },
      ]);
    }
    if (!row?.holidaysSeededAt) {
      const year = Number(zonedDay(now(), deps.timeZone).slice(0, 4));
      await store.addHolidays(
        companyId,
        starterHolidaysFor([year, year + 1]).map((h) => ({ day: h.day, name: h.name, recurring: false, source: 'STARTER' as const, expected: h.expected })),
        null,
      );
      await store.markSeeded(companyId, now());
    }
    seeded.add(companyId);
  }

  async function ensureAll(): Promise<void> {
    for (const id of await store.activeCompanyIds()) await ensureCompany(id);
  }

  async function policyOf(companyId: string | null): Promise<NotificationPolicy> {
    if (!companyId) return normalizePolicy(null);
    const row = await store.getPolicy(companyId);
    return normalizePolicy(row?.policy ?? null);
  }

  async function load(companyId: string | null): Promise<CompanyRules> {
    if (companyId) await ensureCompany(companyId);
    const [policy, hoursOf, holidays, schedules] = await Promise.all([
      policyOf(companyId),
      deps.companyHours(companyId),
      companyId ? store.holidays(companyId) : Promise.resolve([] as HolidayRow[]),
      companyId ? store.schedules(companyId) : Promise.resolve([] as ScheduleRow[]),
    ]);
    const steps = new Map<string, ScheduleSteps>(schedules.map((s) => [s.id, normalizeSchedule(s.steps)]));
    // The site's rules (a project without a company): the Standard schedule under a fixed id.
    if (!companyId) steps.set('site:standard', BUILT_IN_SCHEDULES.STANDARD.steps);
    const def = schedules.find((s) => s.isDefault) ?? schedules.find((s) => s.builtIn === 'STANDARD') ?? schedules[0];
    const calendar: WorkCalendar = { workingDays: [...hoursOf.hours.days], holidays: holidays.map((h): Holiday => ({ day: h.day, name: h.name, recurring: h.recurring })) };
    return {
      companyId,
      policy,
      calendar,
      schedules: steps,
      defaultScheduleId: companyId ? (def?.id ?? null) : 'site:standard',
      hours: { start: hoursOf.hours.start, end: hoursOf.hours.end },
      weekStart: hoursOf.weekStart,
    };
  }

  /** A company's rules (null: the site's), from memory for up to a minute. */
  function rules(companyId: string | null): Promise<CompanyRules> {
    const key = companyId ?? '';
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.value;
    const value = load(companyId);
    cache.set(key, { at: Date.now(), value });
    value.catch(() => cache.delete(key));
    return value;
  }

  async function mustExist(companyId: string): Promise<void> {
    if (!(await store.companyExists(companyId))) throw new NotFoundError('Company not found.');
    await ensureCompany(companyId);
  }

  const audit = (userId: string | null, action: string, entityId: string, oldValue?: unknown, newValue?: unknown) =>
    deps.audit?.({ userId, action, entityId, oldValue, newValue }).catch(() => {}) ?? Promise.resolve();

  /** Save some sections of a company's policy (each tab saves its own); the rest stays as it is. */
  async function savePolicy(companyId: string, patch: Partial<Record<(typeof POLICY_SECTIONS)[number], unknown>>, actorId: string | null): Promise<NotificationPolicy> {
    await mustExist(companyId);
    const before = await policyOf(companyId);
    const merged: Record<string, unknown> = { ...before };
    for (const section of POLICY_SECTIONS) if (patch[section] !== undefined) merged[section] = patch[section];
    const next = normalizePolicy(merged);
    await store.savePolicy(companyId, next, actorId);
    clear();
    await audit(actorId, 'notify.policy.update', companyId, before, next);
    return next;
  }

  async function holidays(companyId: string): Promise<ApiHoliday[]> {
    await mustExist(companyId);
    return (await store.holidays(companyId)).map(toApiHoliday);
  }

  async function addHoliday(companyId: string, input: { day?: unknown; name?: unknown; recurring?: unknown }, actorId: string | null): Promise<ApiHoliday> {
    await mustExist(companyId);
    if (!validDay(input.day)) throw new ValidationError('Choose a day.');
    const name = cleanName(input.name, MAX_NAME, 'day off');
    const added = await store.addHolidays(companyId, [{ day: input.day, name, recurring: input.recurring === true, source: 'ADMIN', expected: false }], actorId);
    if (!added) throw new ConflictError(`${name} is already on ${input.day}.`, 'HOLIDAY_EXISTS');
    clear();
    const row = (await store.holidays(companyId)).find((h) => h.day === input.day && h.name === name)!;
    await audit(actorId, 'notify.holiday.add', companyId, undefined, toApiHoliday(row));
    return toApiHoliday(row);
  }

  async function updateHoliday(companyId: string, id: string, input: { day?: unknown; name?: unknown; recurring?: unknown; expected?: unknown }, actorId: string | null): Promise<ApiHoliday> {
    await mustExist(companyId);
    const patch: Partial<Pick<HolidayRow, 'day' | 'name' | 'recurring' | 'expected'>> = {};
    if (input.day !== undefined) {
      if (!validDay(input.day)) throw new ValidationError('Choose a day.');
      patch.day = input.day;
    }
    if (input.name !== undefined) patch.name = cleanName(input.name, MAX_NAME, 'day off');
    if (input.recurring !== undefined) patch.recurring = input.recurring === true;
    // Moving an expected date (or confirming it) makes it the announced one.
    if (input.expected !== undefined) patch.expected = input.expected === true;
    else if (patch.day !== undefined) patch.expected = false;
    const before = (await store.holidays(companyId)).find((h) => h.id === id);
    let row: HolidayRow | null;
    try {
      row = await store.updateHoliday(companyId, id, patch);
    } catch (err) {
      if (isClash(err)) throw new ConflictError('That day already has a day off with this name.', 'HOLIDAY_EXISTS');
      throw err;
    }
    if (!row) throw new NotFoundError('Day off not found.');
    clear();
    await audit(actorId, 'notify.holiday.update', companyId, before ? toApiHoliday(before) : undefined, toApiHoliday(row));
    return toApiHoliday(row);
  }

  async function removeHoliday(companyId: string, id: string, actorId: string | null): Promise<void> {
    await mustExist(companyId);
    const before = (await store.holidays(companyId)).find((h) => h.id === id);
    if (!before || !(await store.removeHoliday(companyId, id))) throw new NotFoundError('Day off not found.');
    clear();
    await audit(actorId, 'notify.holiday.remove', companyId, toApiHoliday(before));
  }

  /** Add the starter public holidays of a year again (those not there already); returns how many were added. */
  async function addStarterYear(companyId: string, year: number, actorId: string | null): Promise<number> {
    await mustExist(companyId);
    const list = starterHolidaysFor([year]);
    if (list.length === 0) throw new ValidationError(`There is no starter list for ${year} yet — add its days by hand.`);
    const added = await store.addHolidays(companyId, list.map((h) => ({ day: h.day, name: h.name, recurring: false, source: 'STARTER' as const, expected: h.expected })), actorId);
    clear();
    if (added) await audit(actorId, 'notify.holiday.starter', companyId, undefined, { year, added });
    return added;
  }

  async function schedules(companyId: string): Promise<ApiSchedule[]> {
    await mustExist(companyId);
    // Standard, Critical, then the company's own in the order they were made.
    const rank = (s: ScheduleRow) => (s.builtIn === 'STANDARD' ? 0 : s.builtIn === 'CRITICAL' ? 1 : 2);
    return (await store.schedules(companyId))
      .map((s, i) => ({ s, i }))
      .sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i)
      .map(({ s }) => toApiSchedule(s));
  }

  function checkSteps(steps: ScheduleSteps): void {
    if (!steps.before.length && !steps.onDue && !steps.after.length && !steps.repeatEvery) throw new ValidationError('Choose at least one reminder.');
  }

  async function createSchedule(companyId: string, input: { name?: unknown; steps?: unknown }, actorId: string | null): Promise<ApiSchedule> {
    await mustExist(companyId);
    const name = cleanName(input.name, MAX_SCHEDULE_NAME, 'schedule');
    const steps = normalizeSchedule(input.steps);
    checkSteps(steps);
    const existing = await store.schedules(companyId);
    if (existing.length >= MAX_SCHEDULES) throw new ValidationError(`A company can have up to ${MAX_SCHEDULES} schedules.`);
    if (existing.some((s) => s.name.toLowerCase() === name.toLowerCase())) throw new ConflictError(`There is already a schedule called ${name}.`, 'SCHEDULE_EXISTS');
    await store.addSchedules(companyId, [{ name, steps, builtIn: null, isDefault: false }]);
    clear();
    const row = (await store.schedules(companyId)).find((s) => s.name === name)!;
    await audit(actorId, 'notify.schedule.add', companyId, undefined, toApiSchedule(row));
    return toApiSchedule(row);
  }

  async function updateSchedule(companyId: string, id: string, input: { name?: unknown; steps?: unknown }, actorId: string | null): Promise<ApiSchedule> {
    await mustExist(companyId);
    const all = await store.schedules(companyId);
    const before = all.find((s) => s.id === id);
    if (!before) throw new NotFoundError('Schedule not found.');
    const patch: { name?: string; steps?: ScheduleSteps } = {};
    if (input.name !== undefined) {
      patch.name = cleanName(input.name, MAX_SCHEDULE_NAME, 'schedule');
      if (all.some((s) => s.id !== id && s.name.toLowerCase() === patch.name!.toLowerCase())) throw new ConflictError(`There is already a schedule called ${patch.name}.`, 'SCHEDULE_EXISTS');
    }
    if (input.steps !== undefined) {
      patch.steps = normalizeSchedule(input.steps);
      checkSteps(patch.steps);
    }
    let row: ScheduleRow | null;
    try {
      row = await store.updateSchedule(companyId, id, patch);
    } catch (err) {
      if (isClash(err)) throw new ConflictError(`There is already a schedule called ${patch.name}.`, 'SCHEDULE_EXISTS');
      throw err;
    }
    if (!row) throw new NotFoundError('Schedule not found.');
    clear();
    await audit(actorId, 'notify.schedule.update', companyId, toApiSchedule(before), toApiSchedule(row));
    return toApiSchedule(row);
  }

  async function removeSchedule(companyId: string, id: string, actorId: string | null): Promise<void> {
    await mustExist(companyId);
    const row = (await store.schedules(companyId)).find((s) => s.id === id);
    if (!row) throw new NotFoundError('Schedule not found.');
    if (row.isDefault) throw new ConflictError('Choose another default schedule before removing this one.', 'SCHEDULE_IS_DEFAULT');
    if (row.builtIn === 'STANDARD') throw new ConflictError('The Standard schedule stays (you can change its steps).', 'SCHEDULE_BUILT_IN');
    await store.removeSchedule(companyId, id);
    // Projects and tasks that used it follow the company's default again.
    await store.clearScheduleUse(id);
    clear();
    await audit(actorId, 'notify.schedule.remove', companyId, toApiSchedule(row));
  }

  async function setDefaultSchedule(companyId: string, id: string, actorId: string | null): Promise<ApiSchedule[]> {
    await mustExist(companyId);
    if (!(await store.setDefaultSchedule(companyId, id))) throw new NotFoundError('Schedule not found.');
    clear();
    await audit(actorId, 'notify.schedule.default', companyId, undefined, { scheduleId: id });
    return schedules(companyId);
  }

  /** "Confirm the Eid al-Adha 2027 date": expected holidays starting within the next 60 days, one per name and year. */
  async function banners(companyId: string): Promise<{ name: string; year: number; day: string; text: string }[]> {
    const today = zonedDay(now(), deps.timeZone);
    const until = shiftDay(today, CONFIRM_BANNER_DAYS);
    const seen = new Set<string>();
    const out: { name: string; year: number; day: string; text: string }[] = [];
    for (const h of await store.holidays(companyId)) {
      if (!h.expected || h.day < today || h.day > until) continue;
      const year = Number(h.day.slice(0, 4));
      const key = `${h.name}|${year}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name: h.name, year, day: h.day, text: `Confirm the ${h.name} ${year} date` });
    }
    return out;
  }

  /** The days off from `from` to `to` (yearly ones expanded), for the Timeline, Calendar and the task form. */
  async function daysOff(companyId: string | null, from: string, to: string): Promise<{ day: string; name: string }[]> {
    const r = await rules(companyId);
    return holidaysInRange(from, to, r.calendar);
  }

  return {
    ensureCompany,
    ensureAll,
    rules,
    policyOf,
    savePolicy,
    holidays,
    addHoliday,
    updateHoliday,
    removeHoliday,
    addStarterYear,
    schedules,
    createSchedule,
    updateSchedule,
    removeSchedule,
    setDefaultSchedule,
    banners,
    daysOff,
    clearCache: clear,
    defaults: (): NotificationPolicy => normalizePolicy(DEFAULT_POLICY),
  };
}

export type NotifyPolicyService = ReturnType<typeof createNotifyPolicyService>;
