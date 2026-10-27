import { describe, it, expect } from 'vitest';
import { createWeeklySummaryService, type WeeklyRecipient } from './weekly-summary-service';
import type { WeeklySummaryRecord, WeeklySummaryRepository } from './weekly-summary-repository';
import type { WeeklyDigest } from './management-service';
import type { EmailContent } from '../email/email-templates';

const TZ = 'Asia/Muscat';
const SUN_THU = [0, 1, 2, 3, 4];

/** The unique (person, week) row the database keeps, in memory. */
function memoryRepo(): WeeklySummaryRepository & { rows: WeeklySummaryRecord[] } {
  const rows: WeeklySummaryRecord[] = [];
  let n = 0;
  return {
    rows,
    async claim(userId, week) {
      if (rows.some((r) => r.userId === userId && r.week === week)) return null;
      const at = new Date();
      const row: WeeklySummaryRecord = { id: `w${++n}`, userId, week, status: 'SENDING', attempts: 1, projectCount: 0, nextAttemptAt: null, lastError: null, sentAt: null, createdAt: at, updatedAt: at };
      rows.push(row);
      return { ...row };
    },
    async forWeeks(weeks) {
      return rows.filter((r) => weeks.includes(r.week)).map((r) => ({ ...r }));
    },
    async dueForRetry(now, staleBefore) {
      return rows.filter((r) => (r.status === 'RETRY' && r.nextAttemptAt && r.nextAttemptAt <= now) || (r.status === 'SENDING' && r.updatedAt < staleBefore)).map((r) => ({ ...r }));
    },
    async retake(row) {
      const r = rows.find((x) => x.id === row.id && x.status === row.status && x.attempts === row.attempts);
      if (!r) return null;
      Object.assign(r, { status: 'SENDING', attempts: r.attempts + 1, nextAttemptAt: null });
      return { ...r };
    },
    async finish(taken, patch) {
      const r = rows.find((x) => x.id === taken.id && x.status === 'SENDING' && x.attempts === taken.attempts);
      if (!r) return false;
      Object.assign(r, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
      return true;
    },
  };
}

const person = (id: string, over: Partial<WeeklyRecipient> = {}): WeeklyRecipient => ({
  id,
  name: id[0]!.toUpperCase() + id.slice(1),
  email: `${id}@mico360.test`,
  timeZone: null,
  prefs: { muted: [] },
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  roles: ['EMPLOYEE'],
  runsProjects: false,
  ...over,
});
const PEOPLE: WeeklyRecipient[] = [
  person('aisha', { roles: ['ADMIN'] }),
  person('sara', { runsProjects: true }),
  person('omar', { runsProjects: true, prefs: { muted: [], weeklySummary: false } }), // turned it off
  person('nadia', { runsProjects: true }), // runs only finished projects: nothing in scope
  person('zara'), // runs nothing
  person('noemail', { roles: ['ADMIN'], email: null }),
];
const digestOf = (id: string): WeeklyDigest | null =>
  id === 'nadia'
    ? null
    : {
        scope: id === 'aisha' ? 'ALL' : 'RUN',
        projects: id === 'aisha' ? 4 : 2,
        red: 1,
        amber: 0,
        green: 1,
        worst: [{ id: 'rig', code: 'RIG', name: id === 'aisha' ? 'All of them' : 'Rig Inspection Portal', rag: 'RED', reasons: [{ code: 'MANY_MISSING_CHECKS', level: 'RED', text: '3 missing checks' }] }],
        lateTasks: 4,
        missingChecks: 3,
        lastWeek: { start: '2026-10-18', end: '2026-10-24' },
        doneLateLastWeek: 1,
        passRateLastWeek: 80,
        mostLate: [],
      };

function setup(o: { people?: WeeklyRecipient[]; weekStart?: 0 | 1 | 6; enabled?: boolean; configured?: boolean; fail?: (to: string) => boolean } = {}) {
  let clock = new Date();
  const repo = memoryRepo();
  const sent: { to: string; content: EmailContent; template: string }[] = [];
  const digests: string[] = [];
  const svc = createWeeklySummaryService({
    repo,
    people: { list: async () => o.people ?? PEOPLE, find: async (id) => (o.people ?? PEOPLE).find((p) => p.id === id) ?? null },
    digest: async (viewer) => {
      digests.push(`${viewer.id}:${viewer.roles.join(',')}`);
      return digestOf(viewer.id);
    },
    send: async (to, content, template) => {
      if (o.fail?.(to)) throw new Error('Mail server said no');
      sent.push({ to, content, template });
      return 'sent';
    },
    isConfigured: () => o.configured ?? true,
    enabled: async () => o.enabled ?? true,
    calendar: async () => ({ weekStart: o.weekStart ?? 0, workingDays: SUN_THU }),
    companyTimeZone: TZ,
    appUrl: 'https://task.mico360.com',
    now: () => clock,
  });
  return { svc, repo, sent, digests, at: (iso: string) => (clock = new Date(iso)) };
}

// Sunday 25 October 2026: 06:00 in Muscat is 02:00 UTC.
const SUN_0559 = '2026-10-25T01:59:00.000Z';
const SUN_0600 = '2026-10-25T02:00:00.000Z';

describe('the weekly management summary sweep', () => {
  it('goes on the first working morning of the company week (Sunday), at the daily-email time, to everyone who can see the dashboard', async () => {
    const t = setup();
    t.at(SUN_0559);
    await t.svc.runSweep();
    expect(t.sent).toEqual([]);
    t.at(SUN_0600);
    const tally = await t.svc.runSweep();
    expect(t.sent.map((s) => s.to).sort()).toEqual(['aisha@mico360.test', 'sara@mico360.test']);
    expect(tally).toMatchObject({ SENT: 2, SKIPPED: 1 });
    // Each gets their own scope: the digest is asked as them.
    expect(t.digests.sort()).toEqual(['aisha:ADMIN', 'nadia:EMPLOYEE', 'sara:EMPLOYEE']);
    const sara = t.sent.find((s) => s.to === 'sara@mico360.test')!;
    expect(sara.template).toBe('weekly-summary');
    expect(sara.content.subject).toBe('Weekly summary: 1 red, 0 amber · 4 late tasks');
    expect(sara.content.text).toContain('Rig Inspection Portal');
    expect(sara.content.text).toContain('https://task.mico360.com/management');
    // Nothing in scope: no email, written down as skipped.
    expect(t.repo.rows.find((r) => r.userId === 'nadia')).toMatchObject({ status: 'SKIPPED', week: '2026-10-25' });
    expect(t.repo.rows.find((r) => r.userId === 'sara')).toMatchObject({ status: 'SENT', week: '2026-10-25', projectCount: 2 });
  });

  it('is sent once a week: a later sweep, a later day of the week and a restart send nothing more; the next week sends again', async () => {
    const t = setup();
    t.at(SUN_0600);
    await t.svc.runSweep();
    t.at('2026-10-25T09:00:00.000Z');
    await t.svc.runSweep();
    t.at('2026-10-26T02:00:00.000Z'); // Monday
    await t.svc.runSweep();
    expect(t.sent).toHaveLength(2);
    t.at('2026-11-01T02:00:00.000Z'); // next Sunday
    await t.svc.runSweep();
    expect(t.sent).toHaveLength(4);
    expect(t.repo.rows.filter((r) => r.userId === 'sara').map((r) => r.week)).toEqual(['2026-10-25', '2026-11-01']);
  });

  it('a week that starts on Monday goes on Monday morning (not on Sunday)', async () => {
    const t = setup({ weekStart: 1 });
    t.at(SUN_0600);
    await t.svc.runSweep();
    expect(t.sent).toEqual([]);
    t.at('2026-10-26T02:00:00.000Z');
    await t.svc.runSweep();
    expect(t.sent.map((s) => s.to).sort()).toEqual(['aisha@mico360.test', 'sara@mico360.test']);
    expect(t.repo.rows.find((r) => r.userId === 'sara')!.week).toBe('2026-10-26');
  });

  it('a week that starts on Saturday goes on its first working day (Sunday)', async () => {
    const t = setup({ weekStart: 6 });
    t.at('2026-10-24T02:00:00.000Z'); // Saturday: a day off
    await t.svc.runSweep();
    expect(t.sent).toEqual([]);
    t.at(SUN_0600);
    await t.svc.runSweep();
    expect(t.sent).toHaveLength(2);
    expect(t.repo.rows.find((r) => r.userId === 'sara')!.week).toBe('2026-10-24');
  });

  it('follows the person’s own email time and time zone; someone who joined after this week’s time starts next week', async () => {
    const t = setup({
      people: [
        person('late', { runsProjects: true, prefs: { muted: [], dailyEmails: { pending: true, completed: true, time: '07:30' } } }),
        person('far', { runsProjects: true, timeZone: 'Asia/Kolkata' }), // 06:00 there is 00:30 UTC
        person('newbie', { runsProjects: true, createdAt: new Date('2026-10-25T03:00:00.000Z') }),
      ],
    });
    t.at('2026-10-25T00:31:00.000Z');
    await t.svc.runSweep();
    expect(t.sent.map((s) => s.to)).toEqual(['far@mico360.test']);
    t.at('2026-10-25T03:30:00.000Z'); // 07:30 in Muscat
    await t.svc.runSweep();
    expect(t.sent.map((s) => s.to)).toEqual(['far@mico360.test', 'late@mico360.test']);
  });

  it('nothing goes while the company switch is off or email isn’t set up', async () => {
    for (const o of [{ enabled: false }, { configured: false }]) {
      const t = setup(o);
      t.at(SUN_0600);
      await t.svc.runSweep();
      expect(t.sent).toEqual([]);
      expect(t.repo.rows).toEqual([]);
    }
  });

  it('a failed send is tried again after 5, 15 and 45 minutes, then given up', async () => {
    let failing = true;
    const t = setup({ fail: (to) => failing && to === 'sara@mico360.test' });
    t.at(SUN_0600);
    await t.svc.runSweep();
    const row = () => t.repo.rows.find((r) => r.userId === 'sara')!;
    expect(row()).toMatchObject({ status: 'RETRY', attempts: 1, lastError: 'Mail server said no' });
    expect(row().nextAttemptAt!.toISOString()).toBe('2026-10-25T02:05:00.000Z');
    t.at('2026-10-25T02:04:00.000Z');
    await t.svc.runSweep();
    expect(row().attempts).toBe(1);
    t.at('2026-10-25T02:05:00.000Z');
    await t.svc.runSweep();
    expect(row()).toMatchObject({ status: 'RETRY', attempts: 2 });
    expect(row().nextAttemptAt!.toISOString()).toBe('2026-10-25T02:20:00.000Z');
    failing = false;
    t.at('2026-10-25T02:20:00.000Z');
    await t.svc.runSweep();
    expect(row()).toMatchObject({ status: 'SENT', attempts: 3 });
    expect(t.sent.filter((s) => s.to === 'sara@mico360.test')).toHaveLength(1);

    const g = setup({ fail: (to) => to === 'sara@mico360.test' });
    for (const at of ['2026-10-25T02:00:00.000Z', '2026-10-25T02:05:00.000Z', '2026-10-25T02:20:00.000Z', '2026-10-25T03:05:00.000Z']) {
      g.at(at);
      await g.svc.runSweep();
    }
    expect(g.repo.rows.find((r) => r.userId === 'sara')).toMatchObject({ status: 'FAILED', attempts: 4 });
  });

  it('someone who turned it off before a retry gets nothing', async () => {
    let off = false;
    const people = [person('sara', { runsProjects: true })];
    const t = setup({ people, fail: () => !off });
    t.at(SUN_0600);
    await t.svc.runSweep();
    off = true;
    people[0]!.prefs = { muted: [], weeklySummary: false };
    t.at('2026-10-25T02:05:00.000Z');
    await t.svc.runSweep();
    expect(t.sent).toEqual([]);
    expect(t.repo.rows[0]).toMatchObject({ status: 'SKIPPED' });
  });
});
