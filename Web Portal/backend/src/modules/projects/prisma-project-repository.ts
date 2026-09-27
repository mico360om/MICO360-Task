import { Prisma, type PrismaClient, type Project } from '@prisma/client';
import { ConflictError } from '../../lib/http-errors';
import { DEFAULT_COLUMNS, type CreateProjectData, type ProjectRecord, type ProjectRepository, type UpdateProjectData } from './project-repository';

function toRecord(p: Project): ProjectRecord {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    description: p.description,
    clientName: p.clientName,
    managerId: p.managerId,
    ownerId: p.ownerId,
    status: p.status,
    priority: p.priority,
    color: p.color,
    imageUrl: p.imageUrl,
    startDate: p.startDate,
    targetDate: p.targetDate,
    notes: p.notes,
    createdById: p.createdById,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

export function createPrismaProjectRepository(prisma: PrismaClient): ProjectRepository {
  return {
    async create(data: CreateProjectData) {
      try {
        // The project and its default board columns are one nested write (one transaction).
        const p = await prisma.project.create({
          data: {
            code: data.code,
            name: data.name,
            createdById: data.createdById,
            description: data.description ?? undefined,
            clientName: data.clientName ?? undefined,
            managerId: data.managerId ?? undefined,
            ownerId: data.ownerId ?? undefined,
            status: data.status ?? undefined,
            priority: data.priority ?? undefined,
            color: data.color ?? undefined,
            startDate: data.startDate ?? undefined,
            targetDate: data.targetDate ?? undefined,
            notes: data.notes ?? undefined,
            columns: { create: DEFAULT_COLUMNS.map((c, position) => ({ name: c.name, category: c.category, color: c.color, position })) },
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
    async list() {
      const ps = await prisma.project.findMany({ where: { deletedAt: null }, orderBy: { createdAt: 'desc' } });
      return ps.map(toRecord);
    },
    async listForUser(userId) {
      const ps = await prisma.project.findMany({
        where: {
          deletedAt: null,
          OR: [{ ownerId: userId }, { managerId: userId }, { createdById: userId }, { members: { some: { userId } } }],
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
          OR: [{ ownerId: userId }, { managerId: userId }, { createdById: userId }, { members: { some: { userId } } }],
        },
        select: { id: true },
      });
      return p !== null;
    },
    async update(id, patch: UpdateProjectData) {
      const p = await prisma.project.update({ where: { id }, data: patch });
      return toRecord(p);
    },
    async softDelete(id) {
      await prisma.project.update({ where: { id }, data: { deletedAt: new Date() } });
    },
  };
}
