import { describe, expect, it } from 'vitest';
import { createKpiValuesReminder, type DueProject } from './kpi-reminder';

const TZ = 'Asia/Muscat';
const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00+04:00`);
const CAL = { workingDays: [0, 1, 2, 3, 4], holidays: [{ day: '2026-11-01', name: 'A company day off' }] };

function setup(nowAt: Date, due: DueProject[]) {
  let now = nowAt;
  const sent: { userId: string; type: string; title: string; body: string | null; entityType: string | null; entityId: string | null }[] = [];
  const keys = new Set<string>();
  const reminder = createKpiValuesReminder({
    projectsDue: async () => due,
    rules: async () => ({ calendar: CAL, hours: { start: '08:00', end: '17:00' } }),
    keys: { existing: async (ks) => new Set(ks.filter((k) => keys.has(k))), addMany: async (ks) => void ks.forEach((k) => keys.add(k)) },
    notify: async (n) => void sent.push(n),
    timeZone: TZ,
    now: () => now,
  });
  return { reminder, sent, keys, setNow: (d: Date) => void (now = d) };
}

const P: DueProject = { projectId: 'p1', name: 'Rig 3', companyId: 'c1', missing: ['Safety incidents', 'Budget used'], runnerIds: ['mgr', 'owner'] };

describe('the monthly "enter your KPI values" reminder (through Notification & Scheduling)', () => {
  it('waits for the first working morning of the month (1 Nov is a day off here: Mon 2 Nov from 08:00)', async () => {
    const s = setup(at('2026-11-01', '10:00'), [P]);
    expect(await s.reminder.run()).toBe(0);
    s.setNow(at('2026-11-02', '07:30'));
    expect(await s.reminder.run()).toBe(0);
    s.setNow(at('2026-11-02', '08:05'));
    expect(await s.reminder.run()).toBe(2);
    expect(s.sent[0]).toMatchObject({ userId: 'mgr', type: 'KPI_VALUES_DUE', title: 'Time to enter October’s KPI values', body: 'Rig 3: Safety incidents, Budget used', entityType: 'project-kpis', entityId: 'p1' });
  });

  it('once per person, project and month — later runs and later days send nothing more', async () => {
    const s = setup(at('2026-11-02', '09:00'), [P]);
    await s.reminder.run();
    s.setNow(at('2026-11-05', '09:00'));
    expect(await s.reminder.run()).toBe(0);
    expect(s.sent).toHaveLength(2);
  });

  it('nothing missing, nothing sent; a long list is shortened', async () => {
    const s = setup(at('2026-11-02', '09:00'), [{ ...P, missing: ['A', 'B', 'C', 'D', 'E'], runnerIds: ['mgr'] }]);
    await s.reminder.run();
    expect(s.sent[0]!.body).toBe('Rig 3: A, B, C and 2 more');
    expect((await setup(at('2026-11-02', '09:00'), [{ ...P, missing: [] }]).reminder.run())).toBe(0);
  });
});
