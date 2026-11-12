import { describe, it, expect, vi } from 'vitest';
import { createDailyEmailService, NOT_A_WORKING_DAY, type DailyRecipient } from './daily-email-service';
import type { DailyEmailRecord, DailyEmailRepository } from './daily-email-repository';
import type { DailyMeeting, DailyProjectFigures, DailyTask, DailyWeek } from './daily-email-content';
import type { EmailContent } from '../email/email-templates';

/** The delivery records in memory, with the same once-only rules as the database. */
function memoryRepo(clock: () => Date = () => new Date()) {
  const rows: DailyEmailRecord[] = [];
  let seq = 0;
  let failFinishes = 0;
  const failClaimsFor = new Set<string>();
  const repo: DailyEmailRepository = {
    async claim(userId, day, kind) {
      if (failClaimsFor.has(userId)) throw new Error('The database is not answering');
      if (rows.some((r) => r.userId === userId && r.day === day && r.kind === kind)) return null;
      const now = clock();
      const r: DailyEmailRecord = { id: `r${seq++}`, userId, day, kind, status: 'SENDING', attempts: 1, taskCount: 0, nextAttemptAt: null, lastError: null, sentAt: null, createdAt: now, updatedAt: now };
      rows.push(r);
      return { ...r };
    },
    async dueForRetry(now, staleBefore) {
      return rows
        .filter((r) => (r.status === 'RETRY' && r.nextAttemptAt && r.nextAttemptAt <= now) || (r.status === 'SENDING' && r.updatedAt < staleBefore))
        .map((r) => ({ ...r }));
    },
    async retake(row) {
      const r = rows.find((x) => x.id === row.id);
      if (!r || r.status !== row.status || r.attempts !== row.attempts) return null;
      Object.assign(r, { status: 'SENDING', attempts: r.attempts + 1, nextAttemptAt: null, updatedAt: clock() });
      return { ...r };
    },
    async finish(taken, patch) {
      if (failFinishes > 0) {
        failFinishes--;
        throw new Error('The database is not answering');
      }
      const r = rows.find((x) => x.id === taken.id && x.status === 'SENDING' && x.attempts === taken.attempts);
      if (!r) return false;
      Object.assign(r, patch, { updatedAt: clock() });
      return true;
    },
    async list() {
      return [];
    },
    async find(userId, day, kind) {
      const r = rows.find((x) => x.userId === userId && x.day === day && x.kind === kind);
      return r ? { ...r } : null;
    },
    async forDays(days) {
      // With who it was for, as the database joins it (the test people's names and addresses).
      return rows.filter((r) => days.includes(r.day)).map((r) => ({ ...r, userName: r.userId.toUpperCase(), username: r.userId, email: `${r.userId}@mico360.test`, timeZone: null }));
    },
    async lastSent(userId, kind, beforeDay) {
      const sent = rows.filter((r) => r.userId === userId && r.kind === kind && r.status === 'SENT' && r.sentAt && r.day < beforeDay);
      const last = sent.sort((a, b) => b.sentAt!.getTime() - a.sentAt!.getTime())[0];
      return last ? { day: last.day, sentAt: last.sentAt! } : null;
    },
  };
  return { repo, rows, failFinishes: (n: number) => { failFinishes = n; }, failClaimsFor };
}

/** A delivery record as it would be in the database (for states a test sets up directly). */
const record = (extra: Partial<DailyEmailRecord> & Pick<DailyEmailRecord, 'id' | 'userId' | 'kind' | 'status'>): DailyEmailRecord => ({
  day: '2026-10-21', attempts: 1, taskCount: 0, nextAttemptAt: null, lastError: null, sentAt: null,
  createdAt: new Date('2026-10-21T02:00:00Z'), updatedAt: new Date('2026-10-21T02:00:00Z'), ...extra,
});

const TZ = 'Asia/Muscat';
const at = (iso: string) => new Date(iso);
const person = (id: string, extra: Partial<DailyRecipient> = {}): DailyRecipient => ({
  id,
  name: id.toUpperCase(),
  username: id,
  email: `${id}@mico360.test`,
  timeZone: null,
  prefs: { muted: [] },
  createdAt: at('2026-01-01T00:00:00Z'),
  ...extra,
});
const RIG: DailyTask['project'] = { id: 'p-rig', code: 'RIG', name: 'Rig', number: null, clientName: null, managerName: null, status: 'ACTIVE', color: null, imageUrl: '/uploads/projects/rig.png', targetDate: null };
const task = (key: string, extra: Partial<DailyTask> = {}): DailyTask => ({
  id: key, key, title: key, project: RIG, priority: 'NORMAL', dueDate: null, statusLabel: 'To Do', completedAt: null, ...extra,
});

/** When the sweep last ran, kept like the database keeps it: shared by every server (and a restart). */
function checkStore() {
  let last: Date | null = null;
  return { record: async (at: Date) => { last = at; }, last: async () => last };
}

function setup(
  opts: {
    people?: DailyRecipient[];
    pending?: DailyTask[];
    completed?: DailyTask[];
    meetings?: DailyMeeting[];
    managed?: DailyTask[];
    awaiting?: number;
    configured?: boolean;
    failures?: number;
    blocked?: string[];
    checks?: ReturnType<typeof checkStore>;
    week?: DailyWeek;
    projects?: DailyProjectFigures[];
    companyWeekStart?: number;
  } = {},
) {
  let now = at('2026-10-21T02:00:00Z'); // 06:00 in Muscat
  const { repo, rows, failFinishes, failClaimsFor } = memoryRepo(() => now);
  let listFails = false;
  let failures = opts.failures ?? 0;
  // The next send waits until the test lets it go (a slow provider), then goes through or fails.
  let held: { wait: Promise<void>; fail: boolean } | null = null;
  const sent: Array<{ to: string; subject: string; template: string; html: string }> = [];
  const people = opts.people ?? [person('ada')];
  let pendingTasks = opts.pending ?? [task('RIG-1')];
  let completedTasks = opts.completed ?? [task('RIG-2', { completedAt: at('2026-10-20T08:00:00Z') })];
  const pending = vi.fn(async () => pendingTasks);
  const completedBetween = vi.fn(async (_u: string, _from: Date, _to: Date) => completedTasks);
  const meetingsBetween = vi.fn(async (_u: string, _from: Date, _to: Date) => opts.meetings ?? []);
  const managed = vi.fn(async (_u: string, _at: Date) => opts.managed ?? []);
  const weekFigures = vi.fn(async (_u: string, _r: { dueFrom: Date; dueTo: Date; doneFrom: Date; now: Date }) => opts.week ?? { due: [], completions: [] });
  const projectFigures = vi.fn(async (_u: string, _o: { now: Date; timeZone: string; companyTimeZone: string }) => opts.projects ?? []);
  const weekStartOf = vi.fn(async (_u: string) => opts.companyWeekStart ?? 0);
  const warn = vi.fn();
  const service = createDailyEmailService({
    repo,
    people: {
      list: async () => {
        if (listFails) throw new Error('The database is not answering');
        return people;
      },
      find: async (id) => people.find((p) => p.id === id) ?? null,
    },
    tasks: { pending, completedBetween, meetingsBetween, managed, weekFigures, projectFigures, awaitingApproval: async () => opts.awaiting ?? 0 },
    weekStartOf,
    send: async (to: string, content: EmailContent, template: string) => {
      if (held) {
        const h = held;
        held = null;
        await h.wait;
        if (h.fail) throw new Error('Timed out');
      }
      if (failures > 0) {
        failures--;
        throw new Error('HTTP 503');
      }
      if (opts.blocked?.includes(to)) return 'suppressed' as const;
      sent.push({ to, subject: content.subject, template, html: content.html });
      return 'sent' as const;
    },
    isConfigured: () => opts.configured ?? true,
    companyTimeZone: TZ,
    appUrl: 'https://task.example',
    assetUrl: 'https://api.example',
    now: () => now,
    logger: { info: vi.fn(), warn },
    ...(opts.checks ? { checks: opts.checks } : {}),
  });
  return {
    service, rows, sent, pending, completedBetween, meetingsBetween, managed, weekFigures, projectFigures, weekStartOf, warn, people,
    setNow: (iso: string) => { now = at(iso); },
    setFailures: (n: number) => { failures = n; },
    failFinishes,
    failClaimsFor,
    failList: () => { listFails = true; },
    /** Holds the next send until `release` (then it goes, or fails with `fail`). */
    holdNextSend: () => {
      let release!: () => void;
      const h = { wait: new Promise<void>((r) => { release = r; }), fail: false };
      held = h;
      return { release: (o: { fail?: boolean } = {}) => { h.fail = o.fail === true; release(); } };
    },
    setTasks: (t: { pending?: DailyTask[]; completed?: DailyTask[] }) => {
      if (t.pending) pendingTasks = t.pending;
      if (t.completed) completedTasks = t.completed;
    },
  };
}

