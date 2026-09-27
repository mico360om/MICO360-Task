import { describe, it, expect } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createPrismaChatMemberLookup, createPrismaMessageRepository, createPrismaParticipantRepository } from './prisma-chat-repository';

/** A Prisma stand-in: each model op answers from `answers` (a value or a function of the args). */
function recorder(answers: Record<string, unknown | ((args: Record<string, unknown>) => unknown)> = {}) {
  const calls: { op: string; args: Record<string, unknown> }[] = [];
  const model = (name: string) =>
    new Proxy({}, {
      get: (_t, op: string) => async (args: Record<string, unknown>) => {
        calls.push({ op: `${name}.${op}`, args });
        const a = answers[`${name}.${op}`];
        return typeof a === 'function' ? (a as (x: Record<string, unknown>) => unknown)(args) : a ?? null;
      },
    });
  const prisma = new Proxy({}, { get: (_t, name: string) => model(name) }) as unknown as PrismaClient;
  return { prisma, calls };
}

describe('Prisma chat repositories', () => {
  it('blanks the body when a message is deleted (CHAT-01)', async () => {
    const { prisma, calls } = recorder({ 'chatMessage.update': {} });
    await createPrismaMessageRepository(prisma).softDelete('msg1');
    expect(calls[0]!.args).toMatchObject({ where: { id: 'msg1' }, data: { body: '' } });
    expect((calls[0]!.args.data as { deletedAt: unknown }).deletedAt).toBeInstanceOf(Date);
  });

  it('removes a participant row (SEC-07)', async () => {
    const { prisma, calls } = recorder({ 'conversationParticipant.deleteMany': { count: 1 } });
    await createPrismaParticipantRepository(prisma).remove('c1', 'u2');
    expect(calls[0]).toEqual({ op: 'conversationParticipant.deleteMany', args: { where: { conversationId: 'c1', userId: 'u2' } } });
  });
});

describe('Prisma chat member lookup — project visibility (CHAT-03)', () => {
  const project = { id: 'p1', ownerId: 'owner', managerId: 'manager', createdById: 'creator' };

  it('opens the channel to the owner, manager and creator without a member row', async () => {
    const { prisma, calls } = recorder({ 'project.findFirst': project });
    const lookup = createPrismaChatMemberLookup(prisma);
    for (const u of ['owner', 'manager', 'creator']) expect(await lookup.canAccessProject('p1', u)).toBe(true);
    expect(calls.every((c) => c.op === 'project.findFirst')).toBe(true);
    expect(calls[0]!.args.where).toEqual({ id: 'p1', deletedAt: null });
  });

  it('opens it to members and admins, and not to anyone else', async () => {
    const { prisma } = recorder({
      'project.findFirst': project,
      'projectMember.findUnique': (a: Record<string, unknown>) => ((a.where as { projectId_userId: { userId: string } }).projectId_userId.userId === 'member' ? { userId: 'member' } : null),
      'userRole.findFirst': (a: Record<string, unknown>) => ((a.where as { userId: string }).userId === 'admin' ? { userId: 'admin' } : null),
    });
    const lookup = createPrismaChatMemberLookup(prisma);
    expect(await lookup.canAccessProject('p1', 'member')).toBe(true);
    expect(await lookup.canAccessProject('p1', 'admin')).toBe(true);
    expect(await lookup.canAccessProject('p1', 'stranger')).toBe(false);
  });

  it('closes the channel of a deleted project', async () => {
    const { prisma } = recorder({ 'project.findFirst': null, 'userRole.findFirst': { userId: 'admin' } });
    expect(await createPrismaChatMemberLookup(prisma).canAccessProject('gone', 'admin')).toBe(false);
  });

  it('lists every live project for an admin, and only visible ones for others', async () => {
    const { prisma, calls } = recorder({
      'userRole.findFirst': (a: Record<string, unknown>) => ((a.where as { userId: string }).userId === 'admin' ? { userId: 'admin' } : null),
      'project.findMany': [{ id: 'p1' }],
    });
    const lookup = createPrismaChatMemberLookup(prisma);
    await lookup.accessibleProjectIds('admin');
    await lookup.accessibleProjectIds('u1');
    const lists = calls.filter((c) => c.op === 'project.findMany').map((c) => c.args.where);
    expect(lists[0]).toEqual({ deletedAt: null });
    expect(lists[1]).toMatchObject({ deletedAt: null, OR: expect.arrayContaining([{ ownerId: 'u1' }, { members: { some: { userId: 'u1' } } }]) });
  });
});
