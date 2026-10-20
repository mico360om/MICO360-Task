import { describe, it, expect, vi } from 'vitest';
import { createDailyEmailService, type DailyRecipient } from './daily-email-service';
import type { DailyEmailRecord, DailyEmailRepository } from './daily-email-repository';
import type { DailyTask } from './daily-email-content';
import type { EmailContent } from '../email/email-templates';

/** The delivery records in memory, with the same once-only rules as the database. */
function memoryRepo() {
  const rows: DailyEmailRecord[] = [];
  let seq = 0;
  const repo: DailyEmailRepository = {
    async claim(userId, day, kind) {
      if (rows.some((r) => r.userId === userId && r.day === day && r.kind === kind)) return null;
      const now = new Date();
      const r: DailyEmailRecord = { id: `r${seq++}`, userId, day, kind, status: 'SENDING', attempts: 1, taskCount: 0, nextAttemptAt: null, lastError: null, sentAt: null, createdAt: now, updatedAt: now };
      rows.push(r);
      return { ...r };
    },
    async dueForRetry(now) {
      return rows.filter((r) => r.status === 'RETRY' && r.nextAttemptAt && r.nextAttemptAt <= now).map((r) => ({ ...r }));
    },
    async retake(row) {
      const r = rows.find((x) => x.id === row.id);
      if (!r || r.status !== row.status || r.attempts !== row.attempts) return null;
      Object.assign(r, { status: 'SENDING', attempts: r.attempts + 1, nextAttemptAt: null });
      return { ...r };
    },
    async finish(id, patch) {
      Object.assign(rows.find((x) => x.id === id)!, patch);
    },
    async list() {
      return [];
    },
  };
  return { repo, rows };
}

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

function setup(opts: { people?: DailyRecipient[]; pending?: DailyTask[]; completed?: DailyTask[]; configured?: boolean; failures?: number } = {}) {
  const { repo, rows } = memoryRepo();
  let now = at('2026-10-21T02:00:00Z'); // 06:00 in Muscat
  let failures = opts.failures ?? 0;
  const sent: Array<{ to: string; subject: string; template: string }> = [];
  const people = opts.people ?? [person('ada')];
  const pending = vi.fn(async () => opts.pending ?? [task('RIG-1')]);
  const completedBetween = vi.fn(async (_u: string, _from: Date, _to: Date) => opts.completed ?? [task('RIG-2', { completedAt: at('2026-10-20T08:00:00Z') })]);
  const warn = vi.fn();
  const service = createDailyEmailService({
    repo,
    people: { list: async () => people, find: async (id) => people.find((p) => p.id === id) ?? null },
    tasks: { pending, completedBetween },
    send: async (to: string, content: EmailContent, template: string) => {
      if (failures > 0) {
        failures--;
        throw new Error('HTTP 503');
      }
      sent.push({ to, subject: content.subject, template });
    },
    isConfigured: () => opts.configured ?? true,
    companyTimeZone: TZ,
    appUrl: 'https://task.example',
    now: () => now,
    logger: { info: vi.fn(), warn },
  });
  return { service, rows, sent, pending, completedBetween, warn, people, setNow: (iso: string) => { now = at(iso); }, setFailures: (n: number) => { failures = n; } };
}

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
