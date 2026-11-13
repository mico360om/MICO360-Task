import { describe, expect, it, vi } from 'vitest';
import { createMemoryPolicyStore } from './policy-store';
import { createNotifyPolicyService } from './policy-service';
import { DEFAULT_POLICY } from './policy';

const hours = { weekStart: 0 as const, hours: { days: [0, 1, 2, 3, 4], start: '08:00', end: '17:00' } };
const make = (now = '2026-11-11T08:00:00Z') => {
  const store = createMemoryPolicyStore(['c1', 'c2']);
  const audit = vi.fn(async () => {});
  const service = createNotifyPolicyService({ store, companyHours: async () => hours, timeZone: 'Asia/Muscat', now: () => new Date(now), audit, cacheMs: 0 });
  return { store, service, audit };
};

describe('setting a company up', () => {
  it('adds the starter public holidays of this year and next, and Standard (default) + Critical, once', async () => {
    const { service, store } = make();
    await service.ensureAll();
    await service.ensureAll();
    const hs = await store.holidays('c1');
    expect(hs.length).toBeGreaterThan(10);
    expect(hs.every((h) => h.day.startsWith('2026') || h.day.startsWith('2027'))).toBe(true);
    expect(hs.find((h) => h.name === 'National Day')).toMatchObject({ source: 'STARTER', expected: false });
    expect(hs.find((h) => h.name === 'Eid al-Adha')).toMatchObject({ expected: true });
    // Owner, 13 Nov: Accession Day (11 January), a fixed date, each year.
    expect(hs.filter((h) => h.name === 'Accession Day').map((h) => [h.day, h.source, h.expected])).toEqual([
      ['2026-01-11', 'STARTER', false],
      ['2027-01-11', 'STARTER', false],
    ]);
    const ss = await service.schedules('c1');
    expect(ss.map((s) => [s.name, s.builtIn, s.isDefault])).toEqual([
      ['Standard', 'STANDARD', true],
      ['Critical', 'CRITICAL', false],
    ]);
    // Removing a starter holiday is kept: set-up never adds it back.
    await service.removeHoliday('c1', hs[0]!.id, 'admin');
    const fresh = createNotifyPolicyService({ store, companyHours: async () => hours, timeZone: 'Asia/Muscat' });
    await fresh.ensureAll();
    expect((await store.holidays('c1')).length).toBe(hs.length - 1);
  });

  it('a company’s rules: its working days and holidays, its schedules and default, the defaults policy until saved', async () => {
    const { service } = make();
    const r = await service.rules('c1');
    expect(r.policy).toEqual(DEFAULT_POLICY);
    expect(r.calendar.workingDays).toEqual([0, 1, 2, 3, 4]);
    expect(r.calendar.holidays.some((h) => h.day === '2026-11-20')).toBe(true);
    expect(r.schedules.get(r.defaultScheduleId!)).toEqual({ before: [2], onDue: true, after: [1], repeatEvery: 2 });
    expect(r.hours).toEqual({ start: '08:00', end: '17:00' });
    // The site's rules (no company): no holidays, the Standard schedule.
    const site = await service.rules(null);
    expect(site.calendar.holidays).toEqual([]);
    expect(site.schedules.get(site.defaultScheduleId!)).toEqual({ before: [2], onDue: true, after: [1], repeatEvery: 2 });
  });
});

describe('the policy', () => {
  it('each tab saves its own sections; the rest stays; numbers are cleaned; it is audited', async () => {
    const { service, audit } = make();
    await service.savePolicy('c1', { escalation: { step1Days: 4, step2Days: 2, admins: false, userIds: ['u9'] } }, 'admin');
    const p = await service.savePolicy('c1', { required: ['overdue'] }, 'admin');
    expect(p.escalation).toEqual({ step1Days: 4, step2Days: 2, admins: false, userIds: ['u9'] });
    expect(p.required).toEqual(['overdue']);
    expect((await service.rules('c1')).policy.required).toEqual(['overdue']);
    // Another company keeps its own.
    expect((await service.rules('c2')).policy).toEqual(DEFAULT_POLICY);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'notify.policy.update', entityId: 'c1', userId: 'admin' }));
  });

  it('an unknown company is not found', async () => {
    const { service } = make();
    await expect(service.savePolicy('nope', {}, 'admin')).rejects.toMatchObject({ status: 404 });
    await expect(service.holidays('nope')).rejects.toMatchObject({ status: 404 });
  });
});