/** Lets pending promise callbacks run (a held send starts waiting). */
const settle = () => new Promise((r) => setTimeout(r, 0));

/** "Send today's emails now", run to the end: its counts. */
const sendNowAll = async (s: ReturnType<typeof setup>) => (await s.service.startSendNow().finished).counts;

describe('the daily email: the morning sweep', () => {
  it('sends the one daily email at 06:00 in the person’s time zone, not before', async () => {
    const s = setup();
    s.setNow('2026-10-21T01:59:00Z'); // 05:59
    await s.service.runSweep();
    expect(s.sent).toEqual([]);
    s.setNow('2026-10-21T02:00:00Z');
    await s.service.runSweep();
    expect(s.sent.map((m) => [m.to, m.template])).toEqual([['ada@mico360.test', 'daily-email']]);
    expect(s.rows.map((r) => [r.kind, r.status, r.day, r.taskCount])).toEqual([['PENDING', 'SENT', '2026-10-21', 1]]);
  });

  it('sends it only once a day, however often it runs', async () => {
    const s = setup();
    for (const t of ['02:00', '02:01', '05:00', '19:59']) {
      s.setNow(`2026-10-21T${t}:00Z`);
      await s.service.runSweep();
    }
    expect(s.sent).toHaveLength(1);
    s.setNow('2026-10-22T02:00:00Z'); // the next morning
    await s.service.runSweep();
    expect(s.sent).toHaveLength(2);
  });

  it('a day that already had the old pending-tasks email doesn’t get a second one', async () => {
    const s = setup();
    s.rows.push(record({ id: 'old', userId: 'ada', kind: 'PENDING', status: 'SENT', sentAt: at('2026-10-21T02:00:00Z') }));
    s.setNow('2026-10-21T02:30:00Z');
    await s.service.runSweep();
    expect(s.sent).toEqual([]);
  });

  it('builds it from the person’s day: their tasks now, today’s meetings, the projects they run, and what was completed since yesterday', async () => {
    const s = setup();
    await s.service.runSweep();
    expect(s.pending).toHaveBeenCalledWith('ada');
    expect(s.managed).toHaveBeenCalledWith('ada', at('2026-10-21T02:00:00Z'));
    const [who, dayStart, dayEnd] = s.meetingsBetween.mock.calls[0]!;
    expect([who, dayStart.toISOString(), dayEnd.toISOString()]).toEqual(['ada', '2026-10-20T20:00:00.000Z', '2026-10-21T20:00:00.000Z']); // 21 Oct in Muscat
    const [userId, from, to] = s.completedBetween.mock.calls[0]!;
    expect(userId).toBe('ada');
    expect(from.toISOString()).toBe('2026-10-19T20:00:00.000Z'); // no email before: from 20 Oct 00:00 in Muscat
    expect(to.toISOString()).toBe('2026-10-21T02:00:00.000Z'); // to now
  });

  it('"Recently completed" starts where the last email ended — never more than a week back', async () => {
    const s = setup();
    s.rows.push(record({ id: 'y', userId: 'ada', day: '2026-10-20', kind: 'PENDING', status: 'SENT', sentAt: at('2026-10-20T02:10:00Z') }));
    await s.service.runSweep();
    expect(s.completedBetween.mock.calls[0]![1].toISOString()).toBe('2026-10-20T02:10:00.000Z');
    const t = setup();
    t.rows.push(record({ id: 'w', userId: 'ada', day: '2026-10-01', kind: 'PENDING', status: 'SENT', sentAt: at('2026-10-01T02:00:00Z') }));
    await t.service.runSweep();
    expect(t.completedBetween.mock.calls[0]![1].toISOString()).toBe('2026-10-13T20:00:00.000Z'); // 14 Oct 00:00 in Muscat
  });

  it('1.22 review: the first email after the upgrade starts "Recently completed" where the old completed email ended (that day’s start)', async () => {
    const s = setup();
    s.rows.push(
      record({ id: 'p', userId: 'ada', day: '2026-10-20', kind: 'PENDING', status: 'SENT', sentAt: at('2026-10-20T02:00:00Z') }),
      record({ id: 'c', userId: 'ada', day: '2026-10-20', kind: 'COMPLETED', status: 'SENT', sentAt: at('2026-10-20T02:00:00Z') }),
    );
    await s.service.runSweep();
    expect(s.completedBetween.mock.calls[0]![1].toISOString()).toBe('2026-10-19T20:00:00.000Z'); // 20 Oct 00:00 in Muscat
  });

  it('1.22 review: the upgrade day — someone who already got today’s old "Completed yesterday" email gets no second one', async () => {
    const s = setup({ people: [person('ada', { prefs: { muted: [], dailyEmails: { pending: false, completed: true, time: '06:00' } } })] });
    s.rows.push(record({ id: 'c', userId: 'ada', kind: 'COMPLETED', status: 'SENT', sentAt: at('2026-10-21T02:00:00Z') }));
    s.setNow('2026-10-21T03:00:00Z');
    expect(await sendNowAll(s)).toMatchObject({ sent: 0, alreadyDone: 1 });
    await s.service.runSweep();
    expect(s.sent).toEqual([]);
    expect(s.rows.find((r) => r.kind === 'PENDING')).toMatchObject({ status: 'SKIPPED', lastError: 'Already got today’s “Completed yesterday” email (before the one daily email).' });
    s.setNow('2026-10-22T02:00:00Z'); // the next morning: the one daily email
    await s.service.runSweep();
    expect(s.sent.map((m) => m.template)).toEqual(['daily-email']);
  });

  it('1.22 review: a retry after midnight is about the new day (its meetings), as its date and counts are', async () => {
    const s = setup({ people: [person('ada', { prefs: { muted: [], dailyEmails: { pending: true, completed: true, time: '23:50' } } })], failures: 1 });
    s.setNow('2026-10-21T19:50:00Z'); // 23:50 on 21 Oct in Muscat: fails
    await s.service.runSweep();
    s.meetingsBetween.mockClear();
    s.setNow('2026-10-21T20:05:00Z'); // 00:05 on 22 Oct: the retry
    await s.service.runSweep();
    expect(s.sent).toHaveLength(1);
    expect(s.meetingsBetween.mock.calls[0]![1].toISOString()).toBe('2026-10-21T20:00:00.000Z'); // 22 Oct 00:00 in Muscat
  });

  it('asks only for the parts that are on', async () => {
    const s = setup({ people: [person('ada', { prefs: { muted: [], dailyEmails: { pending: true, completed: false, time: '06:00', schedule: false, urgent: true, managed: false } } })] });
    await s.service.runSweep();
    expect(s.sent).toHaveLength(1);
    expect(s.meetingsBetween).not.toHaveBeenCalled();
    expect(s.managed).not.toHaveBeenCalled();
    expect(s.completedBetween).not.toHaveBeenCalled();
    // At a glance is on (it follows the task list): the week's figures are read; Your projects follows "In your projects" (off).
    expect(s.weekFigures).toHaveBeenCalled();
    expect(s.projectFigures).not.toHaveBeenCalled();
    const t = setup({ people: [person('ada', { prefs: { muted: [], dailyEmails: { ...ALL_OFF, urgent: true, time: '06:00' } } })], pending: [task('RIG-1', { dueDate: at('2026-10-19T00:00:00Z') })] });
    await t.service.runSweep();
    expect(t.sent).toHaveLength(1);
    expect(t.weekFigures).not.toHaveBeenCalled();
    expect(t.projectFigures).not.toHaveBeenCalled();
  });

  it('redesign: the week’s figures from the person’s own week start, else their company’s, in their time zone', async () => {
    // Wed 21 Oct 06:00 Muscat. Their own week starts on Monday: Mon 19 Oct.
    const s = setup({ people: [person('ada', { weekStart: 1 })], companyWeekStart: 6 });
    await s.service.runSweep();
    expect(s.weekStartOf).not.toHaveBeenCalled();
    const [who, r] = s.weekFigures.mock.calls[0]!;
    expect(who).toBe('ada');
    // Due dates a day either side of the week (the email keeps those in it, by its own day rule).
    expect([r.dueFrom.toISOString(), r.dueTo.toISOString()]).toEqual(['2026-10-18T00:00:00.000Z', '2026-10-27T00:00:00.000Z']);
    // Completed since 14 days back (7 Oct 00:00 Muscat), until now.
    expect([r.doneFrom.toISOString(), r.now.toISOString()]).toEqual(['2026-10-06T20:00:00.000Z', '2026-10-21T02:00:00.000Z']);
    // No week start of their own: their company's (Saturday: Sat 17 Oct).
    const t = setup({ companyWeekStart: 6 });
    await t.service.runSweep();
    expect(t.weekStartOf).toHaveBeenCalledWith('ada');
    expect(t.weekFigures.mock.calls[0]![1].dueFrom.toISOString()).toBe('2026-10-16T00:00:00.000Z');
    expect(t.sent[0]!.html).toContain('Today at a glance');
  });

  it('redesign: the projects they run, with their time zone (overdue is by their day)', async () => {
    const s = setup({ people: [person('ada', { timeZone: 'Asia/Dubai' })] });
    await s.service.runSweep();
    // Board days (a task waiting for a later day) are the company's days: its time zone goes too.
    expect(s.projectFigures).toHaveBeenCalledWith('ada', { now: at('2026-10-21T02:00:00Z'), timeZone: 'Asia/Dubai', companyTimeZone: TZ });
  });

  it('it goes when only approvals wait for the person (none of their own tasks)', async () => {
    const s = setup({ pending: [], completed: [], awaiting: 2 });
    await s.service.runSweep();
    expect(s.sent.map((m) => [m.template, m.subject])).toEqual([['daily-email', 'Today: 2 tasks to approve — Wed 21 Oct']]);
  });

  it('it goes for a meeting today alone, and for the projects the person runs alone', async () => {
    const meeting: DailyMeeting = { id: 'm1', title: 'Site walk', startAt: at('2026-10-21T05:00:00Z'), endAt: null, location: null, online: false, projectName: null, organizer: true, response: null, status: 'SCHEDULED' };
    const a = setup({ pending: [], completed: [], meetings: [meeting] });
    await a.service.runSweep();
    expect(a.sent.map((m) => m.subject)).toEqual(['Today: 1 meeting — Wed 21 Oct']);
    const b = setup({ pending: [], completed: [], managed: [task('RIG-7', { dueDate: at('2026-10-19T00:00:00Z'), assignees: ['Omar'] })] });
    await b.service.runSweep();
    expect(b.sent).toHaveLength(1);
    expect(b.sent[0]!.html).toContain('Overdue and waiting in your projects');
    const c = setup({ pending: [], completed: [], projects: [{ project: RIG, pct: 40, done: 4, total: 10, open: 6, overdue: 1, waiting: 0 }] });
    await c.service.runSweep();
    expect(c.sent[0]!.html).toContain('Your projects');
  });

  it('skips an email with nothing in it, and records that', async () => {
    const s = setup({ pending: [], completed: [] });
    await s.service.runSweep();
    expect(s.sent).toEqual([]);
    expect(s.rows).toMatchObject([{ kind: 'PENDING', status: 'SKIPPED', taskCount: 0 }]);
  });

  it('follows each person’s settings: a later time; every part turned off (or both old emails off) is no email', async () => {
    const s = setup({ people: [person('ada', { prefs: { muted: [], dailyEmails: { pending: true, completed: false, time: '07:30' } } }), person('bo', { prefs: bothOff })] });
    s.setNow('2026-10-21T03:29:00Z'); // 07:29
    await s.service.runSweep();
    expect(s.sent).toEqual([]);
    s.setNow('2026-10-21T03:30:00Z');
    await s.service.runSweep();
    expect(s.sent.map((m) => [m.to, m.template])).toEqual([['ada@mico360.test', 'daily-email']]);
    expect(s.sent[0]!.html).not.toContain('Completed yesterday'); // that part is off
    expect(s.rows.map((r) => [r.userId, r.kind])).toEqual([['ada', 'PENDING']]);
  });

  it('uses the person’s own time zone, else the company’s', async () => {
    const s = setup({ people: [person('ada'), person('ravi', { timeZone: 'Asia/Kolkata' })] });
    s.setNow('2026-10-21T00:30:00Z'); // 06:00 in Kolkata, 04:30 in Muscat
    await s.service.runSweep();
    expect([...new Set(s.sent.map((m) => m.to))]).toEqual(['ravi@mico360.test']);
  });

  it('catches up later that day when the server was asleep at the time', async () => {
    const s = setup();
    s.setNow('2026-10-21T05:00:00Z'); // 09:00
    await s.service.runSweep();
    expect(s.sent).toHaveLength(1);
  });

  it('starts the morning after for someone who joined after their time today', async () => {
    const s = setup({ people: [person('new', { createdAt: at('2026-10-21T04:00:00Z') })] }); // joined 08:00
    s.setNow('2026-10-21T05:00:00Z');
    await s.service.runSweep();
    expect(s.sent).toEqual([]);
    s.setNow('2026-10-22T02:00:00Z');
    await s.service.runSweep();
    expect(s.sent).toHaveLength(1);
  });

  it('an address blocked after a bounce or spam complaint is recorded as skipped, with why — never as sent', async () => {
    const s = setup({ blocked: ['ada@mico360.test'] });
    await s.service.runSweep();
    expect(s.sent).toEqual([]);
    expect(s.rows.map((r) => [r.kind, r.status, r.sentAt, r.lastError])).toEqual([['PENDING', 'SKIPPED', null, 'Address blocked after a bounce or spam complaint.']]);
    const r = await s.service.sendFor('ada', { kind: 'PENDING' });
    expect(r!.results).toEqual([{ kind: 'PENDING', outcome: 'blocked', error: 'Address blocked after a bounce or spam complaint.', sentAt: null }]);
  });

  it('leaves out people without an email address', async () => {
    const s = setup({ people: [person('ada', { email: null })] });
    await s.service.runSweep();
    expect(s.sent).toEqual([]);
    expect(s.rows).toEqual([]);
  });
});

