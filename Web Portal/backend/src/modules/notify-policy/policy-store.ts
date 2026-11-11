import type { PrismaClient } from '@prisma/client';

/** A company's day off as stored. */
export interface HolidayRow {
  id: string;
  companyId: string;
  day: string;
  name: string;
  recurring: boolean;
  source: 'STARTER' | 'ADMIN';
  expected: boolean;
}

/** A reminder schedule as stored (`steps` raw JSON, cleaned by the service). */
export interface ScheduleRow {
  id: string;
  companyId: string;
  name: string;
  steps: unknown;
  builtIn: string | null;
  isDefault: boolean;
}

export interface PolicyRow {
  policy: unknown;
  holidaysSeededAt: Date | null;
}

/** Persistence of the Notification & Scheduling centre's company rules. */
export interface PolicyStore {
  getPolicy(companyId: string): Promise<PolicyRow | null>;
  savePolicy(companyId: string, policy: unknown, actorId: string | null): Promise<void>;
  /** Mark the company set up (starter holidays and schedules added); creates its row when missing. */
  markSeeded(companyId: string, at: Date): Promise<void>;
  holidays(companyId: string): Promise<HolidayRow[]>;
  /** Adds the holidays not already there (same day and name); returns how many were added. */
  addHolidays(companyId: string, rows: Omit<HolidayRow, 'id' | 'companyId'>[], actorId: string | null): Promise<number>;
  updateHoliday(companyId: string, id: string, patch: Partial<Pick<HolidayRow, 'day' | 'name' | 'recurring' | 'expected'>>): Promise<HolidayRow | null>;
  removeHoliday(companyId: string, id: string): Promise<boolean>;
  schedules(companyId: string): Promise<ScheduleRow[]>;
  addSchedules(companyId: string, rows: Omit<ScheduleRow, 'id' | 'companyId'>[]): Promise<void>;
  updateSchedule(companyId: string, id: string, patch: Partial<Pick<ScheduleRow, 'name' | 'steps'>>): Promise<ScheduleRow | null>;
  removeSchedule(companyId: string, id: string): Promise<boolean>;
  setDefaultSchedule(companyId: string, id: string): Promise<boolean>;
  /** Projects and tasks that pointed at a removed schedule go back to the default (null). */
  clearScheduleUse(scheduleId: string): Promise<void>;
  activeCompanyIds(): Promise<string[]>;
  companyExists(companyId: string): Promise<boolean>;
}

const holidaySelect = { id: true, companyId: true, day: true, name: true, recurring: true, source: true, expected: true } as const;
const scheduleSelect = { id: true, companyId: true, name: true, steps: true, builtIn: true, isDefault: true } as const;
const asHoliday = (r: { source: string } & Omit<HolidayRow, 'source'>): HolidayRow => ({ ...r, source: r.source === 'STARTER' ? 'STARTER' : 'ADMIN' });
const isUniqueClash = (err: unknown) => (err as { code?: string })?.code === 'P2002';

