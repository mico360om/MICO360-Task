import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { HeldNotice } from '../notifications/notification-service';

/**
 * Pushes and emails held by quiet hours or Pause (Notification & Scheduling centre). The bell already
 * has each notice; at the next working morning the person's held pushes go as ONE push and their held
 * emails fold into that morning's daily email — or, when there is none to fold into, go as ONE email.
 * Never a burst.
 */

export interface HoldRow extends HeldNotice {
  id: string;
  createdAt: Date;
}

export type HoldOutcome = 'SENT' | 'FOLDED' | 'DROPPED';

export interface HoldStore {
  add(entry: HeldNotice): Promise<void>;
  /** People with held items whose time has come (each once). */
  dueUsers(now: Date, limit: number): Promise<string[]>;
  /** Take a person's due items of one channel (no one else takes them again); returns them. */
  claimDue(userId: string, channel: 'PUSH' | 'EMAIL', now: Date): Promise<HoldRow[]>;
  /** A person's open held emails due by `upTo`, for the daily email to fold in (peek: nothing is taken). */
  openEmails(userId: string, upTo?: Date): Promise<HoldRow[]>;
  /** Take a person's open held emails due by `upTo` for the daily email (no one else sends them meanwhile). */
  takeEmails(userId: string, upTo: Date, at: Date): Promise<HoldRow[]>;
  /** Let taken rows go again (the email they were taken for didn't go). */
  release(ids: string[]): Promise<void>;
  finish(ids: string[], outcome: HoldOutcome, at: Date): Promise<void>;
  /** Forget finished rows older than this. */
  prune(before: Date): Promise<number>;
}

const select = { id: true, userId: true, notificationId: true, channel: true, type: true, title: true, body: true, entityType: true, entityId: true, releaseAt: true, expiresAt: true, createdAt: true } as const;
type Row = { channel: string } & Omit<HoldRow, 'channel'>;
const asHold = (r: Row): HoldRow => ({ ...r, channel: r.channel === 'EMAIL' ? 'EMAIL' : 'PUSH' });

export function createPrismaHoldStore(prisma: PrismaClient): HoldStore {
  return {
    async add(e) {
      await prisma.notificationHold.create({
        data: {
          userId: e.userId,
          notificationId: e.notificationId,
          channel: e.channel,
          type: e.type.slice(0, 64),
          title: e.title.slice(0, 300),
          body: e.body,
          entityType: e.entityType?.slice(0, 40) ?? null,
          entityId: e.entityId,
          releaseAt: e.releaseAt,
          expiresAt: e.expiresAt,
        },
      });
    },
    async dueUsers(now, limit) {
      // Pushes first (they never wait for anything), oldest first; then emails — so people whose held
      // emails wait for their daily email never crowd out anyone else's pushes.
      const of = async (channel: 'PUSH' | 'EMAIL', take: number) =>
        (await prisma.notificationHold.findMany({ where: { doneAt: null, channel, releaseAt: { lte: now } }, select: { userId: true }, distinct: ['userId'], orderBy: [{ releaseAt: 'asc' }, { id: 'asc' }], take })).map((r) => r.userId);
      return [...new Set([...(await of('PUSH', limit)), ...(await of('EMAIL', limit * 10))])];
    },
    async claimDue(userId, channel, now) {
      // A claim mark of our own (no RETURNING on MariaDB): set it, then read back what carries it.
      const mark = `CLAIM:${randomUUID()}`.slice(0, 16);
      await prisma.notificationHold.updateMany({ where: { userId, channel, doneAt: null, releaseAt: { lte: now } }, data: { doneAt: now, outcome: mark } });
      return (await prisma.notificationHold.findMany({ where: { userId, outcome: mark }, select, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })).map(asHold);
    },
    async openEmails(userId, upTo) {
      return (await prisma.notificationHold.findMany({ where: { userId, channel: 'EMAIL', doneAt: null, ...(upTo ? { releaseAt: { lte: upTo } } : {}) }, select, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })).map(asHold);
    },
    async takeEmails(userId, upTo, at) {
      const mark = `FOLD:${randomUUID()}`.slice(0, 16);
      await prisma.notificationHold.updateMany({ where: { userId, channel: 'EMAIL', doneAt: null, releaseAt: { lte: upTo } }, data: { doneAt: at, outcome: mark } });
      return (await prisma.notificationHold.findMany({ where: { userId, outcome: mark }, select, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })).map(asHold);
    },
    async release(ids) {
      if (ids.length) await prisma.notificationHold.updateMany({ where: { id: { in: ids } }, data: { doneAt: null, outcome: null } });
    },
    async finish(ids, outcome, at) {
      if (ids.length) await prisma.notificationHold.updateMany({ where: { id: { in: ids } }, data: { doneAt: at, outcome } });
    },
    async prune(before) {
      return (await prisma.notificationHold.deleteMany({ where: { doneAt: { not: null, lt: before } } })).count;
    },
  };
}

