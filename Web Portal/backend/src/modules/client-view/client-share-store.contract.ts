import { describe, it, expect, beforeEach } from 'vitest';
import { ClientShareExistsError, type ClientShareStore } from './client-share-store';

/**
 * What every client-share store must do (the in-memory one in unit tests, the Prisma one against
 * MySQL). `setup` gives a fresh store and two project ids it may share.
 */
export function clientShareStoreContract(name: string, setup: () => Promise<{ store: ClientShareStore; projectA: string; projectB: string }>) {
  describe(`client share store contract: ${name}`, () => {
    let store: ClientShareStore;
    let projectA: string;
    let projectB: string;
    const HOUR = 3600_000;
    const at = (iso: string) => new Date(iso);
    const h = (c: string) => c.repeat(64).slice(0, 64);

    beforeEach(async () => {
      ({ store, projectA, projectB } = await setup());
    });

    const add = (projectId: string, email: string, linkHash: string, name = 'Client') =>
      store.create({ projectId, name, email, linkHash, createdById: 'u-owner' });

    it('keeps a share and finds it by id, by its link and by its address within the project', async () => {
      const s = await add(projectA, 'fatma@client.example', h('a'), 'Fatma');
      expect(s).toMatchObject({ projectId: projectA, name: 'Fatma', email: 'fatma@client.example', linkHash: h('a'), createdById: 'u-owner', lastViewedAt: null });
      expect((await store.findById(s.id))?.id).toBe(s.id);
      expect((await store.findByLinkHash(h('a')))?.id).toBe(s.id);
      expect((await store.findByEmail(projectA, 'fatma@client.example'))?.id).toBe(s.id);
      expect(await store.findByEmail(projectB, 'fatma@client.example')).toBeNull();
      expect(await store.findByLinkHash(h('z'))).toBeNull();
    });

    it('lists a project’s shares only, oldest first', async () => {
      const one = await add(projectA, 'one@x.example', h('1'));
      const two = await add(projectA, 'two@x.example', h('2'));
      await add(projectB, 'three@x.example', h('3'));
      expect((await store.listForProject(projectA)).map((s) => s.id)).toEqual([one.id, two.id]);
    });

    it('refuses a second share of one project with the same address (another project may have it)', async () => {
      await add(projectA, 'fatma@client.example', h('a'));
      await expect(add(projectA, 'fatma@client.example', h('b'))).rejects.toBeInstanceOf(ClientShareExistsError);
      await expect(add(projectB, 'fatma@client.example', h('c'))).resolves.toMatchObject({ projectId: projectB });
    });

    it('replaces the link only while it is still the one expected, and ends the codes sent with the old one', async () => {
      const s = await add(projectA, 'fatma@client.example', h('a'));
      await store.createCode({ shareId: s.id, codeHash: 'code-1', expiresAt: new Date(Date.now() + HOUR) });
      expect(await store.replaceLink(s.id, h('x'), h('b'))).toBe(false); // not the current link
      expect(await store.replaceLink(s.id, h('a'), h('b'))).toBe(true);
      expect(await store.findByLinkHash(h('a'))).toBeNull();
      expect((await store.findByLinkHash(h('b')))?.id).toBe(s.id);
      expect(await store.latestOpenCode(s.id)).toBeNull();
    });

    it('removing a share removes its codes and its sessions at once', async () => {
      const s = await add(projectA, 'fatma@client.example', h('a'));
      await store.createCode({ shareId: s.id, codeHash: 'code-1', expiresAt: new Date(Date.now() + HOUR) });
      await store.createSession({ shareId: s.id, tokenHash: h('s'), expiresAt: new Date(Date.now() + HOUR) });
      expect(await store.delete(s.id)).toBe(true);
      expect(await store.findById(s.id)).toBeNull();
      expect(await store.findSession(h('s'))).toBeNull();
      expect(await store.latestOpenCode(s.id)).toBeNull();
      expect(await store.delete(s.id)).toBe(false);
    });

    it('a new code ends the earlier unused ones: only the newest can be tried', async () => {
      const s = await add(projectA, 'fatma@client.example', h('a'));
      await store.createCode({ shareId: s.id, codeHash: 'code-1', expiresAt: new Date(Date.now() + HOUR) });
      await store.createCode({ shareId: s.id, codeHash: 'code-2', expiresAt: new Date(Date.now() + HOUR) });
      expect((await store.latestOpenCode(s.id))?.codeHash).toBe('code-2');
      expect(await store.countCodesSince(s.id, new Date(Date.now() - HOUR))).toBe(2);
      expect(await store.countCodesSince(s.id, new Date(Date.now() + HOUR))).toBe(0);
    });

    it('counts each try atomically up to the limit; a code is used once; a used try is not a failure', async () => {
      const s = await add(projectA, 'fatma@client.example', h('a'));
      await store.createCode({ shareId: s.id, codeHash: 'code-1', expiresAt: new Date(Date.now() + HOUR) });
      const code = (await store.latestOpenCode(s.id))!;
      const tries = await Promise.all([1, 2, 3, 4, 5, 6, 7].map(() => store.claimAttempt(code.id, 5)));
      expect(tries.filter(Boolean)).toHaveLength(5);
      expect(await store.countFailuresSince(s.id, new Date(Date.now() - HOUR))).toBe(5);
      expect(await store.consumeCode(code.id)).toBe(true);
      expect(await store.consumeCode(code.id)).toBe(false);
      expect(await store.countFailuresSince(s.id, new Date(Date.now() - HOUR))).toBe(4);
      expect(await store.latestOpenCode(s.id)).toBeNull();
      expect(await store.claimAttempt(code.id, 5)).toBe(false);
    });

    it('keeps sessions by their hash until they are signed out or expire; keeps a few per client', async () => {
      const s = await add(projectA, 'fatma@client.example', h('a'));
      const soon = new Date(Date.now() + HOUR);
      await store.createSession({ shareId: s.id, tokenHash: h('1'), expiresAt: soon });
      expect(await store.findSession(h('1'))).toMatchObject({ shareId: s.id });
      await store.deleteSession(h('1'));
      expect(await store.findSession(h('1'))).toBeNull();

      await store.createSession({ shareId: s.id, tokenHash: h('e'), expiresAt: new Date(Date.now() - 1000) });
      for (const c of ['2', '3', '4']) await store.createSession({ shareId: s.id, tokenHash: h(c), expiresAt: soon });
      await store.pruneSessions(s.id, new Date(), 2);
      expect(await store.findSession(h('e'))).toBeNull(); // expired
      expect(await store.findSession(h('2'))).toBeNull(); // the oldest beyond the two kept
      expect(await store.findSession(h('3'))).not.toBeNull();
      expect(await store.findSession(h('4'))).not.toBeNull();
    });

    it('records when the link was sent and when the page was last viewed', async () => {
      const s = await add(projectA, 'fatma@client.example', h('a'));
      await store.markSent(s.id, at('2026-10-26T08:00:00Z'));
      await store.markViewed(s.id, at('2026-10-26T09:00:00Z'));
      expect(await store.findById(s.id)).toMatchObject({ linkSentAt: at('2026-10-26T08:00:00Z'), lastViewedAt: at('2026-10-26T09:00:00Z') });
    });
  });
}
