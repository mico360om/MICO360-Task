import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaProjectRepository } from '../../src/modules/projects/prisma-project-repository';
import { createProjectService } from '../../src/modules/projects/project-service';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const projects = createPrismaProjectRepository(prisma);
const projectService = createProjectService({ projects });
const CODES = ['PTSA', 'PTSB', 'PTSC'];
const EMAIL = 'project-settings@mico360.test';
let userId = '';

async function cleanup() {
  const ids = (await prisma.project.findMany({ where: { code: { in: CODES } }, select: { id: true } })).map((p) => p.id);
  await prisma.activity.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.task.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.kanbanColumn.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.project.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.deleteMany({ where: { email: EMAIL } });
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
  userId = (await prisma.user.create({ data: { email: EMAIL, username: 'project-settings', passwordHash: 'x', firstName: 'Project', lastName: 'Settings' } })).id;
});

describe('Project task settings in the database (integration)', () => {
  it('a project made without them carries forward and doesn’t fill in due dates', async () => {
    const p = await projectService.createProject({ code: 'PTSA', name: 'Defaults', createdById: userId });
    expect(p).toMatchObject({ carryForward: true, defaultDueToday: false });
    expect(await projects.findById(p.id)).toMatchObject({ carryForward: true, defaultDueToday: false });
  });

  it('keeps the settings it was made with, and an update without them leaves them alone', async () => {
    const p = await projectService.createProject({ code: 'PTSB', name: 'Chosen', createdById: userId, carryForward: false, defaultDueToday: true });
    expect(p).toMatchObject({ carryForward: false, defaultDueToday: true });
    expect(await projectService.updateProject(p.id, { name: 'Renamed' })).toMatchObject({ name: 'Renamed', carryForward: false, defaultDueToday: true });
    expect(await projectService.updateProject(p.id, { defaultDueToday: false })).toMatchObject({ carryForward: false, defaultDueToday: false });
    expect((await projects.list()).find((x) => x.id === p.id)).toMatchObject({ carryForward: false, defaultDueToday: false });
  });
});
