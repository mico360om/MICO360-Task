import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaProjectRepository } from '../../src/modules/projects/prisma-project-repository';
import { createPrismaMemberRepository, createPrismaProjectExistsLookup, createPrismaProjectManagerLookup } from '../../src/modules/projects/prisma-member-repository';
import { createMemberService } from '../../src/modules/projects/member-service';
import { createProjectAccess } from '../../src/modules/projects/project-access';
import { createPrismaChatMemberLookup } from '../../src/modules/chat/prisma-chat-repository';
import { projectAudienceIds } from '../../src/modules/tasks/prisma-assignee-repository';
import { taskAudienceSelect, toAudienceFacts } from '../../src/modules/notifications/prisma-task-audience';
import { filterTaskRecipients } from '../../src/modules/notifications/recipient-access';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
// Having created a project is not a way in: the creator is on its team (as a manager) instead, so
// taking them off the team takes their access with it — project, tasks, chat and notifications.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const projects = createPrismaProjectRepository(prisma);
const managers = createPrismaProjectManagerLookup(prisma);
const members = createMemberService({ repo: createPrismaMemberRepository(prisma), projects: createPrismaProjectExistsLookup(prisma) });
const access = createProjectAccess({ projects, managers });
const chat = createPrismaChatMemberLookup(prisma);

const CODE = 'CRACC';
const EMAILS = ['cr-creator@mico360.test', 'cr-owner@mico360.test'];
let creator = '';
let owner = '';
let projectId = '';
let taskId = '';

async function cleanup() {
  const ps = await prisma.project.findMany({ where: { code: CODE }, select: { id: true } });
  const ids = ps.map((p) => p.id);
  await prisma.taskWatcher.deleteMany({ where: { task: { projectId: { in: ids } } } });
  await prisma.taskAssignee.deleteMany({ where: { task: { projectId: { in: ids } } } });
  await prisma.task.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.kanbanColumn.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.projectMember.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.project.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
}
beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await cleanup();
  const user = (email: string) => prisma.user.create({ data: { email, username: email.split('@')[0]!, passwordHash: 'x', firstName: 'Cr', lastName: 'Test' } });
  creator = (await user(EMAILS[0]!)).id;
  owner = (await user(EMAILS[1]!)).id;
  // As an employee creates one with someone else as owner: they are on the team as a manager.
  const p = await projects.create({ code: CODE, name: 'Creator access', createdById: creator, ownerId: owner, members: [{ userId: creator, role: 'MANAGER' }, { userId: owner, role: 'MEMBER' }] });
  projectId = p.id;
  const column = await prisma.kanbanColumn.findFirstOrThrow({ where: { projectId, category: 'TODO' } });
  taskId = (await prisma.task.create({ data: { key: `${CODE}-1`, title: 'Survey', projectId, columnId: column.id, createdById: creator } })).id;
  await prisma.taskAssignee.create({ data: { taskId, userId: creator } });
  await prisma.taskWatcher.create({ data: { taskId, userId: creator } });
});

async function audience(): Promise<string[]> {
  const t = await prisma.task.findFirstOrThrow({ where: { id: taskId }, select: taskAudienceSelect });
  return filterTaskRecipients([creator, owner], toAudienceFacts(t), { adminIds: [] });
}

describe('The creator of a project (integration)', () => {
  it('sees it while on its team', async () => {
    expect(await projects.isAccessibleTo(projectId, creator)).toBe(true);
    expect(await access.canViewTask(creator, [], taskId)).toBe(true);
    expect(await chat.canAccessProject(projectId, creator)).toBe(true);
    expect(await audience()).toContain(creator);
  });

  it('loses it when taken off the team: project, tasks, chat channel and notifications', async () => {
    await members.removeMember(projectId, creator, { byAdmin: false }); // the owner still runs it
    expect(await projects.isAccessibleTo(projectId, creator)).toBe(false);
    expect((await projects.listForUser(creator)).map((p) => p.id)).not.toContain(projectId);
    expect(await access.canViewProject(creator, [], projectId)).toBe(false);
    expect(await access.canViewTask(creator, [], taskId)).toBe(false);
    expect(await access.accessibleProjectIds(creator, [])).not.toContain(projectId);
    // Chat: the project's channel and its member list.
    expect(await chat.canAccessProject(projectId, creator)).toBe(false);
    expect(await chat.accessibleProjectIds(creator)).not.toContain(projectId);
    expect(await chat.projectMemberIds!(projectId)).toEqual([owner]);
    // Taken off its task as any removed member is (assignment and watch), so no more notices.
    expect(await prisma.taskAssignee.count({ where: { taskId, userId: creator } })).toBe(0);
    expect(await prisma.taskWatcher.count({ where: { taskId, userId: creator } })).toBe(0);
    expect(await audience()).toEqual([owner]);
    expect(await projectAudienceIds(prisma, projectId, [creator, owner])).toEqual([owner]);
  });
});