describe('holidays', () => {
  it('adds a company day off (one-off or every year); the same day and name twice is refused', async () => {
    const { service } = make();
    const h = await service.addHoliday('c1', { day: '2026-12-31', name: '  Year   end ', recurring: true }, 'admin');
    expect(h).toMatchObject({ day: '2026-12-31', name: 'Year end', recurring: true, source: 'ADMIN', expected: false });
    await expect(service.addHoliday('c1', { day: '2026-12-31', name: 'Year end' }, 'admin')).rejects.toMatchObject({ status: 409, code: 'HOLIDAY_EXISTS' });
    await expect(service.addHoliday('c1', { day: '2026-02-30', name: 'Nope' }, 'admin')).rejects.toMatchObject({ status: 400 });
    await expect(service.addHoliday('c1', { day: '2026-02-03', name: '' }, 'admin')).rejects.toMatchObject({ status: 400 });
    expect((await service.rules('c1')).calendar.holidays).toContainEqual({ day: '2026-12-31', name: 'Year end', recurring: true });
  });

  it('moving an expected date makes it announced; confirming keeps the day', async () => {
    const { service } = make();
    await service.ensureCompany('c1');
    const eid = (await service.holidays('c1')).find((h) => h.name === 'Eid al-Adha' && h.day.startsWith('2027'))!;
    const moved = await service.updateHoliday('c1', eid.id, { day: '2027-05-19' }, 'admin');
    expect(moved).toMatchObject({ day: '2027-05-19', expected: false });
    const other = (await service.holidays('c1')).find((h) => h.name === 'Arafat Day' && h.day.startsWith('2027'))!;
    expect(await service.updateHoliday('c1', other.id, { expected: false }, 'admin')).toMatchObject({ day: other.day, expected: false });
    await expect(service.updateHoliday('c2', other.id, { expected: false }, 'admin')).rejects.toMatchObject({ status: 404 });
  });

  it('shows a banner for an expected holiday within 60 days, once per holiday and year', async () => {
    const { service } = make('2027-04-01T08:00:00Z');
    await service.ensureCompany('c1');
    await service.addStarterYear('c1', 2027, 'admin');
    expect(await service.banners('c1')).toEqual([
      { name: 'Arafat Day', year: 2027, day: '2027-05-15', text: 'Confirm the Arafat Day 2027 date' },
      { name: 'Eid al-Adha', year: 2027, day: '2027-05-16', text: 'Confirm the Eid al-Adha 2027 date' },
    ]);
    await expect(service.addStarterYear('c1', 2031, 'admin')).rejects.toMatchObject({ status: 400 });
  });
});

describe('reminder schedules', () => {
  it('admins add, rename, change and remove schedules; Standard and the default stay', async () => {
    const { service } = make();
    const urgent = await service.createSchedule('c1', { name: 'Site works', steps: { before: [3], onDue: true, after: [1, 2], repeatEvery: 3 } }, 'admin');
    expect(urgent.steps).toEqual({ before: [3], onDue: true, after: [1, 2], repeatEvery: 3 });
    await expect(service.createSchedule('c1', { name: 'site works', steps: { onDue: true } }, 'admin')).rejects.toMatchObject({ code: 'SCHEDULE_EXISTS' });
    await expect(service.createSchedule('c1', { name: 'Empty', steps: {} }, 'admin')).rejects.toMatchObject({ status: 400 });
    expect(await service.updateSchedule('c1', urgent.id, { name: 'Site work', steps: { onDue: true } }, 'admin')).toMatchObject({ name: 'Site work', steps: { before: [], onDue: true, after: [], repeatEvery: null } });

    const all = await service.schedules('c1');
    const standard = all.find((s) => s.builtIn === 'STANDARD')!;
    await expect(service.removeSchedule('c1', standard.id, 'admin')).rejects.toMatchObject({ code: 'SCHEDULE_IS_DEFAULT' });
    await service.setDefaultSchedule('c1', urgent.id, 'admin');
    await expect(service.removeSchedule('c1', standard.id, 'admin')).rejects.toMatchObject({ code: 'SCHEDULE_BUILT_IN' });
    await expect(service.removeSchedule('c1', urgent.id, 'admin')).rejects.toMatchObject({ code: 'SCHEDULE_IS_DEFAULT' });
    const critical = all.find((s) => s.builtIn === 'CRITICAL')!;
    await service.removeSchedule('c1', critical.id, 'admin');
    expect((await service.schedules('c1')).map((s) => s.name)).toEqual(['Standard', 'Site work']);
    expect((await service.rules('c1')).defaultScheduleId).toBe(urgent.id);
  });
});

describe('set-up at start-up (seen on a live server: several sweeps ask at once)', () => {
  it('several first reads at once set a company up once', async () => {
    const store = createMemoryPolicyStore(['c1']);
    const addSchedules = vi.spyOn(store, 'addSchedules');
    const addHolidays = vi.spyOn(store, 'addHolidays');
    const service = createNotifyPolicyService({ store, companyHours: async () => hours, timeZone: 'Asia/Muscat', cacheMs: 0 });
    await Promise.all([service.rules('c1'), service.rules('c1'), service.ensureAll(), service.schedules('c1')]);
    expect(addSchedules).toHaveBeenCalledTimes(1);
    expect(addHolidays).toHaveBeenCalledTimes(1);
  });

  it('a write conflict or deadlock (another server setting it up too) is tried again', async () => {
    const store = createMemoryPolicyStore(['c1']);
    const real = store.addSchedules.bind(store);
    let calls = 0;
    store.addSchedules = async (c, rows) => {
      calls++;
      if (calls === 1) throw Object.assign(new Error('Transaction failed due to a write conflict or a deadlock. Please retry your transaction'), { code: 'P2034' });
      return real(c, rows);
    };
    const service = createNotifyPolicyService({ store, companyHours: async () => hours, timeZone: 'Asia/Muscat', cacheMs: 0 });
    expect((await service.rules('c1')).defaultScheduleId).toBeTruthy();
    expect(calls).toBe(2);
  });
});
