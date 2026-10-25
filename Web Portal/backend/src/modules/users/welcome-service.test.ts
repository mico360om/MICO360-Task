import { describe, it, expect } from 'vitest';
import { createWelcomeService } from './welcome-service';
import { createMemoryWelcomeTokenStore } from './memory-welcome-store';
import { createMemoryUserRepository } from './memory-user-repository';
import { hashResetToken } from '../../lib/reset-token';
import { EmailDeliveryError } from '../email/delivery-error';
import type { WelcomeEmailParams } from '../email/email-templates';

const DAY = 24 * 3600 * 1000;

function harness(opts: { configured?: boolean; blocked?: string[]; fail?: (email: string) => boolean; suppressAtSend?: string[]; concurrency?: number } = {}) {
  let clock = new Date('2026-10-25T06:00:00.000Z').getTime();
  const mem = createMemoryUserRepository();
  const tokens = createMemoryWelcomeTokenStore();
  const sent: { email: string; params: WelcomeEmailParams }[] = [];
  const warnings: { msg: string; ctx?: Record<string, unknown> }[] = [];
  /** What the database does wrong: reading these people, recording a send, ending earlier links. */
  const broken = { find: new Set<string>(), mark: false, replace: false };
  /** Runs after a person is read and before the answer comes back (a slow database). */
  let afterFind: ((id: string) => Promise<void>) | null = null;
  /** Emails going out and audit callbacks, in order. */
  const events: string[] = [];
  const service = createWelcomeService({
    users: {
      async findById(id) {
        if (broken.find.has(id)) throw new Error('database away');
        const snapshot = await mem.repo.findById(id);
        if (afterFind) await afterFind(id);
        return snapshot;
      },
      async markWelcomeSent(id, at) {
        if (broken.mark) throw new Error('database away');
        return mem.repo.markWelcomeSent(id, at);
      },
    },
    tokens: {
      ...tokens.store,
      async replaceEarlier(userId, keepId) {
        if (broken.replace) throw new Error('database away');
        return tokens.store.replaceEarlier(userId, keepId);
      },
    },
    mailer: {
      isConfigured: () => opts.configured ?? true,
      isBlocked: async (email) => (opts.blocked ?? []).includes(email),
      async sendWelcome(email, params) {
        if (opts.fail?.(email)) throw new EmailDeliveryError(email, 503, 'Email could not be delivered (HTTP 503).');
        if ((opts.suppressAtSend ?? []).includes(email)) return 'suppressed';
        sent.push({ email, params });
        events.push(`email ${email}`);
        return 'sent';
      },
    },
    ...(opts.concurrency ? { concurrency: opts.concurrency } : {}),
    appUrl: 'https://task.mico360.test/',
    downloads: () => ({ androidAppUrl: 'https://task.mico360.test/downloads/MICO360-Tasks.apk', extensionUrl: null }),
    logger: { warn: (msg, ctx) => void warnings.push({ msg, ctx }) },
    now: () => new Date(clock),
  });
  const add = (username: string, extra: Partial<{ email: string; firstName: string }> = {}) =>
    mem.repo.create({ email: extra.email ?? `${username}@x.co`, username, passwordHash: 'h', firstName: extra.firstName ?? username[0]!.toUpperCase() + username.slice(1), lastName: 'T', roleNames: ['EMPLOYEE'] });
  const tokenOf = (i = sent.length - 1) => new URL(sent[i]!.params.setPasswordLink).searchParams.get('token')!;
  return {
    service,
    mem,
    tokens,
    sent,
    warnings,
    broken,
    events,
    add,
    tokenOf,
    setAfterFind: (fn: ((id: string) => Promise<void>) | null) => void (afterFind = fn),
    advance: (ms: number) => (clock += ms),
    now: () => new Date(clock),
  };
}