export function createPrismaPolicyStore(prisma: PrismaClient): PolicyStore {
  return {
    async getPolicy(companyId) {
      return prisma.notificationPolicy.findUnique({ where: { companyId }, select: { policy: true, holidaysSeededAt: true } });
    },
    async savePolicy(companyId, policy, actorId) {
      const value = policy as object;
      await prisma.notificationPolicy.upsert({
        where: { companyId },
        create: { companyId, policy: value, updatedById: actorId },
        update: { policy: value, updatedById: actorId },
      });
    },
    async markSeeded(companyId, at) {
      await prisma.notificationPolicy.upsert({ where: { companyId }, create: { companyId, policy: {}, holidaysSeededAt: at }, update: { holidaysSeededAt: at } });
    },
    async holidays(companyId) {
      const rows = await prisma.companyHoliday.findMany({ where: { companyId }, select: holidaySelect, orderBy: [{ day: 'asc' }, { name: 'asc' }] });
      return rows.map(asHoliday);
    },
    async addHolidays(companyId, rows, actorId) {
      if (rows.length === 0) return 0;
      const res = await prisma.companyHoliday.createMany({
        data: rows.map((r) => ({ companyId, day: r.day, name: r.name, recurring: r.recurring, source: r.source, expected: r.expected, createdById: actorId })),
        skipDuplicates: true,
      });
      return res.count;
    },
    async updateHoliday(companyId, id, patch) {
      try {
        const res = await prisma.companyHoliday.updateMany({ where: { id, companyId }, data: patch });
        if (res.count === 0) return null;
      } catch (err) {
        if (isUniqueClash(err)) throw Object.assign(new Error('clash'), { clash: true });
        throw err;
      }
      const row = await prisma.companyHoliday.findUnique({ where: { id }, select: holidaySelect });
      return row ? asHoliday(row) : null;
    },
    async removeHoliday(companyId, id) {
      return (await prisma.companyHoliday.deleteMany({ where: { id, companyId } })).count > 0;
    },
    async schedules(companyId) {
      return prisma.reminderSchedule.findMany({ where: { companyId }, select: scheduleSelect, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    },
    async addSchedules(companyId, rows) {
      if (rows.length === 0) return;
      await prisma.reminderSchedule.createMany({
        data: rows.map((r) => ({ companyId, name: r.name, steps: r.steps as object, builtIn: r.builtIn, isDefault: r.isDefault })),
        skipDuplicates: true,
      });
    },
    async updateSchedule(companyId, id, patch) {
      try {
        const res = await prisma.reminderSchedule.updateMany({ where: { id, companyId }, data: { ...(patch.name !== undefined ? { name: patch.name } : {}), ...(patch.steps !== undefined ? { steps: patch.steps as object } : {}) } });
        if (res.count === 0) return null;
      } catch (err) {
        if (isUniqueClash(err)) throw Object.assign(new Error('clash'), { clash: true });
        throw err;
      }
      return prisma.reminderSchedule.findUnique({ where: { id }, select: scheduleSelect });
    },
    async removeSchedule(companyId, id) {
      return (await prisma.reminderSchedule.deleteMany({ where: { id, companyId } })).count > 0;
    },
    async setDefaultSchedule(companyId, id) {
      return prisma.$transaction(async (tx) => {
        const found = await tx.reminderSchedule.count({ where: { id, companyId } });
        if (!found) return false;
        await tx.reminderSchedule.updateMany({ where: { companyId, isDefault: true, NOT: { id } }, data: { isDefault: false } });
        await tx.reminderSchedule.updateMany({ where: { id, companyId }, data: { isDefault: true } });
        return true;
      });
    },
    async clearScheduleUse(scheduleId) {
      await prisma.project.updateMany({ where: { reminderScheduleId: scheduleId }, data: { reminderScheduleId: null } });
      await prisma.task.updateMany({ where: { reminderScheduleId: scheduleId }, data: { reminderScheduleId: null } });
    },
    async activeCompanyIds() {
      return (await prisma.company.findMany({ where: { status: 'ACTIVE' }, select: { id: true }, orderBy: { id: 'asc' } })).map((c) => c.id);
    },
    async companyExists(companyId) {
      return (await prisma.company.count({ where: { id: companyId } })) > 0;
    },
  };
}

/** An in-memory store (tests). */
export function createMemoryPolicyStore(companies: string[] = ['c1']): PolicyStore & { companies: string[] } {
  const policies = new Map<string, PolicyRow>();
  let holidays: HolidayRow[] = [];
  let schedules: ScheduleRow[] = [];
  let seq = 0;
  const id = (p: string) => `${p}${++seq}`;
  return {
    companies,
    async getPolicy(c) {
      return policies.get(c) ?? null;
    },
    async savePolicy(c, policy) {
      policies.set(c, { policy, holidaysSeededAt: policies.get(c)?.holidaysSeededAt ?? null });
    },
    async markSeeded(c, at) {
      policies.set(c, { policy: policies.get(c)?.policy ?? {}, holidaysSeededAt: at });
    },
    async holidays(c) {
      return holidays.filter((h) => h.companyId === c).sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.name.localeCompare(b.name)));
    },
    async addHolidays(c, rows) {
      let n = 0;
      for (const r of rows) {
        if (holidays.some((h) => h.companyId === c && h.day === r.day && h.name === r.name)) continue;
        holidays.push({ ...r, id: id('h'), companyId: c });
        n++;
      }
      return n;
    },
    async updateHoliday(c, hid, patch) {
      const h = holidays.find((x) => x.id === hid && x.companyId === c);
      if (!h) return null;
      const next = { ...h, ...patch };
      if (holidays.some((x) => x !== h && x.companyId === c && x.day === next.day && x.name === next.name)) throw Object.assign(new Error('clash'), { clash: true });
      Object.assign(h, patch);
      return { ...h };
    },
    async removeHoliday(c, hid) {
      const before = holidays.length;
      holidays = holidays.filter((h) => !(h.id === hid && h.companyId === c));
      return holidays.length < before;
    },
    async schedules(c) {
      return schedules.filter((s) => s.companyId === c).map((s) => ({ ...s }));
    },
    async addSchedules(c, rows) {
      for (const r of rows) if (!schedules.some((s) => s.companyId === c && s.name === r.name)) schedules.push({ ...r, id: id('s'), companyId: c });
    },
    async updateSchedule(c, sid, patch) {
      const s = schedules.find((x) => x.id === sid && x.companyId === c);
      if (!s) return null;
      if (patch.name !== undefined && schedules.some((x) => x !== s && x.companyId === c && x.name === patch.name)) throw Object.assign(new Error('clash'), { clash: true });
      Object.assign(s, patch);
      return { ...s };
    },
    async removeSchedule(c, sid) {
      const before = schedules.length;
      schedules = schedules.filter((s) => !(s.id === sid && s.companyId === c));
      return schedules.length < before;
    },
    async setDefaultSchedule(c, sid) {
      if (!schedules.some((s) => s.id === sid && s.companyId === c)) return false;
      for (const s of schedules) if (s.companyId === c) s.isDefault = s.id === sid;
      return true;
    },
    async clearScheduleUse() {},
    async activeCompanyIds() {
      return [...companies];
    },
    async companyExists(c) {
      return companies.includes(c);
    },
  };
}
