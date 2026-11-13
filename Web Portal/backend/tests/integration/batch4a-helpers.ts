import type { PrismaClient } from '@prisma/client';

/**
 * Review batch 4a (13 Nov 2026) — a small world per test file: one owner, projects whose codes start
 * with `prefix`, the usual three columns, and tasks. `clean()` removes everything the file made.
 */
export function batch4aWorld(prisma: PrismaClient, prefix: string) {
  let seq = 0;
  let keyN = 0;
  const uid = () => `${prefix.toLowerCase()}${Date.now().toString(36)}${(seq++).toString(36)}`;
  const domain = `@${prefix.toLowerCase()}.test`;

  async function clean(): Promise<void> {
    const projects = (await prisma.project.findMany({ where: { code: { startsWith: prefix } }, select: { id: true } })).map((p) => p.id);
    const tasks = (await prisma.task.findMany({ where: { projectId: { in: projects } }, select: { id: true } })).map((t) => t.id);
    await prisma.taskDependency.deleteMany({ where: { OR: [{ taskId: { in: tasks } }, { dependsOnTaskId: { in: tasks } }] } });
    await prisma.activity.deleteMany({ where: { OR: [{ projectId: { in: projects } }, { taskId: { in: tasks } }] } });
    await prisma.taskAssignee.deleteMany({ where: { taskId: { in: tasks } } });
    await prisma.taskSeriesErased.deleteMany({ where: { seriesId: { in: tasks } } });
    // Copies point at their source (recurrenceSourceId has no foreign key), so plain deletes are fine.
    await prisma.task.deleteMany({ where: { id: { in: tasks } } });
    await prisma.kanbanColumn.deleteMany({ where: { projectId: { in: projects } } });
    await prisma.projectMember.deleteMany({ where: { projectId: { in: projects } } });
    await prisma.project.deleteMany({ where: { id: { in: projects } } });
    const users = (await prisma.user.findMany({ where: { email: { endsWith: domain } }, select: { id: true } })).map((u) => u.id);
    await prisma.userRole.deleteMany({ where: { userId: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  }

  async function user(admin = false) {
    const u = uid();
    return prisma.user.create({
      data: {
        email: `${u}${domain}`,
        username: u,
        passwordHash: 'x',
        firstName: 'Test',
        lastName: u,
        roles: { create: [{ roleId: admin ? 'role_builtin_admin' : 'role_builtin_employee' }] },
      },
    });
  }

  async function project(ownerId: string, memberIds: string[] = []) {
    const code = `${prefix}${uid().slice(-5).toUpperCase()}`;
    const p = await prisma.project.create({
      data: { code, name: `Contoso Engineering ${code}`, createdById: ownerId, ownerId, members: { create: memberIds.map((userId) => ({ userId })) } },
    });
    const todo = await prisma.kanbanColumn.create({ data: { projectId: p.id, name: 'To do', category: 'TODO', position: 0 } });
    const doing = await prisma.kanbanColumn.create({ data: { projectId: p.id, name: 'In progress', category: 'IN_PROGRESS', position: 1 } });
    const done = await prisma.kanbanColumn.create({ data: { projectId: p.id, name: 'Done', category: 'DONE', position: 2 } });
    return { p, todo, doing, done };
  }

  async function task(projectId: string, code: string, columnId: string, createdById: string, extra: Record<string, unknown> = {}) {
    // Numbers spaced apart: a repeat copy takes the project's highest number plus one in between.
    return prisma.task.create({ data: { key: `${code}-${++keyN * 100}`, title: `Pump check ${keyN}`, projectId, columnId, createdById, ...extra } });
  }

  return { clean, user, project, task };
}

export const outcome = (r: PromiseSettledResult<unknown>) => (r.status === 'fulfilled' ? 'ok' : ((r.reason as { code?: string }).code ?? String(r.reason)));
