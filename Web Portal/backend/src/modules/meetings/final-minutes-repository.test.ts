import { describe, it, expect } from 'vitest';
import { createMemoryFinalMinutesRepository, createPrismaFinalMinutesRepository } from './final-minutes-repository';

const content = { summary: 'Done.', discussion: [{ topic: 'Plan', text: 'Agreed.' }], decisions: ['Ship'], risks: [], nextSteps: ['Send it — Bilal'] };

describe('final minutes storage (memory)', () => {
  it('has nothing for a meeting until minutes are saved, then returns what was saved', async () => {
    const repo = createMemoryFinalMinutesRepository(() => new Date('2026-10-14T08:00:00Z'));
    expect(await repo.get('m1')).toBeNull();
    const saved = await repo.save('m1', { content, status: 'DRAFT', approvedById: null, approvedAt: null });
    expect(saved).toEqual({ content, status: 'DRAFT', approvedById: null, approvedAt: null, savedAt: new Date('2026-10-14T08:00:00Z') });
    expect(await repo.get('m1')).toEqual(saved);
  });

  it('a draft can be taken back out (MICO AI’s Undo of a first draft): the meeting has none again', async () => {
    const repo = createMemoryFinalMinutesRepository();
    await repo.save('m1', { content, status: 'DRAFT', approvedById: null, approvedAt: null });
    await repo.remove('m1');
    expect(await repo.get('m1')).toBeNull();
    await expect(repo.remove('m1')).resolves.toBeUndefined();
  });
});

describe('final minutes storage (database)', () => {
  function fakePrisma() {
    const rows = new Map<string, Record<string, unknown>>();
    return {
      rows,
      meetingMinutes: {
        async findUnique({ where }: { where: { meetingId: string } }) {
          return rows.get(where.meetingId) ?? null;
        },
        async upsert({ where, create, update }: { where: { meetingId: string }; create: Record<string, unknown>; update: Record<string, unknown> }) {
          const row = rows.has(where.meetingId) ? { ...rows.get(where.meetingId)!, ...update } : { id: 'x', ...create };
          rows.set(where.meetingId, row);
          return row;
        },
        async deleteMany({ where }: { where: { meetingId: string } }) {
          const had = rows.delete(where.meetingId);
          return { count: had ? 1 : 0 };
        },
      },
    };
  }

  it('keeps the content as JSON in the minutes row, with the status and who approved it', async () => {
    const prisma = fakePrisma();
    const repo = createPrismaFinalMinutesRepository(prisma as never, () => new Date('2026-10-14T08:00:00Z'));
    const at = new Date('2026-10-14T09:00:00Z');
    await repo.save('m1', { content, status: 'APPROVED', approvedById: 'u1', approvedAt: at });
    expect(prisma.rows.get('m1')).toMatchObject({ meetingId: 'm1', content: JSON.stringify(content), status: 'APPROVED', approvedById: 'u1', approvedAt: at });
    expect(await repo.get('m1')).toEqual({ content, status: 'APPROVED', approvedById: 'u1', approvedAt: at, savedAt: new Date('2026-10-14T08:00:00Z') });
  });

  it('reads an unreadable or old row as a draft with what can be recovered', async () => {
    const prisma = fakePrisma();
    prisma.rows.set('m2', { meetingId: 'm2', content: 'plain old text', status: 'IN_REVIEW', approvedById: null, approvedAt: null, generatedAt: new Date('2026-01-01T00:00:00Z') });
    const repo = createPrismaFinalMinutesRepository(prisma as never);
    expect(await repo.get('m2')).toEqual({
      content: { summary: 'plain old text', discussion: [], decisions: [], risks: [], nextSteps: [] },
      status: 'DRAFT',
      approvedById: null,
      approvedAt: null,
      savedAt: new Date('2026-01-01T00:00:00Z'),
    });
  });

  it('removing the row leaves the meeting without final minutes', async () => {
    const prisma = fakePrisma();
    const repo = createPrismaFinalMinutesRepository(prisma as never);
    await repo.save('m1', { content, status: 'DRAFT', approvedById: null, approvedAt: null });
    await repo.remove('m1');
    expect(prisma.rows.has('m1')).toBe(false);
  });
});
