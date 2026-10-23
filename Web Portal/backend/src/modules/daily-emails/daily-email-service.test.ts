import { describe, it, expect, vi } from 'vitest';
import { createDailyEmailService, type DailyRecipient } from './daily-email-service';
import type { DailyEmailRecord, DailyEmailRepository } from './daily-email-repository';
import type { DailyTask } from './daily-email-content';
import type { EmailContent } from '../email/email-templates';

/** The delivery records in memory, with the same once-only rules as the database. */
function memoryRepo(clock: () => Date = () => new Date()) {
  const rows: DailyEmailRecord[] = [];
  let seq = 0;
  let failFinishes = 0;
  const repo: DailyEmailRepository = {
    async claim(userId, day, kind) {
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
      return rows.filter((r) => days.includes(r.day)).map((r) => ({ ...r }));
    },
  };
  return { repo, rows, failFinishes: (n: number) => { failFinishes = n; } };
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
  email: `${id}@mico360.test`,
  timeZone: null,
  prefs: { muted: [] },
  createdAt: at('2026-01-01T00:00:00Z'),
  ...extra,
});
const task = (key: string, extra: Partial<DailyTask> = {}): DailyTask => ({
  id: key, key, title: key, projectName: 'Rig', priority: 'NORMAL', dueDate: null, statusLabel: 'To Do', completedAt: null, ...extra,
});

/** When the sweep last ran, kept like the database keeps it: shared by every server (and a restart). */
function checkStore() {
  let last: Date | null = null;
  return { record: async (at: Date) => { last = at; }, last: async () => last };
}

