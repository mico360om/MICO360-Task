import { Prisma, type PrismaClient, type Project } from '@prisma/client';
import { ConflictError } from '../../lib/http-errors';
import { DEFAULT_COLUMNS, type CreateProjectData, type PeopleLookup, type ProjectRecord, type ProjectRepository, type UpdateProjectData } from './project-repository';
import { writeStartingTasks } from './prisma-starting-content';

function toRecord(p: Project): ProjectRecord {
  return {
    id: p.id,
    code: p.code,
    number: p.number,
    name: p.name,
    description: p.description,
    clientName: p.clientName,
    managerId: p.managerId,
    ownerId: p.ownerId,
    status: p.status,
    priority: p.priority,
    color: p.color,
    icon: p.icon,
    imageUrl: p.imageUrl,
    startDate: p.startDate,
    targetDate: p.targetDate,
    notes: p.notes,
    carryForward: p.carryForward,
    defaultDueToday: p.defaultDueToday,
    createdById: p.createdById,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

/** A new project's own fields (left out ones take the database's defaults). */
function projectFields(data: CreateProjectData) {
  return {
    code: data.code,
    number: data.number ?? undefined,
    name: data.name,
    createdById: data.createdById,
    description: data.description ?? undefined,
    clientName: data.clientName ?? undefined,
    managerId: data.managerId ?? undefined,
    ownerId: data.ownerId ?? undefined,
    status: data.status ?? undefined,
    priority: data.priority ?? undefined,
    color: data.color ?? undefined,
    icon: data.icon ?? undefined,
    startDate: data.startDate ?? undefined,
    targetDate: data.targetDate ?? undefined,
    notes: data.notes ?? undefined,
    carryForward: data.carryForward ?? undefined,
    defaultDueToday: data.defaultDueToday ?? undefined,
  };
}

export function createPrismaProjectRepository(prisma: PrismaClient): ProjectRepository {
  return {
    async create(data: CreateProjectData) {
      try {
        const start = data.startWith;
        // A project from a template: the project, the template's board, its tasks (with their
        // checklists and people) and the first team in one transaction — all of it or none of it.
        if (start) {
          return await prisma.$transaction(
            async (tx) => {
              const p = await tx.project.create({
                data: {
                  ...projectFields(data),
                  columns: { create: start.columns.map((c, position) => ({ name: c.name, category: c.category, color: c.color, position })) },
                  ...(data.members?.length ? { members: { create: data.members.map((m) => ({ userId: m.userId, role: m.role })) } } : {}),
                },
                include: { columns: { orderBy: { position: 'asc' }, select: { id: true, category: true } } },
              });
              const column = p.columns[start.startColumn] ?? p.columns[0]!;
              await writeStartingTasks(tx, { id: p.id, code: p.code, ownerId: p.ownerId, createdById: p.createdById }, column, start);
              return toRecord(p);
            },
            { timeout: 60_000, maxWait: 10_000 },
          );
        }
        // The project, its default board columns and its first team are one nested write (one transaction).
        const p = await prisma.project.create({
          data: {
            ...projectFields(data),
            columns: { create: DEFAULT_COLUMNS.map((c, position) => ({ name: c.name, category: c.category, color: c.color, position })) },
            // Its team in the same write: a project never exists without the people it was made with.
            ...(data.members?.length ? { members: { create: data.members.map((m) => ({ userId: m.userId, role: m.role })) } } : {}),
          },
        });
        return toRecord(p);
      } catch (err) {
        // Codes stay unique across deleted projects too, so a deleted project's code can't be reused.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new ConflictError('A project with this code already exists (it may belong to a deleted project).', 'DUPLICATE_PROJECT_CODE');
        }
        throw err;
      }
    },
    async findById(id) {
      const p = await prisma.project.findFirst({ where: { id, deletedAt: null } });
      return p ? toRecord(p) : null;
    },
    async findByCode(code) {
      const p = await prisma.project.findFirst({ where: { code, deletedAt: null } });
      return p ? toRecord(p) : null;
    },
    async codeInUse(code) {
      return (await prisma.project.count({ where: { code } })) > 0;
    },
    async list() {
      const ps = await prisma.project.findMany({ where: { deletedAt: null }, orderBy: { createdAt: 'desc' } });
      return ps.map(toRecord);
    },
    // Who sees a project: its owner, its named manager and its team. Having created it is not a way
    // in (the creator is on its team from the start, so leaving the team means leaving the project).
    async listForUser(userId) {
      const ps = await prisma.project.findMany({
        where: {
          deletedAt: null,
          OR: [{ ownerId: userId }, { managerId: userId }, { members: { some: { userId } } }],
        },
        orderBy: { createdAt: 'desc' },
      });
      return ps.map(toRecord);
    },
    async isAccessibleTo(projectId, userId) {
      const p = await prisma.project.findFirst({
        where: {
          id: projectId,
          deletedAt: null,
          OR: [{ ownerId: userId }, { managerId: userId }, { members: { some: { userId } } }],
        },
        select: { id: true },
      });
      return p !== null;
    },
    async update(id, patch: UpdateProjectData, opts) {
      const keep = [...new Set(opts?.keepManagers ?? [])];
      if (keep.length === 0) return toRecord(await prisma.project.update({ where: { id }, data: patch }));
      return prisma.$transaction(async (tx) => {
        const p = await tx.project.update({ where: { id }, data: patch });
        const people = await tx.user.findMany({ where: { id: { in: keep }, deletedAt: null }, select: { id: true } });
        for (const { id: userId } of people) {
          await tx.projectMember.upsert({
            where: { projectId_userId: { projectId: id, userId } },
            update: { role: 'MANAGER' },
            create: { projectId: id, userId, role: 'MANAGER' },
          });
        }
        return toRecord(p);
      });
    },
    async softDelete(id) {
      await prisma.project.update({ where: { id }, data: { deletedAt: new Date() } });
    },
  };
}

/** Which of these people may be picked for a project — owner, manager or team: active, not deleted. */
export function createPrismaPeopleLookup(prisma: PrismaClient): PeopleLookup {
  return {
    async activeIds(ids) {
      const wanted = [...new Set(ids)];
      if (wanted.length === 0) return [];
      const rows = await prisma.user.findMany({ where: { id: { in: wanted }, deletedAt: null, status: 'ACTIVE' }, select: { id: true } });
      const active = new Set(rows.map((r) => r.id));
      return wanted.filter((id) => active.has(id));
    },
  };
}
