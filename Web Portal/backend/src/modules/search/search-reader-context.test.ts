import { describe, it, expect } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createReaderContext } from './search-reader-context';
import type { SearchScopeAll } from './search-scope';

// 1.23.6 The reader's context: only the projects and people the person may see are ever read.
function fakePrisma() {
  const asked: { projects: unknown[]; users: unknown[] } = { projects: [], users: [] };
  const prisma = {
    project: {
      findMany: async (args: { where: { id?: { in: string[] } } }) => {
        asked.projects.push(args.where);
        const all = [
          { id: 'p1', code: 'MICO', name: 'MICO360' },
          { id: 'p2', code: 'RIG', name: 'Rig 7' },
        ];
        return args.where.id ? all.filter((p) => args.where.id!.in.includes(p.id)) : all;
      },
    },
    user: {
      findMany: async (args: { where: { id?: { in: string[] } } }) => {
        asked.users.push(args.where);
        const all = [
          { id: 'u1', firstName: 'Ana', lastName: 'A', username: 'ana' },
          { id: 'u2', firstName: 'Ben', lastName: 'B', username: 'ben' },
        ];
        return args.where.id ? all.filter((u) => args.where.id!.in.includes(u.id)) : all;
      },
    },
  } as unknown as PrismaClient;
  return { prisma, asked };
}
const scopeOf = (projectIds: string[] | null): SearchScopeAll => ({ projectIds, meetings: { full: [], invitee: [], editable: [] } });

describe('the reader’s context', () => {
  it('today and the week’s first day of the company; the person’s projects and people only', async () => {
    const { prisma, asked } = fakePrisma();
    const ctx = createReaderContext({ prisma, timeZone: 'Asia/Muscat', weekStart: async () => 1, now: () => new Date('2026-11-06T21:30:00Z') });
    const r = await ctx({ id: 'u1', roles: [] }, null, scopeOf(['p1']), async () => new Set(['u1']));
    expect(r.today).toBe('2026-11-07'); // 01:30 in Muscat
    expect(r.weekStart).toBe(1);
    expect(r.projects.map((p) => p.code)).toEqual(['MICO']);
    expect(r.people.map((p) => p.username)).toEqual(['ana']);
    // Never a client account, never a deleted person or project.
    expect(asked.users[0]).toMatchObject({ deletedAt: null, roles: { none: { role: { name: 'CLIENT' } } } });
    expect(asked.projects[0]).toMatchObject({ deletedAt: null });
  });

  it('an administrator (no project limit, everyone): all of them', async () => {
    const { prisma } = fakePrisma();
    const ctx = createReaderContext({ prisma, timeZone: 'UTC', weekStart: async () => 0 });
    const r = await ctx({ id: 'a', roles: ['ADMIN'] }, null, scopeOf(null), async () => null);
    expect(r.projects).toHaveLength(2);
    expect(r.people).toHaveLength(2);
  });

  it('kept for a minute per person and picked company', async () => {
    const { prisma, asked } = fakePrisma();
    let t = 0;
    const ctx = createReaderContext({ prisma, timeZone: 'UTC', weekStart: async () => 0, clock: () => t });
    const people = async () => null;
    await ctx({ id: 'u1', roles: [] }, null, scopeOf(['p1']), people);
    await ctx({ id: 'u1', roles: [] }, null, scopeOf(['p1']), people);
    expect(asked.projects).toHaveLength(1);
    await ctx({ id: 'u1', roles: [] }, 'c1', scopeOf(['p1']), people);
    await ctx({ id: 'u2', roles: [] }, null, scopeOf(['p1']), people);
    expect(asked.projects).toHaveLength(3);
    t = 61_000;
    await ctx({ id: 'u1', roles: [] }, null, scopeOf(['p1']), people);
    expect(asked.projects).toHaveLength(4);
  });
});