function setup(opts: { people?: DailyRecipient[]; pending?: DailyTask[]; completed?: DailyTask[]; configured?: boolean; failures?: number; blocked?: string[]; checks?: ReturnType<typeof checkStore> } = {}) {
  let now = at('2026-10-21T02:00:00Z'); // 06:00 in Muscat
  const { repo, rows, failFinishes } = memoryRepo(() => now);
  let failures = opts.failures ?? 0;
  // The next send waits until the test lets it go (a slow provider), then goes through or fails.
  let held: { wait: Promise<void>; fail: boolean } | null = null;
  const sent: Array<{ to: string; subject: string; template: string }> = [];
  const people = opts.people ?? [person('ada')];
  let pendingTasks = opts.pending ?? [task('RIG-1')];
  let completedTasks = opts.completed ?? [task('RIG-2', { completedAt: at('2026-10-20T08:00:00Z') })];
  const pending = vi.fn(async () => pendingTasks);
  const completedBetween = vi.fn(async (_u: string, _from: Date, _to: Date) => completedTasks);
  const warn = vi.fn();
  const service = createDailyEmailService({
    repo,
    people: { list: async () => people, find: async (id) => people.find((p) => p.id === id) ?? null },
    tasks: { pending, completedBetween },
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
      sent.push({ to, subject: content.subject, template });
      return 'sent' as const;
    },
    isConfigured: () => opts.configured ?? true,
    companyTimeZone: TZ,
    appUrl: 'https://task.example',
    now: () => now,
    logger: { info: vi.fn(), warn },
    ...(opts.checks ? { checks: opts.checks } : {}),
  });
  return {
    service, rows, sent, pending, completedBetween, warn, people,
    setNow: (iso: string) => { now = at(iso); },
    setFailures: (n: number) => { failures = n; },
    failFinishes,
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

describe('daily task emails: the morning sweep', () => {
  it('sends both emails at 06:00 in the person’s time zone, not before', async () => {
    const s = setup();
    s.setNow('2026-10-21T01:59:00Z'); // 05:59
    await s.service.runSweep();
    expect(s.sent).toEqual([]);
    s.setNow('2026-10-21T02:00:00Z');
    await s.service.runSweep();
    expect(s.sent.map((m) => m.template).sort()).toEqual(['daily-completed', 'daily-pending']);
    expect(s.sent.every((m) => m.to === 'ada@mico360.test')).toBe(true);
    expect(s.rows.map((r) => [r.kind, r.status, r.day, r.taskCount])).toEqual([
      ['PENDING', 'SENT', '2026-10-21', 1],
      ['COMPLETED', 'SENT', '2026-10-21', 1],
    ]);
  });

  it('sends each email only once a day, however often it runs', async () => {
    const s = setup();
    for (const t of ['02:00', '02:01', '05:00', '19:59']) {
      s.setNow(`2026-10-21T${t}:00Z`);
      await s.service.runSweep();
    }
    expect(s.sent).toHaveLength(2);
    s.setNow('2026-10-22T02:00:00Z'); // the next morning
    await s.service.runSweep();
    expect(s.sent).toHaveLength(4);
  });

  it('builds them from the person’s own tasks: pending now, and completed during their yesterday', async () => {
    const s = setup();
    await s.service.runSweep();
    expect(s.pending).toHaveBeenCalledWith('ada');
    const [userId, from, to] = s.completedBetween.mock.calls[0]!;
    expect(userId).toBe('ada');
    expect(from.toISOString()).toBe('2026-10-19T20:00:00.000Z'); // 20 Oct 00:00 in Muscat
    expect(to.toISOString()).toBe('2026-10-20T20:00:00.000Z'); // 21 Oct 00:00 in Muscat
  });

  it('skips an email with nothing in it, and records that', async () => {
    const s = setup({ completed: [] });
    await s.service.runSweep();
    expect(s.sent.map((m) => m.template)).toEqual(['daily-pending']);
    expect(s.rows.find((r) => r.kind === 'COMPLETED')).toMatchObject({ status: 'SKIPPED', taskCount: 0 });
  });

  it('follows each person’s settings: an email turned off, a later time', async () => {
    const s = setup({ people: [person('ada', { prefs: { muted: [], dailyEmails: { pending: true, completed: false, time: '07:30' } } })] });
    s.setNow('2026-10-21T03:29:00Z'); // 07:29
    await s.service.runSweep();
    expect(s.sent).toEqual([]);
    s.setNow('2026-10-21T03:30:00Z');
    await s.service.runSweep();
    expect(s.sent.map((m) => m.template)).toEqual(['daily-pending']);
    expect(s.rows.map((r) => r.kind)).toEqual(['PENDING']);
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
    expect(s.sent).toHaveLength(2);
  });

  it('starts the morning after for someone who joined after their time today', async () => {
    const s = setup({ people: [person('new', { createdAt: at('2026-10-21T04:00:00Z') })] }); // joined 08:00
    s.setNow('2026-10-21T05:00:00Z');
    await s.service.runSweep();
    expect(s.sent).toEqual([]);
    s.setNow('2026-10-22T02:00:00Z');
    await s.service.runSweep();
    expect(s.sent).toHaveLength(2);
  });

  it('an address blocked after a bounce or spam complaint is recorded as skipped, with why — never as sent', async () => {
    const s = setup({ blocked: ['ada@mico360.test'] });
    await s.service.runSweep();
    expect(s.sent).toEqual([]);
    expect(s.rows.map((r) => [r.kind, r.status, r.sentAt, r.lastError])).toEqual([
      ['PENDING', 'SKIPPED', null, 'Address blocked after a bounce or spam complaint.'],
      ['COMPLETED', 'SKIPPED', null, 'Address blocked after a bounce or spam complaint.'],
    ]);
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

  it('drops a retry when the person has turned that email off since', async () => {
    const s = setup({ failures: 1, completed: [] });
    await s.service.runSweep();
    s.people[0]!.prefs = { muted: [], dailyEmails: { pending: false, completed: true, time: '06:00' } };
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
    expect(s.sent.map((m) => m.template)).toEqual(['daily-pending']);
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

describe('daily task emails: "Send me a test now"', () => {
  it('sends the person both emails now, whatever their settings, without counting as today’s', async () => {
    const s = setup({ people: [person('ada', { prefs: { muted: [], dailyEmails: { pending: false, completed: false, time: '06:00' } } })] });
    expect(await s.service.sendTest('ada')).toEqual({ pending: 'sent', completed: 'sent' });
    expect(s.sent.map((m) => m.template)).toEqual(['daily-pending-test', 'daily-completed-test']);
    expect(s.rows).toEqual([]);
  });

  it('says which one had nothing to send', async () => {
    const s = setup({ completed: [] });
    expect(await s.service.sendTest('ada')).toEqual({ pending: 'sent', completed: 'empty' });
  });
});

const onlyPending = { muted: [], dailyEmails: { pending: true, completed: false, time: '06:00' } };
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
  it('sends today’s emails to everyone now, before their time, as today’s — the sweep never sends them again', async () => {
    const s = setup({ people: [person('ada'), person('bo', { prefs: onlyPending }), person('cy', { prefs: bothOff }), person('dee', { email: null })] });
    s.setNow('2026-10-21T01:00:00Z'); // 05:00 in Muscat, before everyone’s 06:00
    expect(await s.service.sendNow()).toEqual({ sent: 3, skipped: 0, failed: 0, retrying: 0, alreadyDone: 0, off: 3 });
    expect(s.sent.map((m) => `${m.to} ${m.template}`)).toEqual([
      'ada@mico360.test daily-pending',
      'ada@mico360.test daily-completed',
      'bo@mico360.test daily-pending',
    ]);
    expect(s.rows.map((r) => [r.userId, r.kind, r.status, r.day])).toEqual([
      ['ada', 'PENDING', 'SENT', '2026-10-21'],
      ['ada', 'COMPLETED', 'SENT', '2026-10-21'],
      ['bo', 'PENDING', 'SENT', '2026-10-21'],
    ]);
    s.setNow('2026-10-21T02:00:00Z');
    await s.service.runSweep();
    expect(s.sent).toHaveLength(3);
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
    expect(await s.service.sendNow()).toEqual({ sent: 2, skipped: 0, failed: 0, retrying: 0, alreadyDone: 3, off: 1 });
    expect(s.sent.map((m) => m.to)).toEqual(['bo@mico360.test', 'bo@mico360.test']);
    expect(s.rows).toHaveLength(5); // the same records, never a second one
    expect(s.rows.find((r) => r.id === 'b1')).toMatchObject({ status: 'SENT', attempts: 5, lastError: null });
    expect(s.rows.find((r) => r.id === 'b2')).toMatchObject({ status: 'SENT', attempts: 2, nextAttemptAt: null });
    expect(s.rows.find((r) => r.id === 'a1')).toMatchObject({ status: 'SENT', attempts: 1, sentAt: at('2026-10-21T02:00:00Z') });
  });

  it('skips an email with nothing in it, and a send that fails goes on to the usual retries', async () => {
    const s = setup({ completed: [], failures: 1 });
    expect(await s.service.sendNow()).toEqual({ sent: 0, skipped: 1, failed: 1, retrying: 1, alreadyDone: 0, off: 0 });
    expect(s.rows.find((r) => r.kind === 'PENDING')).toMatchObject({ status: 'RETRY', lastError: 'HTTP 503' });
    expect(s.rows.find((r) => r.kind === 'PENDING')!.nextAttemptAt!.toISOString()).toBe('2026-10-21T02:05:00.000Z');
    s.setNow('2026-10-21T02:05:00Z');
    await s.service.runSweep();
    expect(s.sent.map((m) => m.template)).toEqual(['daily-pending']);
  });

  it('uses each person’s own calendar day', async () => {
    const s = setup({ people: [person('eve', { timeZone: 'America/New_York' })] });
    s.setNow('2026-10-21T02:30:00Z'); // 22:30 on 20 Oct in New York
    await s.service.sendNow();
    expect(s.rows.map((r) => r.day)).toEqual(['2026-10-20', '2026-10-20']);
  });
});

describe('daily task emails: an administrator sends one person’s emails', () => {
  it('sends that person’s emails for today now, and no one else’s', async () => {
    const s = setup({ people: [person('ada'), person('bo')] });
    s.setNow('2026-10-21T01:00:00Z');
    const r = await s.service.sendFor('ada');
    expect(r).toMatchObject({ name: 'ADA', email: 'ada@mico360.test', day: '2026-10-21' });
    expect(r!.results).toEqual([
      { kind: 'PENDING', outcome: 'sent', error: null, sentAt: at('2026-10-21T01:00:00Z') },
      { kind: 'COMPLETED', outcome: 'sent', error: null, sentAt: at('2026-10-21T01:00:00Z') },
    ]);
    expect([...new Set(s.sent.map((m) => m.to))]).toEqual(['ada@mico360.test']);
    s.setNow('2026-10-21T02:00:00Z');
    await s.service.runSweep();
    expect(s.sent.filter((m) => m.to === 'ada@mico360.test')).toHaveLength(2); // the sweep counts them as today’s
  });

  it('one email by itself', async () => {
    const s = setup();
    const r = await s.service.sendFor('ada', { kind: 'COMPLETED' });
    expect(r!.results.map((x) => [x.kind, x.outcome])).toEqual([['COMPLETED', 'sent']]);
    expect(s.sent.map((m) => m.template)).toEqual(['daily-completed']);
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

  it('never sends an email the person turned off, even when asked to resend', async () => {
    const s = setup({ people: [person('ada', { prefs: onlyPending })] });
    const r = await s.service.sendFor('ada', { kind: 'COMPLETED', resend: true });
    expect(r!.results).toEqual([{ kind: 'COMPLETED', outcome: 'off', error: null, sentAt: null }]);
    const both = await s.service.sendFor('ada');
    expect(both!.results.map((x) => [x.kind, x.outcome])).toEqual([['PENDING', 'sent'], ['COMPLETED', 'off']]);
    expect(s.sent.map((m) => m.template)).toEqual(['daily-pending']);
    expect(s.rows.map((x) => x.kind)).toEqual(['PENDING']);
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
    const s = setup({ completed: [] });
    await s.service.runSweep();
    expect(s.rows.find((r) => r.kind === 'COMPLETED')).toMatchObject({ status: 'SKIPPED' });
    s.setTasks({ completed: [task('RIG-9', { completedAt: at('2026-10-20T08:00:00Z') })] });
    const r = await s.service.sendFor('ada', { kind: 'COMPLETED' });
    expect(r!.results.map((x) => x.outcome)).toEqual(['sent']);
    expect(s.rows.find((x) => x.kind === 'COMPLETED')).toMatchObject({ status: 'SENT', taskCount: 1, attempts: 2 });
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
    expect(r!.results).toEqual([
      { kind: 'PENDING', outcome: 'retry', error: 'HTTP 503', sentAt: null },
      { kind: 'COMPLETED', outcome: 'off', error: null, sentAt: null },
    ]);
    expect(s.rows[0]).toMatchObject({ status: 'RETRY' });
  });

  it('is null for someone who isn’t an active person with an email address', async () => {
    const s = setup({ people: [person('ada', { email: null })] });
    expect(await s.service.sendFor('ada')).toBeNull();
    expect(await s.service.sendFor('nobody')).toBeNull();
  });
});

describe('daily task emails: an administrator’s preview', () => {
  it('builds the email as it would be sent now — the subject and the plain text — and sends nothing', async () => {
    const s = setup({ pending: [task('RIG-1', { title: 'Check the <b>pump</b>' })] });
    const p = await s.service.preview('ada', 'PENDING');
    expect(p).toMatchObject({ name: 'ADA', email: 'ada@mico360.test', kind: 'PENDING', day: '2026-10-21', subject: 'Your pending tasks: 1', taskCount: 1, empty: false, on: true });
    expect(p!.text).toContain('Check the <b>pump</b> (RIG-1, Rig)');
    expect(p).not.toHaveProperty('html');
    expect(s.sent).toEqual([]);
    expect(s.rows).toEqual([]);
  });

  it('says when there is nothing to send', async () => {
    const s = setup({ completed: [], people: [person('ada', { prefs: onlyPending })] });
    expect(await s.service.preview('ada', 'COMPLETED')).toMatchObject({ subject: null, text: null, taskCount: 0, empty: true, on: false });
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
    await s.service.runSweep(); // 06:00: Ada’s pending email goes, her completed one has nothing; Fay’s and Gus’s are replaced below
    s.rows.splice(0, s.rows.length, ...s.rows.filter((r) => r.userId === 'ada'));
    s.rows.push(
      record({ id: 'f1', userId: 'fay', kind: 'PENDING', status: 'FAILED', attempts: 4, lastError: 'HTTP 503' }),
      record({ id: 'g1', userId: 'gus', kind: 'PENDING', status: 'RETRY', attempts: 2, nextAttemptAt: at('2026-10-21T02:50:00Z'), lastError: 'Timed out' }),
    );
    s.setNow('2026-10-21T02:30:00Z');
    const o = await s.service.overview();
    expect(o.day).toBeNull();
    expect(o.lastCheckedAt?.toISOString()).toBe('2026-10-21T02:00:00.000Z');
    expect(o.nextSendAt?.toISOString()).toBe('2026-10-21T03:30:00.000Z'); // Bo’s 07:30
    expect(o.people.map((p) => p.name)).toEqual(['ADA', 'BO', 'CY', 'FAY', 'GUS']);
    const [ada, bo, cy, fay, gus] = o.people;
    expect(ada).toMatchObject({ userId: 'ada', email: 'ada@mico360.test', timeZone: TZ, ownTimeZone: false, time: '06:00', day: '2026-10-21' });
    expect(ada!.pending).toMatchObject({ on: true, state: 'SENT', sentAt: at('2026-10-21T02:00:00Z'), taskCount: 1, attempts: 1 });
    expect(ada!.completed).toMatchObject({ on: true, state: 'SKIPPED' });
    expect(bo!.pending).toMatchObject({ on: true, state: 'DUE', dueAt: at('2026-10-21T03:30:00Z') });
    expect(cy!.pending).toMatchObject({ on: false, state: 'OFF' });
    expect(fay!.pending).toMatchObject({ state: 'FAILED', attempts: 4, lastError: 'HTTP 503' });
    expect(fay!.completed).toMatchObject({ on: false, state: 'OFF' });
    expect(gus!.pending).toMatchObject({ state: 'RETRY', nextAttemptAt: at('2026-10-21T02:50:00Z'), lastError: 'Timed out' });
    expect(o.summary).toEqual({ people: 4, sent: 1, skipped: 1, failed: 1, retrying: 1, sending: 0, upcoming: 2, toSend: 3 });
  });

  it('each person’s own calendar day and time zone', async () => {
    const s = setup({ people: [person('eve', { timeZone: 'America/New_York' })] });
    s.setNow('2026-10-21T02:30:00Z'); // 22:30 on 20 Oct in New York: her 06:00 has passed, nothing sent yet
    const [eve] = (await s.service.overview()).people;
    expect(eve).toMatchObject({ timeZone: 'America/New_York', ownTimeZone: true, day: '2026-10-20' });
    expect(eve!.pending).toMatchObject({ state: 'DUE', dueAt: at('2026-10-20T10:00:00Z') });
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
    expect(past.people[0]!.completed).toMatchObject({ state: 'NONE' });
    expect(past.summary).toMatchObject({ sent: 1, upcoming: 0, toSend: 2 }); // Send now is always about today
    const next = await s.service.overview('2026-10-22');
    expect(next.people[1]!.pending).toMatchObject({ state: 'DUE', dueAt: at('2026-10-22T02:00:00Z') });
  });
});
