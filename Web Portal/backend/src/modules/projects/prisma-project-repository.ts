import { Prisma, type PrismaClient, type Project } from '@prisma/client';
import { ConflictError } from '../../lib/http-errors';
import { DEFAULT_COLUMNS, type CreateProjectData, type PeopleLookup, type ProjectRecord, type ProjectRepository, type UpdateProjectData } from './project-repository';
import { writeStartingTasks } from './prisma-starting-content';
import { inCompanyWhere, pickedCompanyWhere, teamWhere, visibleProjectWhere } from '../companies/company-access';
import { ARCHIVE_INCLUDE, archivedOf } from '../companies/project-archive';
import { STAFF_ONLY_WHERE } from '../clients/client-kind';

/** companies: a new project's company rows, as the rules chose them (`[0]`, its main company, is always one of them). */
const companyLink = (companyIds: readonly string[] | undefined) =>
  companyIds?.length ? { mainCompanyId: companyIds[0]!, companies: { create: [...new Set(companyIds)].map((companyId) => ({ companyId })) } } : {};

/** companies: every read takes its companies' statuses along, so the record says whether it counts as archived. */
type ProjectRow = Project & { companies: { company: { status: 'ACTIVE' | 'ARCHIVED' } }[] };

function toRecord(p: ProjectRow): ProjectRecord {
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
    archived: archivedOf(p),
    priority: p.priority,
    color: p.color,
    icon: p.icon,
    imageUrl: p.imageUrl,
    startDate: p.startDate,
    targetDate: p.targetDate,
    notes: p.notes,
    carryForward: p.carryForward,
    defaultDueToday: p.defaultDueToday,
    newTasksNeedApproval: p.newTasksNeedApproval,
    createdById: p.createdById,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

/**
 * True only for the project code's unique index (`projects_code_key`): another unique index hit while
 * writing a project's board, tasks or team is a different problem, never "that code is taken".
 */
export function isProjectCodeConflict(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') return false;
  const target = (err.meta as { target?: unknown } | undefined)?.target;
  if (Array.isArray(target)) return target.length === 1 && target[0] === 'code';
  return typeof target === 'string' && /^projects_code_key$/i.test(target);
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
    newTasksNeedApproval: data.newTasksNeedApproval ?? undefined,
  };
}