describe('WelcomeService.send — one person', () => {
  it('emails a one-time set-password link valid for 7 days, and only its hash is kept', async () => {
    const h = harness();
    const sara = await h.add('sara', { firstName: 'Sara' });
    const out = await h.service.send(sara.id);
    expect(out).toMatchObject({ userId: sara.id, username: 'sara', name: 'Sara T', email: 'sara@x.co', sent: true, sentAt: '2026-10-25T06:00:00.000Z' });
    expect(h.sent).toHaveLength(1);
    const { email, params } = h.sent[0]!;
    expect(email).toBe('sara@x.co');
    expect(params).toMatchObject({ firstName: 'Sara', username: 'sara', expiresInDays: 7, androidAppUrl: 'https://task.mico360.test/downloads/MICO360-Tasks.apk', extensionUrl: null });
    expect(params.setPasswordLink).toMatch(/^https:\/\/task\.mico360\.test\/reset\?token=[A-Za-z0-9_-]{43}&welcome=1$/);
    const live = h.tokens.live(sara.id);
    expect(live).toHaveLength(1);
    expect(live[0]!.tokenHash).toBe(hashResetToken(h.tokenOf()));
    expect(live[0]!.expiresAt.getTime() - h.now().getTime()).toBe(7 * DAY);
    expect(JSON.stringify(h.tokens.rows)).not.toContain(h.tokenOf());
  });

  it('remembers when it went (User Management shows it)', async () => {
    const h = harness();
    const sara = await h.add('sara');
    await h.service.send(sara.id);
    expect((await h.mem.repo.findById(sara.id))?.welcomeSentAt?.toISOString()).toBe('2026-10-25T06:00:00.000Z');
  });

  it('sending again replaces the earlier link', async () => {
    const h = harness();
    const sara = await h.add('sara');
    await h.service.send(sara.id);
    const first = h.tokenOf();
    h.advance(2 * 60_000);
    expect((await h.service.send(sara.id)).sent).toBe(true);
    const live = h.tokens.live(sara.id);
    expect(live).toHaveLength(1);
    expect(live[0]!.tokenHash).toBe(hashResetToken(h.tokenOf()));
    expect(live[0]!.tokenHash).not.toBe(hashResetToken(first));
  });

  it('never changes the person’s password (their current one keeps working until they use the link)', async () => {
    const h = harness();
    const sara = await h.add('sara');
    const before = h.mem.hashOf(sara.id);
    await h.service.send(sara.id);
    expect(h.mem.hashOf(sara.id)).toBe(before);
  });

  it.each([
    ['inactive', 'ACCOUNT_INACTIVE', 'the account is inactive'],
    ['suspended', 'ACCOUNT_SUSPENDED', 'the account is suspended'],
  ] as const)('refuses a %s account and says why', async (_label, reason, why) => {
    const h = harness();
    const sara = await h.add('sara');
    await h.mem.repo.setStatus(sara.id, reason === 'ACCOUNT_INACTIVE' ? 'INACTIVE' : 'SUSPENDED');
    expect(await h.service.send(sara.id)).toMatchObject({ userId: sara.id, username: 'sara', sent: false, reason, why });
    expect(h.sent).toEqual([]);
    expect(h.tokens.rows).toEqual([]);
  });

  it('refuses a locked account (too many failed sign-ins) until it is unlocked', async () => {
    const h = harness();
    const sara = await h.add('sara');
    h.mem.lock(sara.id, new Date(Date.now() + 15 * 60_000));
    expect(await h.service.send(sara.id)).toMatchObject({ sent: false, reason: 'ACCOUNT_LOCKED', why: 'the account is locked after too many failed sign-in attempts (unlock it first)' });
    await h.mem.repo.unlock(sara.id);
    expect((await h.service.send(sara.id)).sent).toBe(true);
  });

  it('refuses a deleted or unknown account', async () => {
    const h = harness();
    const sara = await h.add('sara');
    await h.mem.repo.softDelete(sara.id);
    expect(await h.service.send(sara.id)).toMatchObject({ userId: sara.id, username: null, sent: false, reason: 'NOT_FOUND', why: 'the account no longer exists' });
    expect(await h.service.send('nobody')).toMatchObject({ sent: false, reason: 'NOT_FOUND' });
    expect(h.sent).toEqual([]);
  });

  it('refuses an account without an email address', async () => {
    const h = harness();
    const sara = await h.add('sara', { email: ' ' });
    expect(await h.service.send(sara.id)).toMatchObject({ sent: false, reason: 'NO_EMAIL', why: 'the account has no email address' });
  });

  it('refuses a blocked address (it bounced or was marked as spam), before any link is made', async () => {
    const h = harness({ blocked: ['sara@x.co'] });
    const sara = await h.add('sara');
    expect(await h.service.send(sara.id)).toMatchObject({ sent: false, reason: 'EMAIL_BLOCKED', why: 'emails to this address are blocked (it bounced or was marked as spam)' });
    expect(h.tokens.rows).toEqual([]);
  });

  it('an address blocked by the time it is sent: no working link is left behind', async () => {
    const h = harness({ suppressAtSend: ['sara@x.co'] });
    const sara = await h.add('sara');
    expect(await h.service.send(sara.id)).toMatchObject({ sent: false, reason: 'EMAIL_BLOCKED' });
    expect(h.tokens.live(sara.id)).toEqual([]);
    expect((await h.mem.repo.findById(sara.id))?.welcomeSentAt ?? null).toBeNull();
  });

  it('one welcome email a minute per person: a double click never sends two', async () => {
    const h = harness();
    const sara = await h.add('sara');
    const [a, b] = await Promise.all([h.service.send(sara.id), h.service.send(sara.id)]);
    expect([a.sent, b.sent].sort()).toEqual([false, true]);
    expect([a, b].find((o) => !o.sent)).toMatchObject({ reason: 'TOO_SOON', why: 'a welcome email was sent to them less than a minute ago' });
    h.advance(30_000);
    expect(await h.service.send(sara.id)).toMatchObject({ sent: false, reason: 'TOO_SOON' });
    h.advance(31_000);
    expect((await h.service.send(sara.id)).sent).toBe(true);
    expect(h.sent).toHaveLength(2);
  });

  it('an email that couldn’t be delivered: says so, keeps the earlier link working, and logs no link', async () => {
    let failing = false;
    const h = harness({ fail: () => failing });
    const sara = await h.add('sara');
    await h.service.send(sara.id);
    const first = h.tokens.live(sara.id)[0]!.id;
    h.advance(2 * 60_000);
    failing = true;
    expect(await h.service.send(sara.id)).toMatchObject({ sent: false, reason: 'DELIVERY_FAILED', why: 'the email couldn’t be delivered (try again later)' });
    expect(h.tokens.live(sara.id).map((r) => r.id)).toEqual([first]);
    expect((await h.mem.repo.findById(sara.id))?.welcomeSentAt?.toISOString()).toBe('2026-10-25T06:00:00.000Z');
    expect(h.warnings.map((w) => w.msg)).toEqual(['welcome email could not be sent']);
    expect(JSON.stringify(h.warnings)).not.toMatch(/token|reset\?/);
  });

  it('needs email to be set up: refuses at once, storing nothing', async () => {
    const h = harness({ configured: false });
    const sara = await h.add('sara');
    expect(h.service.isConfigured()).toBe(false);
    await expect(h.service.send(sara.id)).rejects.toMatchObject({ code: 'EMAIL_NOT_CONFIGURED', status: 503 });
    await expect(h.service.sendMany([sara.id])).rejects.toMatchObject({ code: 'EMAIL_NOT_CONFIGURED' });
    expect(h.tokens.rows).toEqual([]);
  });
});