describe('daily task emails: failures and retries', () => {
  it('tries again after 5, 15 and 45 minutes, then records it as failed', async () => {
    const s = setup({ people: [person('ada', { prefs: { muted: [], dailyEmails: { pending: true, completed: false, time: '06:00' } } })], failures: 99 });
    const sweepAt = async (iso: string) => {
      s.setNow(iso);
      await s.service.runSweep();
    };
    await sweepAt('2026-10-21T02:00:00Z');
    expect(s.rows[0]).toMatchObject({ status: 'RETRY', attempts: 1, lastError: 'HTTP 503' });
    expect(s.rows[0]!.nextAttemptAt!.toISOString()).toBe('2026-10-21T02:05:00.000Z');
    await sweepAt('2026-10-21T02:04:00Z'); // not yet
    expect(s.rows[0]!.attempts).toBe(1);
    await sweepAt('2026-10-21T02:05:00Z');
    expect(s.rows[0]).toMatchObject({ status: 'RETRY', attempts: 2 });
    expect(s.rows[0]!.nextAttemptAt!.toISOString()).toBe('2026-10-21T02:20:00.000Z');
    await sweepAt('2026-10-21T02:20:00Z');
    expect(s.rows[0]!.nextAttemptAt!.toISOString()).toBe('2026-10-21T03:05:00.000Z');
    await sweepAt('2026-10-21T03:05:00Z');
    expect(s.rows[0]).toMatchObject({ status: 'FAILED', attempts: 4, lastError: 'HTTP 503' });
    await sweepAt('2026-10-21T05:00:00Z');
    expect(s.rows[0]!.attempts).toBe(4); // given up
    expect(s.sent).toEqual([]);
  });

  it('records a retry that goes through as sent, once', async () => {
    const s = setup({ people: [person('ada', { prefs: { muted: [], dailyEmails: { pending: true, completed: false, time: '06:00' } } })], failures: 1 });
    await s.service.runSweep();
    s.setNow('2026-10-21T02:05:00Z');
    await s.service.runSweep();
    await s.service.runSweep();
    expect(s.sent).toHaveLength(1);
    expect(s.rows[0]).toMatchObject({ status: 'SENT', attempts: 2 });
  });

  it('drops an old “Completed yesterday” retry: that email is part of the daily email now', async () => {
    const s = setup();
    s.rows.push(record({ id: 'c1', userId: 'ada', kind: 'COMPLETED', status: 'RETRY', nextAttemptAt: at('2026-10-21T01:55:00Z'), lastError: 'HTTP 503' }));
    await s.service.runSweep();
    expect(s.rows.find((r) => r.id === 'c1')).toMatchObject({ status: 'SKIPPED', nextAttemptAt: null });
    expect(s.sent.map((m) => m.template)).toEqual(['daily-email']);
  });

  it('drops a retry when the person has turned the email off since', async () => {
    const s = setup({ failures: 1 });
    await s.service.runSweep();
    s.people[0]!.prefs = bothOff;
    s.setNow('2026-10-21T02:05:00Z');
    await s.service.runSweep();
    expect(s.sent).toEqual([]);
    expect(s.rows.find((r) => r.kind === 'PENDING')).toMatchObject({ status: 'SKIPPED' });
  });

  it('a send cut off part-way (still “being sent” 15 minutes later: a restart) is tried again', async () => {
    const s = setup({ people: [person('ada', { prefs: onlyPending })] });
    s.rows.push(record({ id: 'a1', userId: 'ada', kind: 'PENDING', status: 'SENDING', updatedAt: at('2026-10-21T02:00:00Z') }));
    s.setNow('2026-10-21T02:10:00Z'); // only 10 minutes: it may still be going
    await s.service.runSweep();
    expect(s.sent).toEqual([]);
    s.setNow('2026-10-21T02:16:00Z');
    await s.service.runSweep();
    expect(s.sent.map((m) => m.template)).toEqual(['daily-email']);
    expect(s.rows[0]).toMatchObject({ status: 'SENT', attempts: 2, sentAt: at('2026-10-21T02:16:00Z') });
  });

  it('a resend cut off part-way stays counted as sent: it is never retried as a first send', async () => {
    const s = setup({ people: [person('ada', { prefs: onlyPending })], failures: 1 });
    s.rows.push(record({ id: 'a1', userId: 'ada', kind: 'PENDING', status: 'SENDING', attempts: 2, taskCount: 1, sentAt: at('2026-10-21T02:00:00Z'), updatedAt: at('2026-10-21T03:00:00Z') }));
    s.setNow('2026-10-21T03:20:00Z');
    await s.service.runSweep(); // the resend is tried again, and fails
    expect(s.rows[0]).toMatchObject({ status: 'SENT', attempts: 3, sentAt: at('2026-10-21T02:00:00Z'), lastError: 'HTTP 503', nextAttemptAt: null });
    s.setNow('2026-10-21T05:00:00Z');
    await s.service.runSweep();
    expect(s.sent).toEqual([]); // nothing left to retry
  });

  it('a database problem just after the email went never sends it again', async () => {
    const s = setup({ people: [person('ada', { prefs: onlyPending })] });
    s.failFinishes(1);
    await s.service.runSweep(); // sent, but writing that down failed
    expect(s.sent).toHaveLength(1);
    for (const t of ['02:05', '02:20', '02:40']) {
      s.setNow(`2026-10-21T${t}:00Z`);
      await s.service.runSweep();
    }
    expect(s.sent).toHaveLength(1);
    expect(s.rows[0]).toMatchObject({ status: 'SENT', taskCount: 1, sentAt: at('2026-10-21T02:00:00Z'), lastError: null });
  });

  it('an attempt that lost its record (taken again meanwhile) doesn’t overwrite what the other one wrote down', async () => {
    const s = setup({ people: [person('ada', { prefs: onlyPending })] });
    const slow = s.holdNextSend();
    const first = s.service.runSweep(); // 02:00: the send hangs
    await settle();
    s.setNow('2026-10-21T02:20:00Z'); // still “being sent” 20 minutes on: taken again and sent
    await s.service.runSweep();
    expect(s.rows[0]).toMatchObject({ status: 'SENT', attempts: 2, sentAt: at('2026-10-21T02:20:00Z') });
    slow.release({ fail: true }); // the first attempt finally fails
    await first;
    expect(s.rows[0]).toMatchObject({ status: 'SENT', attempts: 2, sentAt: at('2026-10-21T02:20:00Z'), nextAttemptAt: null });
  });

  it('does nothing while email isn’t set up on the server, and says so once', async () => {
    const s = setup({ configured: false });
    await s.service.runSweep();
    await s.service.runSweep();
    expect(s.rows).toEqual([]);
    expect(s.warn).toHaveBeenCalledTimes(1);
  });
});