export function createPrismaProjectRepository(prisma: PrismaClient): ProjectRepository {
  return {
    async create(data: CreateProjectData) {
      try {
        const start = data.startWith;
        const company = companyLink(data.companyIds);
        // A project from a template: the project, the template's board, its tasks (with their
        // checklists and people) and the first team in one transaction — all of it or none of it.
        if (start) {
          return await prisma.$transaction(
            async (tx) => {
              const p = await tx.project.create({
                data: {
                  ...projectFields(data),
                  ...company,
                  columns: { create: start.columns.map((c, position) => ({ name: c.name, category: c.category, color: c.color, position })) },
                  ...(data.members?.length ? { members: { create: data.members.map((m) => ({ userId: m.userId, role: m.role })) } } : {}),
                },
                include: { ...ARCHIVE_INCLUDE, columns: { orderBy: { position: 'asc' }, select: { id: true, category: true } } },
              });
              const column = p.columns[start.startColumn] ?? p.columns[0]!;
              await writeStartingTasks(tx, { id: p.id, code: p.code, ownerId: p.ownerId, createdById: p.createdById, newTasksNeedApproval: p.newTasksNeedApproval }, column, start);
              return toRecord(p);
            },
            { timeout: 60_000, maxWait: 10_000 },
          );
        }
        // The project, its default board columns and its first team are one nested write (one transaction).
        const p = await prisma.project.create({
          data: {
            ...projectFields(data),
            ...company,
            columns: { create: DEFAULT_COLUMNS.map((c, position) => ({ name: c.name, category: c.category, color: c.color, position })) },
            // Its team in the same write: a project never exists without the people it was made with.
            ...(data.members?.length ? { members: { create: data.members.map((m) => ({ userId: m.userId, role: m.role })) } } : {}),
          },
          include: ARCHIVE_INCLUDE,
        });
        return toRecord(p);
      } catch (err) {
        // Codes stay unique across deleted projects too, so a deleted project's code can't be reused.
        if (isProjectCodeConflict(err)) {
          throw new ConflictError('A project with this code already exists (it may belong to a deleted project).', 'DUPLICATE_PROJECT_CODE');
        }
        throw err;
      }
    },
    async findById(id) {
      const p = await prisma.project.findFirst({ where: { id, deletedAt: null }, include: ARCHIVE_INCLUDE });
      return p ? toRecord(p) : null;
    },
    async findByCode(code) {
      const p = await prisma.project.findFirst({ where: { code, deletedAt: null }, include: ARCHIVE_INCLUDE });
      return p ? toRecord(p) : null;
    },
    async codeInUse(code) {
      return (await prisma.project.count({ where: { code } })) > 0;
    },
    // Every project (an administrator's list), or with a picked company only that company's.
    async list(pick) {
      const ps = await prisma.project.findMany({ where: { deletedAt: null, ...(pick ? { companies: { some: { companyId: pick } } } : {}) }, orderBy: { createdAt: 'desc' }, include: ARCHIVE_INCLUDE });
      return ps.map(toRecord);
    },
    // Who sees a project: its owner, its named manager and its team, inside one of the person's
    // active companies (companies: visibleProjectWhere). Having created it is not a way in (the
    // creator is on its team from the start, so leaving the team means leaving the project).
    async listForUser(userId, pick) {
      const ps = await prisma.project.findMany({
        where: pick ? { AND: [visibleProjectWhere(userId), pickedCompanyWhere(userId, pick)] } : visibleProjectWhere(userId),
        orderBy: { createdAt: 'desc' },
        include: ARCHIVE_INCLUDE,
      });
      return ps.map(toRecord);
    },
    // 1.22 "Show my projects only": an administrator's own projects — the team rule, no company condition.
    async listTeamOf(userId, pick) {
      const ps = await prisma.project.findMany({
        where: { deletedAt: null, AND: [teamWhere(userId), ...(pick ? [inCompanyWhere(pick)] : [])] },
        orderBy: { createdAt: 'desc' },
        include: ARCHIVE_INCLUDE,
      });
      return ps.map(toRecord);
    },
    async isAccessibleTo(projectId, userId) {
      const p = await prisma.project.findFirst({ where: { AND: [{ id: projectId }, visibleProjectWhere(userId)] }, select: { id: true } });
      return p !== null;
    },
    async update(id, patch: UpdateProjectData, opts) {
      const keep = [...new Set(opts?.keepManagers ?? [])];
      if (keep.length === 0) return toRecord(await prisma.project.update({ where: { id }, data: patch, include: ARCHIVE_INCLUDE }));
      return prisma.$transaction(async (tx) => {
        const p = await tx.project.update({ where: { id }, data: patch, include: ARCHIVE_INCLUDE });
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
      // 1.23: a client account is never a project's owner, manager or team member.
      const rows = await prisma.user.findMany({ where: { id: { in: wanted }, deletedAt: null, status: 'ACTIVE', ...STAFF_ONLY_WHERE }, select: { id: true } });
      const active = new Set(rows.map((r) => r.id));
      return wanted.filter((id) => active.has(id));
    },
    // companies: a project's team comes from its companies (administrators may always join).
    async outsideCompanies(ids, companyIds) {
      const wanted = [...new Set(ids)];
      if (wanted.length === 0) return [];
      const rows = await prisma.user.findMany({
        where: {
          id: { in: wanted },
          roles: { none: { role: { name: 'ADMIN' } } },
          companies: { none: { companyId: { in: companyIds }, company: { status: 'ACTIVE' } } },
        },
        select: { id: true, firstName: true, lastName: true, username: true },
      });
      const byId = new Map(rows.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim() || u.username]));
      return wanted.filter((id) => byId.has(id)).map((id) => ({ id, name: byId.get(id)! }));
    },
    async projectCompanyIds(projectId) {
      const rows = await prisma.projectCompany.findMany({ where: { projectId }, select: { companyId: true, company: { select: { status: true } } } });
      if (rows.length === 0) return null;
      return rows.filter((r) => r.company.status === 'ACTIVE').map((r) => r.companyId);
    },
  };
}
