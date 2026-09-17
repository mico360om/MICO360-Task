import type { PrismaClient, Project } from '@prisma/client';
import type { CreateProjectData, ProjectRecord, ProjectRepository, UpdateProjectData } from './project-repository';

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
        },
      });
      return toRecord(p);
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