describe('the daily email: how it looks', () => {
  it('shows the project’s picture from the server’s address, and today’s date in the person’s zone', async () => {
    const s = setup();
    await s.service.runSweep();
    expect(s.sent.map((m) => m.template)).toEqual(['daily-email']);
    expect(s.sent[0]!.html).toContain('<img src="https://api.example/uploads/projects/rig.png" alt="Rig"');
    expect(s.sent[0]!.html).toMatch(/class="email-head-note"[^>]*>Wed 21 Oct 2026</);
  });
});

describe('the daily email: "Send me a test"', () => {
  it('sends the person their daily email now, without counting as today’s', async () => {
    const s = setup();
    expect(await s.service.sendTest('ada')).toEqual({ daily: 'sent', pending: 'sent', completed: 'sent' });
    expect(s.sent.map((m) => m.template)).toEqual(['daily-email-test']);
    expect(s.rows).toEqual([]);
    await s.service.runSweep(); // today's still goes at their time
    expect(s.sent.map((m) => m.template)).toEqual(['daily-email-test', 'daily-email']);
  });

  it('with the parts they chose — and every part when they turned them all off', async () => {
    const s = setup({ people: [person('ada', { prefs: onlyPending })] });
    await s.service.sendTest('ada');
    expect(s.completedBetween).not.toHaveBeenCalled();
    expect(s.sent[0]!.html).not.toContain('Recently completed');
    const t = setup({ people: [person('ada', { prefs: bothOff })] });
    expect((await t.service.sendTest('ada')).daily).toBe('sent');
    expect(t.sent[0]!.html).toContain('Completed yesterday');
  });

  it('nothing in it: not sent, and said so', async () => {
    const s = setup({ pending: [], completed: [] });
    expect(await s.service.sendTest('ada')).toEqual({ daily: 'empty', pending: 'empty', completed: 'empty' });
    expect(s.sent).toEqual([]);
  });

  it('says the address is blocked — never sent — after a bounce or spam complaint', async () => {
    const s = setup({ blocked: ['ada@mico360.test'] });
    expect(await s.service.sendTest('ada')).toEqual({ daily: 'blocked', pending: 'blocked', completed: 'blocked' });
  });

  it('someone without an email address is told so', async () => {
    const s = setup({ people: [person('ada', { email: null })] });
    await expect(s.service.sendTest('ada')).rejects.toThrow('Your account has no email address.');
  });
});

const onlyPending = { muted: [], dailyEmails: { pending: true, completed: false, time: '06:00' } };
const ALL_OFF = { pending: false, completed: false, schedule: false, urgent: false, managed: false, glance: false, week: false, priority: false, comingUp: false, projects: false };
const bothOff = { muted: [], dailyEmails: { pending: false, completed: false, time: '06:00' } };

describe('daily task emails: when the server last checked', () => {
  it('is not known until the sweep has run, then it is the sweep’s time', async () => {
    const s = setup();
    expect(await s.service.lastCheckedAt()).toBeNull();
    s.setNow('2026-10-21T01:30:00Z');
    await s.service.runSweep();
    expect(await s.service.lastCheckedAt()).toEqual(at('2026-10-21T01:30:00Z'));
  });

  it('counts a sweep that found email not set up (it still checked)', async () => {
    const s = setup({ configured: false });
    await s.service.runSweep();
    expect(await s.service.lastCheckedAt()).toEqual(at('2026-10-21T02:00:00Z'));
  });

  it('is kept in the database: after a restart, or on another server, the overview still knows', async () => {
    const checks = checkStore();
    const before = setup({ checks });
    before.setNow('2026-10-21T01:30:00Z');
    await before.service.runSweep();
    const restarted = setup({ checks });
    restarted.setNow('2026-10-21T01:31:00Z');
    expect((await restarted.service.overview()).lastCheckedAt).toEqual(at('2026-10-21T01:30:00Z'));
  });

  it('says when the server hasn’t checked for a while although emails are due (it was asleep)', async () => {
    const checks = checkStore();
    const s = setup({ checks });
    s.setNow('2026-10-20T19:59:00Z'); // 23:59 the night before
    await s.service.runSweep();
    s.setNow('2026-10-21T01:00:00Z'); // 05:00: nothing due yet
    expect((await s.service.overview()).checkLate).toBe(false);
    s.setNow('2026-10-21T03:00:00Z'); // 07:00: Ada’s 06:00 emails haven’t gone
    expect(await s.service.overview()).toMatchObject({ lastCheckedAt: at('2026-10-20T19:59:00Z'), checkLate: true });
    await s.service.runSweep(); // it wakes and catches up
    expect((await s.service.overview()).checkLate).toBe(false);
  });

  it('not while email isn’t set up (that is said instead)', async () => {
    const s = setup({ configured: false, checks: checkStore() });
    s.setNow('2026-10-21T03:00:00Z');
    expect((await s.service.overview()).checkLate).toBe(false);
  });
});

