import { describe, it, expect } from 'vitest';
import { createInvitationSweep, type ExpiredInvitationStore } from './invitation-sweep';

type Link = { id: string; userId: string; createdAt: Date; expiresAt: Date; consumedAt: Date | null };
const d = (iso: string) => new Date(iso);

function store(links: Link[]): ExpiredInvitationStore & { links: Link[] } {
  return {
    links,
    async expiredOpen(now, limit) {
      return links.filter((l) => l.consumedAt === null && l.expiresAt <= now).slice(0, limit);
    },
    async end(id, at) {
      const l = links.find((x) => x.id === id && x.consumedAt === null);
      if (!l) return false;
      l.consumedAt = at;
      return true;
    },
  };
}

describe('Invitations that expire are audited once each (the hourly sweep)', () => {
  it('each unused invitation past its 7 days: ended at its expiry and audited “user.invitation.expired”; live and used ones are left alone', async () => {
    const links = store([
      { id: 'w1', userId: 'u1', createdAt: d('2026-10-30T08:00:00Z'), expiresAt: d('2026-11-06T08:00:00Z'), consumedAt: null },
      { id: 'w2', userId: 'u2', createdAt: d('2026-11-05T08:00:00Z'), expiresAt: d('2026-11-12T08:00:00Z'), consumedAt: null },
      { id: 'w3', userId: 'u3', createdAt: d('2026-10-20T08:00:00Z'), expiresAt: d('2026-10-27T08:00:00Z'), consumedAt: d('2026-10-21T08:00:00Z') },
    ]);
    const audit: unknown[] = [];
    const sweep = createInvitationSweep({ store: links, audit: { record: async (e) => void audit.push(e) }, now: () => d('2026-11-07T08:00:00Z') });
    expect(await sweep.run()).toBe(1);
    expect(audit).toEqual([
      { userId: null, ip: null, module: 'users', action: 'user.invitation.expired', entityId: 'u1', newValue: { sentAt: '2026-10-30T08:00:00.000Z', expiredAt: '2026-11-06T08:00:00.000Z' } },
    ]);
    expect(links.links[0]!.consumedAt).toEqual(d('2026-11-06T08:00:00Z'));
    expect(links.links[1]!.consumedAt).toBeNull();
    // Run again: nothing new.
    expect(await sweep.run()).toBe(0);
    expect(audit).toHaveLength(1);
  });

  it('two sweeps at once (two servers) audit each expiry once', async () => {
    const links = store([{ id: 'w1', userId: 'u1', createdAt: d('2026-10-30T08:00:00Z'), expiresAt: d('2026-11-06T08:00:00Z'), consumedAt: null }]);
    const audit: unknown[] = [];
    const make = () => createInvitationSweep({ store: links, audit: { record: async (e) => void audit.push(e) }, now: () => d('2026-11-07T08:00:00Z') });
    await Promise.all([make().run(), make().run()]);
    expect(audit).toHaveLength(1);
  });
});
