import { Prisma, type PrismaClient, type Company } from '@prisma/client';
import { SETTING_SCHEMAS } from '../settings/settings-service';
import { isProjectArchived } from './company-rules';
import type { CompanyRecord, CompanyRepository, WeekStart } from './company-repository';

const WEEK_STARTS: readonly number[] = [0, 1, 6];

function toRecord(c: Company): CompanyRecord {
  const hours = c.workingHours === null ? null : SETTING_SCHEMAS['meetings.workingHours'].safeParse(c.workingHours);
  return {
    id: c.id,
    name: c.name,
    code: c.code,
    logoUrl: c.logoUrl,
    // A stored value the rules don't know (edited by hand) counts as "the site's".
    weekStart: c.weekStart !== null && WEEK_STARTS.includes(c.weekStart) ? (c.weekStart as WeekStart) : null,
    workingHours: hours?.success ? hours.data : null,
    senderName: c.senderName,
    status: c.status,
    archivedAt: c.archivedAt,
    createdById: c.createdById,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

/** A JSON column's value: null is stored as SQL NULL ("the site's"). */
const json = (v: unknown) => (v === null ? Prisma.DbNull : (v as Prisma.InputJsonValue));

export function createPrismaCompanyRepository(prisma: PrismaClient): CompanyRepository {
  return {
    async list() {
      return (await prisma.company.findMany({ orderBy: { name: 'asc' } })).map(toRecord);
    },
    async findById(id) {
      const c = await prisma.company.findUnique({ where: { id } });
      return c ? toRecord(c) : null;
    },
    async findByName(name) {
      // The column's collation ignores case.
      const c = await prisma.company.findFirst({ where: { name } });
      return c ? toRecord(c) : null;
    },
    async findByCode(code) {
      const c = await prisma.company.findFirst({ where: { code } });
      return c ? toRecord(c) : null;
    },
    async create(data) {
      const c = await prisma.company.create({
        data: {
          name: data.name,
          code: data.code,
          weekStart: data.weekStart ?? null,
          ...(data.workingHours !== undefined ? { workingHours: json(data.workingHours) } : {}),
          senderName: data.senderName ?? null,
          createdById: data.createdById,
        },
      });
      return toRecord(c);
    },
    async update(id, patch) {
      const { workingHours, ...rest } = patch;
      const c = await prisma.company.update({ where: { id }, data: { ...rest, ...(workingHours !== undefined ? { workingHours: json(workingHours) } : {}) } });
      return toRecord(c);
    },
    async countActive() {
      return prisma.company.count({ where: { status: 'ACTIVE' } });
    },
    async counts(ids) {
      if (ids.length === 0) return new Map();
      const [people, projects] = await Promise.all([
        prisma.companyMember.groupBy({ by: ['companyId'], where: { companyId: { in: ids }, user: { deletedAt: null } }, _count: { _all: true } }),
        prisma.projectCompany.groupBy({ by: ['companyId'], where: { companyId: { in: ids }, project: { deletedAt: null } }, _count: { _all: true } }),
      ]);
      const count = (rows: { companyId: string; _count: { _all: number } }[], id: string) => rows.find((r) => r.companyId === id)?._count._all ?? 0;
      return new Map(ids.map((id) => [id, { people: count(people, id), projects: count(projects, id) }]));
    },
    async memberIds(companyId) {
      return (await prisma.companyMember.findMany({ where: { companyId }, select: { userId: true } })).map((m) => m.userId);
    },
    async projectIds(companyId) {
      return (await prisma.projectCompany.findMany({ where: { companyId }, select: { projectId: true } })).map((p) => p.projectId);
    },
    async people(companyId) {
      const rows = await prisma.user.findMany({
        where: { deletedAt: null, companies: { some: { companyId } } },
        select: { id: true, firstName: true, lastName: true, username: true, email: true, status: true, primaryCompanyId: true },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { username: 'asc' }],
      });
      return rows.map(({ primaryCompanyId, ...p }) => ({ ...p, isPrimary: primaryCompanyId === companyId }));
    },
    async projects(companyId) {
      const rows = await prisma.project.findMany({
        where: { deletedAt: null, companies: { some: { companyId } } },
        select: { id: true, code: true, name: true, status: true, mainCompanyId: true, companies: { select: { company: { select: { status: true } } } } },
        orderBy: [{ name: 'asc' }, { code: 'asc' }],
      });
      return rows.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        isMain: p.mainCompanyId === companyId,
        archived: isProjectArchived({ status: p.status, companies: p.companies.map((c) => c.company) }),
      }));
    },
    async activeOf(userId) {
      return (await prisma.company.findMany({ where: { status: 'ACTIVE', members: { some: { userId } } }, orderBy: { name: 'asc' } })).map(toRecord);
    },
    async primaryOf(userId) {
      return (await prisma.user.findUnique({ where: { id: userId }, select: { primaryCompanyId: true } }))?.primaryCompanyId ?? null;
    },
    async addMembers(companyId, userIds, addedById) {
      const { count } = await prisma.companyMember.createMany({ data: [...new Set(userIds)].map((userId) => ({ companyId, userId, addedById })), skipDuplicates: true });
      return count;
    },
    async removeMember(companyId, userId) {
      const { count } = await prisma.companyMember.deleteMany({ where: { companyId, userId } });
      return count > 0;
    },
  };
}