describe('daily task emails: an administrator’s "Send today’s emails now"', () => {
  it('sends now, as today’s, the emails whose time has come and that haven’t gone — the sweep never sends them again', async () => {
    const late = { muted: [], dailyEmails: { pending: true, completed: true, time: '08:00' } };
    const s = setup({ people: [person('ada'), person('bo', { prefs: onlyPending }), person('cy', { prefs: bothOff }), person('dee', { email: null }), person('hal', { prefs: late })] });
    s.setNow('2026-10-21T03:00:00Z'); // 07:00 in Muscat: Ada’s and Bo’s 06:00 emails haven’t gone (the server was asleep)
    expect(await sendNowAll(s)).toMatchObject({ sent: 2, skipped: 0, failed: 0, retrying: 0, alreadyDone: 0, off: 1, notYet: 1 });
    expect(s.sent.map((m) => `${m.to} ${m.template}`)).toEqual(['ada@mico360.test daily-email', 'bo@mico360.test daily-email']);
    expect(s.rows.map((r) => [r.userId, r.kind, r.status, r.day])).toEqual([
      ['ada', 'PENDING', 'SENT', '2026-10-21'],
      ['bo', 'PENDING', 'SENT', '2026-10-21'],
    ]);
    await s.service.runSweep();
    expect(s.sent).toHaveLength(2);
    s.setNow('2026-10-21T04:00:00Z'); // Hal’s 08:00: the sweep sends his, at his time
    await s.service.runSweep();
    expect(s.sent.map((m) => m.to).slice(2)).toEqual(['hal@mico360.test']);
  });

  it('never ahead of a person’s time: late in the company’s evening, people further east don’t get the next day’s emails in their night', async () => {
    const s = setup({ people: [person('ada'), person('kai', { timeZone: 'Asia/Tokyo' })] });
    s.setNow('2026-10-20T19:00:00Z'); // 23:00 on 20 Oct in Muscat; 04:00 on 21 Oct in Tokyo
    expect(await sendNowAll(s)).toMatchObject({ sent: 1, notYet: 1 });
    expect(s.rows.map((r) => [r.userId, r.day])).toEqual([['ada', '2026-10-20']]);
    expect(s.sent.every((m) => m.to === 'ada@mico360.test')).toBe(true);
  });

  it('leaves what already went or had nothing in it; sends again what failed or waits for a retry', async () => {
    const s = setup({ people: [person('ada'), person('bo'), person('cy', { prefs: onlyPending })] });
    s.rows.push(
      record({ id: 'a1', userId: 'ada', kind: 'PENDING', status: 'SENT', sentAt: at('2026-10-21T02:00:00Z'), taskCount: 2 }),
      record({ id: 'a2', userId: 'ada', kind: 'COMPLETED', status: 'SKIPPED' }),
      record({ id: 'b1', userId: 'bo', kind: 'PENDING', status: 'FAILED', attempts: 4, lastError: 'HTTP 503' }),
      record({ id: 'b2', userId: 'bo', kind: 'COMPLETED', status: 'RETRY', nextAttemptAt: at('2026-10-21T02:40:00Z'), lastError: 'HTTP 503' }),
      record({ id: 'c1', userId: 'cy', kind: 'PENDING', status: 'SENDING', updatedAt: at('2026-10-21T02:29:00Z') }),
    );
    s.setNow('2026-10-21T02:30:00Z');
    // Cy’s is being sent by the sweep right now: not “already done”. The old “Completed yesterday” records are left alone.
    expect(await sendNowAll(s)).toEqual({ sent: 1, skipped: 0, blocked: 0, failed: 0, retrying: 0, alreadyDone: 1, sending: 1, off: 0, notYet: 0, errors: 0 });
    expect(s.sent.map((m) => m.to)).toEqual(['bo@mico360.test']);
    expect(s.rows).toHaveLength(5); // the same records, never a second one
    expect(s.rows.find((r) => r.id === 'b1')).toMatchObject({ status: 'SENT', attempts: 5, lastError: null });
    expect(s.rows.find((r) => r.id === 'b2')).toMatchObject({ status: 'RETRY', attempts: 1 });
    expect(s.rows.find((r) => r.id === 'a1')).toMatchObject({ status: 'SENT', attempts: 1, sentAt: at('2026-10-21T02:00:00Z') });
  });

  it('skips an email with nothing in it, and a send that fails goes on to the usual retries', async () => {
    const empty = setup({ pending: [], completed: [] });
    expect(await sendNowAll(empty)).toEqual({ sent: 0, skipped: 1, blocked: 0, failed: 0, retrying: 0, alreadyDone: 0, sending: 0, off: 0, notYet: 0, errors: 0 });
    const s = setup({ failures: 1 });
    expect(await sendNowAll(s)).toEqual({ sent: 0, skipped: 0, blocked: 0, failed: 1, retrying: 1, alreadyDone: 0, sending: 0, off: 0, notYet: 0, errors: 0 });
    expect(s.rows[0]).toMatchObject({ kind: 'PENDING', status: 'RETRY', lastError: 'HTTP 503' });
    expect(s.rows[0]!.nextAttemptAt!.toISOString()).toBe('2026-10-21T02:05:00.000Z');
    s.setNow('2026-10-21T02:05:00Z');
    await s.service.runSweep();
    expect(s.sent.map((m) => m.template)).toEqual(['daily-email']);
  });

  it('uses each person’s own calendar day', async () => {
    const s = setup({ people: [person('eve', { timeZone: 'America/New_York' })] });
    s.setNow('2026-10-21T02:30:00Z'); // 22:30 on 20 Oct in New York
    await sendNowAll(s);
    expect(s.rows.map((r) => r.day)).toEqual(['2026-10-20']);
  });

  it('starts at once and sends in the background; how far it has got is in the overview', async () => {
    const s = setup({ people: [person('ada', { prefs: onlyPending }), person('bo', { prefs: onlyPending })] });
    const slow = s.holdNextSend();
    const start = s.service.startSendNow();
    expect(start.started).toBe(true);
    expect(start.run).toMatchObject({ running: true, startedAt: at('2026-10-21T02:00:00Z'), finishedAt: null, done: 0, error: null });
    await settle();
    expect((await s.service.overview()).run).toMatchObject({ running: true, total: 2, done: 0 });
    slow.release();
    const run = await start.finished;
    expect(run).toMatchObject({ running: false, total: 2, done: 2, finishedAt: at('2026-10-21T02:00:00Z'), error: null, counts: { sent: 2 } });
    expect((await s.service.overview()).run).toMatchObject({ running: false, done: 2, counts: { sent: 2 } });
  });

  it('one run at a time: pressing again while it runs starts nothing new', async () => {
    const s = setup({ people: [person('ada', { prefs: onlyPending })] });
    const slow = s.holdNextSend();
    const first = s.service.startSendNow();
    await settle();
    const again = s.service.startSendNow();
    expect(again.started).toBe(false);
    expect(again.run.startedAt).toEqual(first.run.startedAt);
    slow.release();
    await first.finished;
    expect(s.sent).toHaveLength(1);
    expect(s.service.startSendNow().started).toBe(true); // once it has finished, a new one can start
  });

  it('a problem with one person’s emails doesn’t stop the rest; the end says how it went', async () => {
    const s = setup({ people: [person('ada', { prefs: onlyPending }), person('bo', { prefs: onlyPending }), person('cy', { prefs: onlyPending })] });
    s.failClaimsFor.add('bo');
    const finished = vi.fn();
    const run = await s.service.startSendNow({ onFinish: finished }).finished;
    expect(s.sent.map((m) => m.to)).toEqual(['ada@mico360.test', 'cy@mico360.test']);
    expect(run).toMatchObject({ running: false, total: 3, done: 3, error: null, counts: { sent: 2, errors: 1 } });
    expect(finished).toHaveBeenCalledTimes(1);
    expect(finished).toHaveBeenCalledWith(expect.objectContaining({ running: false, counts: expect.objectContaining({ sent: 2, errors: 1 }) }));
  });

  it('when the list of people can’t be read, it ends at once and says why', async () => {
    const s = setup();
    s.failList();
    const finished = vi.fn();
    const run = await s.service.startSendNow({ onFinish: finished }).finished;
    expect(run).toMatchObject({ running: false, total: null, done: 0, error: 'The database is not answering', counts: { sent: 0 } });
    expect(finished).toHaveBeenCalledTimes(1);
  });

  it('a blocked address is counted as blocked, not as sent', async () => {
    const s = setup({ people: [person('ada', { prefs: onlyPending })], blocked: ['ada@mico360.test'] });
    expect(await sendNowAll(s)).toMatchObject({ sent: 0, blocked: 1 });
  });
});