describe('WelcomeService.sendMany — several people', () => {
  it('sends to each, says per person why not, in the order asked, each person once', async () => {
    const h = harness({ blocked: ['bo@x.co'] });
    const ada = await h.add('ada');
    const bo = await h.add('bo');
    const cy = await h.add('cy');
    await h.mem.repo.setStatus(cy.id, 'SUSPENDED');
    const out = await h.service.sendMany([ada.id, bo.id, cy.id, ada.id]);
    expect(out.map((o) => [o.username, o.sent, o.reason ?? null])).toEqual([
      ['ada', true, null],
      ['bo', false, 'EMAIL_BLOCKED'],
      ['cy', false, 'ACCOUNT_SUSPENDED'],
    ]);
    expect(h.sent.map((s) => s.email)).toEqual(['ada@x.co']);
  });

  it('one failure doesn’t stop the rest', async () => {
    const h = harness({ fail: (email) => email === 'bo@x.co' });
    const people = await Promise.all(['ada', 'bo', 'cy', 'di', 'ed', 'fa'].map((n) => h.add(n)));
    const out = await h.service.sendMany(people.map((p) => p.id));
    expect(out.filter((o) => o.sent)).toHaveLength(5);
    expect(out.find((o) => !o.sent)).toMatchObject({ username: 'bo', reason: 'DELIVERY_FAILED' });
  });
});