/** An in-memory store (tests). */
export function createMemoryHoldStore(): HoldStore & { rows: (HoldRow & { doneAt: Date | null; outcome: string | null })[] } {
  const rows: (HoldRow & { doneAt: Date | null; outcome: string | null })[] = [];
  let seq = 0;
  return {
    rows,
    async add(e) {
      rows.push({ ...e, id: `h${++seq}`, createdAt: new Date(), doneAt: null, outcome: null });
    },
    async dueUsers(now, limit) {
      return [...new Set(rows.filter((r) => !r.doneAt && r.releaseAt <= now).map((r) => r.userId))].slice(0, limit);
    },
    async claimDue(userId, channel, now) {
      const taken = rows.filter((r) => r.userId === userId && r.channel === channel && !r.doneAt && r.releaseAt <= now);
      for (const r of taken) {
        r.doneAt = now;
        r.outcome = 'CLAIM';
      }
      return taken.map((r) => ({ ...r }));
    },
    async openEmails(userId, upTo) {
      return rows.filter((r) => r.userId === userId && r.channel === 'EMAIL' && !r.doneAt && (!upTo || r.releaseAt <= upTo)).map((r) => ({ ...r }));
    },
    async takeEmails(userId, upTo, at) {
      const taken = rows.filter((r) => r.userId === userId && r.channel === 'EMAIL' && !r.doneAt && r.releaseAt <= upTo);
      for (const r of taken) Object.assign(r, { doneAt: at, outcome: 'FOLD' });
      return taken.map((r) => ({ ...r }));
    },
    async release(ids) {
      for (const r of rows) if (ids.includes(r.id)) Object.assign(r, { doneAt: null, outcome: null });
    },
    async finish(ids, outcome, at) {
      for (const r of rows) if (ids.includes(r.id)) Object.assign(r, { doneAt: at, outcome });
    },
    async prune(before) {
      const keep = rows.filter((r) => !(r.doneAt && r.doneAt < before));
      const gone = rows.length - keep.length;
      rows.splice(0, rows.length, ...keep);
      return gone;
    },
  };
}

export interface HoldReleaseDeps {
  store: HoldStore;
  /** The phone push (absent: pushes aren't set up — held pushes are dropped quietly). */
  push?: { sendToUser(userId: string, n: { title: string; body?: string | null; entityType?: string | null; entityId?: string | null; notificationId?: string | null }): Promise<number> };
  /** One email listing a person's held notices. */
  sendBundleEmail(userId: string, items: HoldRow[]): Promise<void>;
  /** Will the person's daily email still go today (it folds their held emails in)? */
  dailyEmailPending(userId: string, now: Date): Promise<boolean>;
  logger?: { error(msg: string, meta?: Record<string, unknown>): void };
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** The one push that stands for a person's held pushes. */
export function bundledPush(items: readonly HoldRow[]): { title: string; body: string | null; entityType: string | null; entityId: string | null; notificationId: string | null } {
  if (items.length === 1) {
    const one = items[0]!;
    return { title: one.title, body: one.body, entityType: one.entityType, entityId: one.entityId, notificationId: one.notificationId };
  }
  const titles = items.slice(0, 3).map((i) => i.title);
  return { title: `${plural(items.length, 'notice')} while you were away`, body: titles.join(' · ') + (items.length > 3 ? ' …' : ''), entityType: null, entityId: null, notificationId: null };
}

/** Release what is due: per person, one push for their held pushes and one email (unless the daily email folds them). */
export function createHoldRelease(deps: HoldReleaseDeps) {
  async function run(now: Date = new Date()): Promise<{ pushes: number; emails: number; dropped: number }> {
    const done = { pushes: 0, emails: 0, dropped: 0 };
    for (const userId of await deps.store.dueUsers(now, 500)) {
      try {
        const pushes = await deps.store.claimDue(userId, 'PUSH', now);
        const live = pushes.filter((p) => !p.expiresAt || p.expiresAt > now);
        const stale = pushes.filter((p) => !live.includes(p));
        if (stale.length) await deps.store.finish(stale.map((p) => p.id), 'DROPPED', now);
        done.dropped += stale.length;
        if (live.length) {
          if (deps.push) await deps.push.sendToUser(userId, bundledPush(live)).catch((err) => deps.logger?.error('held push failed', { err, userId }));
          await deps.store.finish(live.map((p) => p.id), 'SENT', now);
          done.pushes++;
        }
        // Emails wait for the daily email when it still goes today; otherwise one email now.
        if (await deps.dailyEmailPending(userId, now)) continue;
        const emails = await deps.store.claimDue(userId, 'EMAIL', now);
        const keep = emails.filter((e) => !e.expiresAt || e.expiresAt > now);
        const gone = emails.filter((e) => !keep.includes(e));
        if (gone.length) await deps.store.finish(gone.map((e) => e.id), 'DROPPED', now);
        done.dropped += gone.length;
        if (keep.length) {
          await deps.sendBundleEmail(userId, keep).catch((err) => deps.logger?.error('held email failed', { err, userId }));
          await deps.store.finish(keep.map((e) => e.id), 'SENT', now);
          done.emails++;
        }
      } catch (err) {
        deps.logger?.error('releasing held notices failed', { err, userId });
      }
    }
    return done;
  }
  return { run };
}