describe('daily task emails: an administrator sends one person’s emails', () => {
  it('before their time only when asked to send early: then it counts as today’s, and no one else gets anything', async () => {
    const s = setup({ people: [person('ada'), person('bo')] });
    s.setNow('2026-10-21T01:00:00Z'); // 05:00: Ada’s 06:00 hasn’t come
    const ahead = await s.service.sendFor('ada', { kind: 'PENDING' });
    expect(ahead).toMatchObject({ time: '06:00', results: [{ kind: 'PENDING', outcome: 'not-yet', error: null, sentAt: null }] });
    expect(s.sent).toEqual([]);
    expect(s.rows).toEqual([]);
    const r = await s.service.sendFor('ada', { early: true });
    expect(r).toMatchObject({ name: 'ADA', email: 'ada@mico360.test', day: '2026-10-21' });
    expect(r!.results).toEqual([{ kind: 'PENDING', outcome: 'sent', error: null, sentAt: at('2026-10-21T01:00:00Z') }]);
    expect([...new Set(s.sent.map((m) => m.to))]).toEqual(['ada@mico360.test']);
    s.setNow('2026-10-21T02:00:00Z');
    await s.service.runSweep();
    expect(s.sent.filter((m) => m.to === 'ada@mico360.test')).toHaveLength(1); // the sweep counts it as today’s
  });

  it('the old “Completed yesterday” email isn’t sent any more', async () => {
    const s = setup();
    const r = await s.service.sendFor('ada', { kind: 'COMPLETED', resend: true });
    expect(r!.results.map((x) => [x.kind, x.outcome])).toEqual([['COMPLETED', 'off']]);
    expect(s.sent).toEqual([]);
    expect(s.rows).toEqual([]);
  });

  it('doesn’t send again what already went — unless asked to resend: the same record, one more attempt, a new sent time', async () => {
    const s = setup({ people: [person('ada', { prefs: onlyPending })] });
    await s.service.runSweep(); // sent at 02:00
    s.setNow('2026-10-21T03:01:00Z');
    const once = await s.service.sendFor('ada', { kind: 'PENDING' });
    expect(once!.results).toEqual([{ kind: 'PENDING', outcome: 'already-sent', error: null, sentAt: at('2026-10-21T02:00:00Z') }]);
    expect(s.sent).toHaveLength(1);
    const again = await s.service.sendFor('ada', { kind: 'PENDING', resend: true });
    expect(again!.results).toEqual([{ kind: 'PENDING', outcome: 'sent', error: null, sentAt: at('2026-10-21T03:01:00Z') }]);
    expect(s.sent).toHaveLength(2);
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0]).toMatchObject({ status: 'SENT', attempts: 2, sentAt: at('2026-10-21T03:01:00Z') });
  });

  it('never sends the email to someone who turned it off, even when asked to resend', async () => {
    const s = setup({ people: [person('ada', { prefs: bothOff })] });
    const r = await s.service.sendFor('ada', { kind: 'PENDING', resend: true });
    expect(r!.results).toEqual([{ kind: 'PENDING', outcome: 'off', error: null, sentAt: null }]);
    const all = await s.service.sendFor('ada');
    expect(all!.results.map((x) => [x.kind, x.outcome])).toEqual([['PENDING', 'off']]);
    expect(s.sent).toEqual([]);
    expect(s.rows).toEqual([]);
  });

  it('a resend that fails, or finds nothing to send now, still counts the email as sent', async () => {
    const s = setup({ people: [person('ada', { prefs: onlyPending })] });
    await s.service.runSweep();
    s.setNow('2026-10-21T03:00:00Z');
    s.setFailures(1);
    const failed = await s.service.sendFor('ada', { kind: 'PENDING', resend: true });
    expect(failed!.results).toEqual([{ kind: 'PENDING', outcome: 'failed', error: 'HTTP 503', sentAt: at('2026-10-21T02:00:00Z') }]);
    expect(s.rows[0]).toMatchObject({ status: 'SENT', attempts: 2, sentAt: at('2026-10-21T02:00:00Z'), lastError: 'HTTP 503', nextAttemptAt: null });
    s.setTasks({ pending: [] });
    const empty = await s.service.sendFor('ada', { kind: 'PENDING', resend: true });
    expect(empty!.results.map((x) => x.outcome)).toEqual(['empty']);
    expect(s.rows[0]).toMatchObject({ status: 'SENT', attempts: 3, sentAt: at('2026-10-21T02:00:00Z') });
    s.setNow('2026-10-21T05:00:00Z');
    await s.service.runSweep();
    expect(s.sent).toHaveLength(1); // nothing left for the sweep to retry
  });

  it('tries again one that had nothing in it earlier — there may be something now', async () => {
    const s = setup({ pending: [], completed: [] });
    await s.service.runSweep();
    expect(s.rows[0]).toMatchObject({ status: 'SKIPPED' });
    s.setTasks({ pending: [task('RIG-9')] });
    const r = await s.service.sendFor('ada', { kind: 'PENDING' });
    expect(r!.results.map((x) => x.outcome)).toEqual(['sent']);
    expect(s.rows[0]).toMatchObject({ status: 'SENT', taskCount: 1, attempts: 2 });
  });

  it('pressing Send again and again while email is down doesn’t use up the automatic retries', async () => {
    const s = setup({ people: [person('ada', { prefs: onlyPending })], failures: 99 });
    await s.service.runSweep(); // 02:00: fails, tried again at 02:05
    s.setNow('2026-10-21T02:01:00Z');
    for (let i = 0; i < 3; i++) {
      const r = await s.service.sendFor('ada', { kind: 'PENDING' });
      expect(r!.results[0]).toMatchObject({ outcome: 'retry', error: 'HTTP 503' });
    }
    expect(s.rows[0]).toMatchObject({ status: 'RETRY', attempts: 1, lastError: 'HTTP 503' });
    expect(s.rows[0]!.nextAttemptAt!.toISOString()).toBe('2026-10-21T02:05:00.000Z');
    // The sweep still makes its three retries before it gives up.
    for (const t of ['02:05', '02:20']) {
      s.setNow(`2026-10-21T${t}:00Z`);
      await s.service.runSweep();
      expect(s.rows[0]!.status).toBe('RETRY');
    }
    s.setNow('2026-10-21T03:05:00Z');
    await s.service.runSweep();
    expect(s.rows[0]).toMatchObject({ status: 'FAILED', attempts: 4 });
  });

  it('a send that fails goes on to the usual retries', async () => {
    const s = setup({ people: [person('ada', { prefs: onlyPending })], failures: 1 });
    const r = await s.service.sendFor('ada');
    expect(r!.results).toEqual([{ kind: 'PENDING', outcome: 'retry', error: 'HTTP 503', sentAt: null }]);
    expect(s.rows[0]).toMatchObject({ status: 'RETRY' });
  });

  it('is null for someone who isn’t an active person with an email address', async () => {
    const s = setup({ people: [person('ada', { email: null })] });
    expect(await s.service.sendFor('ada')).toBeNull();
    expect(await s.service.sendFor('nobody')).toBeNull();
  });
});

describe('daily task emails: "Preview my email"', () => {
  it('the person’s own email as it would be sent now — subject, HTML and plain text — sends nothing and records nothing', async () => {
    const s = setup({ pending: [task('RIG-1', { title: 'Check the pump' })] });
    const p = await s.service.previewOwn('ada');
    expect(p).toMatchObject({ subject: 'Today: 1 open task — Wed 21 Oct', empty: false });
    expect(p!.html).toContain('Check the pump');
    expect(p!.text).toContain('- RIG-1 Check the pump');
    expect(s.sent).toEqual([]);
    expect(s.rows).toEqual([]);
  });

  it('every part when they turned them all off (as "Send me a test"); works without an email address or email set up', async () => {
    const s = setup({ people: [person('ada', { email: null, prefs: { muted: [], dailyEmails: { ...ALL_OFF, time: '06:00' } } })], configured: false });
    const p = await s.service.previewOwn('ada');
    expect(p!.empty).toBe(false);
    expect(p!.html).toContain('Completed yesterday');
  });

  it('reads only that person\u2019s own tasks, meetings, projects and figures — never anyone else\u2019s', async () => {
    const s = setup({ people: [person('ada'), person('bo')] });
    await s.service.previewOwn('bo');
    const asked = [s.pending, s.completedBetween, s.meetingsBetween, s.managed, s.weekFigures, s.projectFigures].flatMap((fn) => fn.mock.calls.map((c) => c[0]));
    expect(asked.length).toBeGreaterThan(3);
    expect(new Set(asked)).toEqual(new Set(['bo']));
  });

  it('nothing in it: empty; not an active person: null', async () => {
    const s = setup({ pending: [], completed: [] });
    expect(await s.service.previewOwn('ada')).toEqual({ subject: null, html: null, text: null, empty: true });
    expect(await s.service.previewOwn('nobody')).toBeNull();
  });
});

describe('daily task emails: an administrator’s preview', () => {
  it('builds the email as it would be sent now — the subject and the plain text — and sends nothing', async () => {
    const s = setup({ pending: [task('RIG-1', { title: 'Check the <b>pump</b>' })] });
    const p = await s.service.preview('ada', 'PENDING');
    expect(p).toMatchObject({ name: 'ADA', email: 'ada@mico360.test', kind: 'PENDING', day: '2026-10-21', subject: 'Today: 1 open task — Wed 21 Oct', taskCount: 1, empty: false, on: true });
    expect(p!.text).toContain('RIG — RIG · 1 task'); // the task's project heads its group in Other open tasks
    expect(p!.text).toContain('- RIG-1 Check the <b>pump</b>');
    expect(p).not.toHaveProperty('html');
    expect(s.sent).toEqual([]);
    expect(s.rows).toEqual([]);
  });

  it('says when there is nothing to send', async () => {
    const s = setup({ completed: [], people: [person('ada', { prefs: onlyPending })] });
    expect(await s.service.preview('ada', 'COMPLETED')).toMatchObject({ subject: null, text: null, taskCount: 0, empty: true, on: false });
    const t = setup({ pending: [], completed: [] });
    expect(await t.service.preview('ada', 'PENDING')).toMatchObject({ subject: null, text: null, taskCount: 0, empty: true, on: true });
  });

  it('is null for someone who isn’t an active person with an email address', async () => {
    const s = setup();
    expect(await s.service.preview('nobody', 'PENDING')).toBeNull();
  });
});