describe('WelcomeService — a database problem never loses a result', () => {
  const SERVER_WHY = 'something went wrong on the server (try again)';

  it('an error for one person is “not sent” for that person, in plain words, and the others still go', async () => {
    const h = harness();
    const ada = await h.add('ada');
    const bo = await h.add('bo');
    h.broken.find.add(bo.id);
    const out = await h.service.sendMany([ada.id, bo.id]);
    expect(out.map((o) => [o.userId, o.sent, o.reason ?? null, o.why ?? null])).toEqual([
      [ada.id, true, null, null],
      [bo.id, false, 'SERVER_ERROR', SERVER_WHY],
    ]);
    expect(h.warnings.map((w) => w.msg)).toContain('welcome email failed');
    await expect(h.service.send(bo.id)).resolves.toMatchObject({ sent: false, reason: 'SERVER_ERROR', why: SERVER_WHY });
  });

  it('once the email has gone, a failure to record it is logged and it still counts as sent (no duplicate a minute later)', async () => {
    const h = harness();
    const ada = await h.add('ada');
    h.broken.mark = true;
    h.broken.replace = true;
    expect(await h.service.send(ada.id)).toMatchObject({ sent: true });
    expect(h.warnings.map((w) => w.msg)).toEqual(['could not end earlier welcome links', 'could not record when the welcome email went']);
    expect(JSON.stringify(h.warnings)).not.toContain(h.tokenOf());
  });

  it('each email is reported (for the audit log) as soon as it has gone, before the next person is tried', async () => {
    const h = harness({ concurrency: 1 });
    const ada = await h.add('ada');
    const bo = await h.add('bo');
    const cy = await h.add('cy');
    h.broken.find.add(cy.id);
    const out = await h.service.sendMany([ada.id, bo.id, cy.id], { onSent: (o) => void h.events.push(`audit ${o.username}`) });
    expect(h.events).toEqual(['email ada@x.co', 'audit ada', 'email bo@x.co', 'audit bo']);
    expect(out.map((o) => o.sent)).toEqual([true, true, false]);
    await h.service.send(cy.id, { onSent: () => void h.events.push('never') });
    expect(h.events).not.toContain('never');
  });

  it('an audit entry that can’t be written is logged; the email still counts as sent', async () => {
    const h = harness();
    const ada = await h.add('ada');
    const out = await h.service.send(ada.id, {
      onSent: async () => {
        throw new Error('audit table away');
      },
    });
    expect(out.sent).toBe(true);
    expect(h.warnings.map((w) => w.msg)).toEqual(['could not record the welcome email in the audit log']);
  });

  it('two sends to the same person at once: the second is refused before it reads the person (a slow read can’t let it through)', async () => {
    const h = harness();
    const ada = await h.add('ada');
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    let reads = 0;
    // The second read is slow: it comes back only after the first send has finished.
    h.setAfterFind(async () => {
      if (++reads === 2) await gate;
    });
    const first = h.service.send(ada.id);
    const second = h.service.send(ada.id);
    expect(await first).toMatchObject({ sent: true });
    open();
    expect(await second).toMatchObject({ sent: false, reason: 'TOO_SOON', username: 'ada' });
    expect(h.sent).toHaveLength(1);
  });
});