describe('daily task emails: the administrators’ overview of a day', () => {
  function day() {
    const s = setup({
      completed: [],
      people: [
        person('gus', { prefs: onlyPending }),
        person('ada'),
        person('bo', { prefs: { muted: [], dailyEmails: { pending: true, completed: true, time: '07:30' } } }),
        person('cy', { prefs: bothOff }),
        person('dee', { email: null }),
        person('fay', { prefs: onlyPending }),
      ],
    });
    return s;
  }

  it('one row per person with an address: their time, time zone and each email’s state today; and the day’s numbers', async () => {
    const s = day();
    await s.service.runSweep(); // 06:00: Ada’s email goes; Fay’s and Gus’s are replaced below
    s.rows.splice(0, s.rows.length, ...s.rows.filter((r) => r.userId === 'ada'));
    s.rows.push(
      record({ id: 'f1', userId: 'fay', kind: 'PENDING', status: 'FAILED', attempts: 4, lastError: 'HTTP 503' }),
      record({ id: 'g1', userId: 'gus', kind: 'PENDING', status: 'RETRY', attempts: 2, nextAttemptAt: at('2026-10-21T02:50:00Z'), lastError: 'Timed out' }),
    );
    s.setNow('2026-10-21T02:30:00Z');
    const o = await s.service.overview();
    expect(o.day).toBeNull();
    expect(o.lastCheckedAt?.toISOString()).toBe('2026-10-21T02:00:00.000Z');
    expect(o.nextSendAt?.toISOString()).toBe('2026-10-21T02:50:00.000Z'); // Gus’s retry, before Bo’s 07:30
    expect(o.people.map((p) => p.name)).toEqual(['ADA', 'BO', 'CY', 'FAY', 'GUS']);
    const [ada, bo, cy, fay, gus] = o.people;
    expect(ada).toMatchObject({ userId: 'ada', email: 'ada@mico360.test', timeZone: TZ, ownTimeZone: false, time: '06:00', day: '2026-10-21', today: '2026-10-21', due: true, account: 'active' });
    expect(bo).toMatchObject({ today: '2026-10-21', due: false });
    expect(ada!.pending).toMatchObject({ on: true, state: 'SENT', sentAt: at('2026-10-21T02:00:00Z'), taskCount: 1, attempts: 1 });
    expect(ada!.completed).toMatchObject({ on: false, state: 'OFF' }); // the old email: no longer sent
    expect(bo!.pending).toMatchObject({ on: true, state: 'DUE', dueAt: at('2026-10-21T03:30:00Z') });
    expect(cy!.pending).toMatchObject({ on: false, state: 'OFF' });
    expect(fay!.pending).toMatchObject({ state: 'FAILED', attempts: 4, lastError: 'HTTP 503' });
    expect(fay!.completed).toMatchObject({ on: false, state: 'OFF' });
    expect(gus!.pending).toMatchObject({ state: 'RETRY', nextAttemptAt: at('2026-10-21T02:50:00Z'), lastError: 'Timed out' });
    // Send now: Fay’s and Gus’s (their time has come); Bo’s 07:30 hasn’t.
    expect(o.summary).toEqual({ people: 4, sent: 1, skipped: 0, failed: 1, retrying: 1, sending: 0, late: 0, upcoming: 1, toSend: 2 });
  });

  it('each person’s own calendar day and time zone', async () => {
    const s = setup({ people: [person('eve', { timeZone: 'America/New_York' })] });
    s.setNow('2026-10-21T02:30:00Z'); // 22:30 on 20 Oct in New York: her 06:00 has passed, nothing sent yet
    const [eve] = (await s.service.overview()).people;
    expect(eve).toMatchObject({ timeZone: 'America/New_York', ownTimeZone: true, day: '2026-10-20' });
    expect(eve!.pending).toMatchObject({ state: 'LATE', dueAt: at('2026-10-20T10:00:00Z') });
  });

  it('late (due, not sent yet) apart from still to come; someone whose first emails are tomorrow isn’t still to come today', async () => {
    const s = setup({
      people: [person('ada'), person('bo', { prefs: { muted: [], dailyEmails: { pending: true, completed: true, time: '07:30' } } }), person('new', { createdAt: at('2026-10-21T02:30:00Z') })],
    });
    s.setNow('2026-10-21T03:00:00Z'); // 07:00
    const o = await s.service.overview();
    const [ada, bo, nu] = o.people;
    expect(ada!.pending).toMatchObject({ state: 'LATE', dueAt: at('2026-10-21T02:00:00Z') });
    expect(bo!.pending).toMatchObject({ state: 'DUE', dueAt: at('2026-10-21T03:30:00Z') });
    expect(nu!.pending).toMatchObject({ state: 'DUE', dueAt: at('2026-10-22T02:00:00Z') });
    expect(nu).toMatchObject({ due: false });
    expect(o.summary).toMatchObject({ late: 1, upcoming: 1, toSend: 1 });
    expect(o.nextSendAt).toEqual(at('2026-10-21T02:00:00Z')); // Ada’s: due now
  });

  it('a clock-change day: 06:00 is 06:00 by the clocks that morning', async () => {
    const s = setup({ people: [person('lin', { timeZone: 'Europe/London' })] });
    s.setNow('2026-10-25T04:00:00Z'); // the clocks went back at 02:00 BST: 06:00 GMT is 06:00Z
    expect((await s.service.overview()).people[0]!.pending).toMatchObject({ state: 'DUE', dueAt: at('2026-10-25T06:00:00Z') });
    s.setNow('2026-10-25T05:30:00Z'); // 05:30 there
    await s.service.runSweep();
    expect(s.sent).toEqual([]);
    s.setNow('2026-10-25T06:00:00Z');
    await s.service.runSweep();
    expect(s.sent).toHaveLength(1);
  });

  it('an old “Completed yesterday” record of a day stays visible', async () => {
    const s = setup({ people: [person('ada')] });
    s.rows.push(record({ id: 'c0', userId: 'ada', day: '2026-10-20', kind: 'COMPLETED', status: 'SENT', sentAt: at('2026-10-20T02:00:00Z'), taskCount: 2 }));
    const past = await s.service.overview('2026-10-20');
    expect(past.people[0]!.completed).toMatchObject({ on: false, state: 'SENT', taskCount: 2 });
    expect(past.summary).toMatchObject({ sent: 1 });
  });

  it('records of people no longer active (or with no address now) stay visible, marked so', async () => {
    const s = setup({ people: [person('ada'), person('ned', { email: null })] });
    s.rows.push(
      record({ id: 'z1', userId: 'zed', kind: 'PENDING', status: 'SENT', sentAt: at('2026-10-21T02:00:00Z'), taskCount: 2 }),
      record({ id: 'n1', userId: 'ned', kind: 'COMPLETED', status: 'SKIPPED' }),
      record({ id: 'z0', userId: 'zed', day: '2026-10-20', kind: 'PENDING', status: 'FAILED', attempts: 4 }),
    );
    s.setNow('2026-10-21T02:30:00Z');
    const o = await s.service.overview();
    expect(o.people.map((p) => [p.name, p.account])).toEqual([['ADA', 'active'], ['NED', 'no-email'], ['ZED', 'inactive']]);
    const zed = o.people[2]!;
    expect(zed).toMatchObject({ userId: 'zed', email: 'zed@mico360.test', day: '2026-10-21', due: false });
    expect(zed.pending).toMatchObject({ state: 'SENT', taskCount: 2 });
    expect(zed.completed).toMatchObject({ state: 'NONE' });
    expect(o.summary).toMatchObject({ people: 1, sent: 1, skipped: 1, toSend: 1 }); // what happened counts; “people” and Send now don’t
    const past = await s.service.overview('2026-10-20');
    expect(past.people.find((p) => p.userId === 'zed')!.pending).toMatchObject({ state: 'FAILED' });
  });

  it('each person’s username too, so the administrators can find people by it', async () => {
    const s = setup({ people: [person('ada', { username: 'ada.l' }), person('ned', { username: 'ned.n', email: null })] });
    s.rows.push(
      record({ id: 'z1', userId: 'zed', kind: 'PENDING', status: 'SENT', sentAt: at('2026-10-21T02:00:00Z'), taskCount: 2 }),
      record({ id: 'n1', userId: 'ned', kind: 'COMPLETED', status: 'SKIPPED' }),
    );
    s.setNow('2026-10-21T02:30:00Z');
    const o = await s.service.overview();
    // Someone no longer active: the username their records were sent under.
    expect(o.people.map((p) => [p.name, p.username])).toEqual([['ADA', 'ada.l'], ['NED', 'ned.n'], ['ZED', 'zed']]);
  });

  it('someone who joined after today’s time: their first emails come tomorrow', async () => {
    const s = setup({ people: [person('new', { createdAt: at('2026-10-21T04:00:00Z') })] });
    s.setNow('2026-10-21T05:00:00Z');
    const o = await s.service.overview();
    expect(o.people[0]!.pending).toMatchObject({ state: 'DUE', dueAt: at('2026-10-22T02:00:00Z') });
    expect(o.nextSendAt?.toISOString()).toBe('2026-10-22T02:00:00.000Z');
  });

  it('another day: what happened then (nothing recorded shows as none), or what is still to come', async () => {
    const s = setup({ people: [person('ada'), person('bo')] });
    s.rows.push(record({ id: 'old', userId: 'ada', day: '2026-10-20', kind: 'PENDING', status: 'SENT', sentAt: at('2026-10-20T02:00:00Z'), taskCount: 3 }));
    const past = await s.service.overview('2026-10-20');
    expect(past.day).toBe('2026-10-20');
    expect(past.people[0]).toMatchObject({ day: '2026-10-20' });
    expect(past.people[0]!.pending).toMatchObject({ state: 'SENT', taskCount: 3 });
    expect(past.people[0]!.completed).toMatchObject({ state: 'OFF' });
    expect(past.summary).toMatchObject({ sent: 1, upcoming: 0, toSend: 2 }); // Send now is always about today
    const next = await s.service.overview('2026-10-22');
    expect(next.people[1]!.pending).toMatchObject({ state: 'DUE', dueAt: at('2026-10-22T02:00:00Z') });
  });
});

describe('one daily email per person, grouped by company, with their company’s brand (companies, MC1 Task 16)', () => {
  const ALPHA = { id: 'c-a', name: 'Alpha LLC' };
  const BETA = { id: 'c-b', name: 'Beta LLC' };
  const inA: DailyTask['project'] = { ...RIG, id: 'p-a', company: ALPHA };
  const inB: DailyTask['project'] = { ...RIG, id: 'p-b', code: 'BRG', name: 'Beta Rig', company: BETA };
  function branded(pendingTasks: DailyTask[], brand?: { brand: { companyName: string }; fromName?: string }) {
    const sent: Array<{ to: string; content: EmailContent; template: string; opts?: { fromName?: string } }> = [];
    const brandOf = vi.fn(async () => brand);
    const service = createDailyEmailService({
      repo: memoryRepo(() => at('2026-10-21T02:00:00Z')).repo,
      people: { list: async () => [person('cat')], find: async (id) => (id === 'cat' ? person('cat') : null) },
      tasks: { pending: async () => pendingTasks, completedBetween: async () => [] },
      send: async (to, content, template, opts) => {
        sent.push({ to, content, template, opts });
        return 'sent';
      },
      isConfigured: () => true,
      companyTimeZone: TZ,
      appUrl: 'https://task.example',
      now: () => at('2026-10-21T02:00:00Z'),
      emailOptions: brandOf,
    });
    return { service, sent, brandOf };
  }

  it('tasks in two companies: ONE email, a section per company, its primary company’s name and sender', async () => {
    const t = branded([task('BRG-1', { project: inB }), task('RIG-1', { project: inA })], { brand: { companyName: 'Beta LLC' }, fromName: 'Beta Team' });
    await t.service.runSweep();
    expect(t.sent).toHaveLength(1);
    const { content, opts } = t.sent[0]!;
    expect(content.html.indexOf('>Alpha LLC</div>')).toBeGreaterThan(-1);
    expect(content.html.indexOf('>Alpha LLC</div>')).toBeLessThan(content.html.indexOf('>Beta LLC</div>'));
    expect(content.html).toContain('© 2026 Beta LLC');
    expect(opts).toEqual({ fromName: 'Beta Team' });
    expect(t.brandOf).toHaveBeenCalledWith('cat');
  });

  it('tasks in one company: no headings, and without a brand nothing about the sender changes', async () => {
    const t = branded([task('RIG-1', { project: inA }), task('RIG-2', { project: inA })]);
    await t.service.runSweep();
    expect(t.sent[0]!.content.html).not.toContain('Alpha LLC');
    expect(t.sent[0]!.opts).toBeUndefined();
  });
});

describe('Notification & Scheduling centre: working days only, held notices folded in, working days late', () => {
  const MORNING = at('2026-10-21T02:00:00Z'); // Wednesday 06:00 in Muscat
  function centre(o: { working?: boolean; held?: { id: string; title: string; body: string | null }[]; pending?: DailyTask[]; fail?: boolean } = {}) {
    const { repo, rows } = memoryRepo(() => clock);
    let clock = MORNING;
    const sent: Array<{ html: string; text: string; subject: string }> = [];
    const folded = vi.fn(async (_ids: string[], _at: Date) => {});
    const release = vi.fn(async (_ids: string[]) => {});
    const service = createDailyEmailService({
      repo,
      people: { list: async () => [person('ada')], find: async (id) => (id === 'ada' ? person('ada') : null) },
      tasks: { pending: async () => o.pending ?? [task('RIG-1')], completedBetween: async () => [] },
      send: async (_to, content) => {
        if (o.fail) throw new Error('HTTP 503');
        sent.push({ html: content.html, text: content.text, subject: content.subject });
        return 'sent';
      },
      isConfigured: () => true,
      companyTimeZone: TZ,
      appUrl: 'https://task.example',
      now: () => clock,
      workingDay: async () => o.working ?? true,
      lateDays: () => 3,
      held: { take: async () => o.held ?? [], peek: async () => o.held ?? [], folded, release },
    });
    return { service, rows, sent, folded, release, setNow: (iso: string) => (clock = at(iso)) };
  }

  it('no daily email on a day off: recorded as skipped, saying why', async () => {
    const c = centre({ working: false });
    await c.service.runSweep();
    expect(c.sent).toEqual([]);
    expect([...c.rows.values()][0]).toMatchObject({ status: 'SKIPPED', lastError: NOT_A_WORKING_DAY });
    expect(await c.service.pendingToday('ada', MORNING)).toBe(false);
  });

  it('the notices held overnight fold into the morning’s email (then marked folded); one email, not two', async () => {
    const c = centre({ held: [{ id: 'h1', title: 'A task is 1 working day overdue', body: 'RIG-9 · Pour slab' }, { id: 'h2', title: 'Escalation: RIG-7 is Blocked', body: null }] });
    c.setNow('2026-10-21T01:30:00Z'); // 05:30: before the email's time
    expect(await c.service.pendingToday('ada')).toBe(true);
    c.setNow('2026-10-21T02:00:00Z');
    await c.service.runSweep();
    expect(c.sent).toHaveLength(1);
    expect(c.sent[0]!.text).toContain('While you were away (2)');
    expect(c.sent[0]!.text).toContain('- A task is 1 working day overdue — RIG-9 · Pour slab');
    expect(c.folded).toHaveBeenCalledWith(['h1', 'h2'], expect.any(Date));
    // Gone: nothing else waits for it today.
    expect(await c.service.pendingToday('ada')).toBe(false);
  });

  it('review M8: an email that didn’t go lets its held notices go again (sent later, never lost)', async () => {
    const c = centre({ held: [{ id: 'h1', title: 'A task is overdue', body: null }], fail: true });
    await c.service.runSweep();
    expect(c.folded).not.toHaveBeenCalled();
    expect(c.release).toHaveBeenCalledWith(['h1']);
  });

  it('held notices alone are enough for an email', async () => {
    const c = centre({ pending: [], held: [{ id: 'h1', title: 'No activity on RIG-3 for 5 working days', body: 'RIG-3 · Wire panel' }] });
    await c.service.runSweep();
    expect(c.sent).toHaveLength(1);
  });

  // Release B on Release A's daily email: a row's day says "N days late" — in working days with the centre.
  it('overdue counts working days', async () => {
    const c = centre({ pending: [task('RIG-1', { dueDate: at('2026-10-15T00:00:00Z') })] });
    await c.service.runSweep();
    expect(c.sent[0]!.text).toContain('3 working days late');
    expect(c.sent[0]!.text).not.toContain(' 6 days late');
  });

  it('a task finished after its due day, but with no working day between (a day off), is on time', async () => {
    const t = task('RIG-2', { dueDate: at('2026-10-15T00:00:00Z'), completedAt: at('2026-10-16T08:00:00Z') });
    const { repo } = memoryRepo(() => MORNING);
    const sent: string[] = [];
    const service = createDailyEmailService({
      repo,
      people: { list: async () => [person('ada')], find: async (id) => (id === 'ada' ? person('ada') : null) },
      tasks: { pending: async () => [], completedBetween: async () => [t] },
      send: async (_to, content) => {
        sent.push(content.text);
        return 'sent';
      },
      isConfigured: () => true,
      companyTimeZone: TZ,
      appUrl: 'https://task.example',
      now: () => MORNING,
      lateDays: () => 0,
    });
    await service.runSweep();
    expect(sent[0]).toContain('On time');
    expect(sent[0]).not.toContain('late');
  });
});
