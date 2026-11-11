import type { PrismaClient } from '@prisma/client';
import { archivedOf } from '../companies/project-archive';
import { CLIENT_ROLE } from '../clients/client-kind';
import type { PersonFacts } from './training-targets';

/**
 * The Training Center's view of people, read from the database in a few queries: roles, the Training
 * manager permission, companies (staff: their ACTIVE companies; clients: the main companies of their
 * granted live projects), department, the live projects whose team they are on and whether they run one
 * (owner / named manager / MANAGER member of a live project inside one of their active companies — the
 * Management rule, projects/project-managers.ts managedVisibleWhere).
 */
export interface PersonRecord extends PersonFacts {
  email: string;
  reportsToId: string | null;
  primaryCompanyId: string | null;
  tourDoneAt: Date | null;
  /** Staff: the live projects they run (R5: a project manager's team). */
  runProjectIds: readonly string[];
}

export const personName = (u: { firstName: string; lastName: string; username: string }) => `${u.firstName} ${u.lastName}`.trim() || u.username;

const USER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  username: true,
  email: true,
  status: true,
  createdAt: true,
  departmentId: true,
  trainingManager: true,
  reportsToId: true,
  primaryCompanyId: true,
  tourDoneAt: true,
  roles: { select: { role: { select: { name: true } } } },
  companies: { select: { companyId: true, company: { select: { status: true } } } },
} as const;

const PROJECT_COMPANIES = { companies: { select: { companyId: true, company: { select: { status: true } } } } } as const;

const chunks = <T,>(list: readonly T[], size = 500): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

/** People (not deleted) by id, or everyone when `ids` is left out. */
export async function loadPeople(prisma: PrismaClient, ids?: readonly string[]): Promise<Map<string, PersonRecord>> {
  if (ids && ids.length === 0) return new Map();
  const users = ids
    ? (await Promise.all(chunks([...new Set(ids)]).map((part) => prisma.user.findMany({ where: { deletedAt: null, id: { in: part } }, select: USER_SELECT })))).flat()
    : await prisma.user.findMany({ where: { deletedAt: null }, select: USER_SELECT });
  if (users.length === 0) return new Map();
  const isClient = (u: (typeof users)[number]) => u.roles.some((r) => r.role.name === CLIENT_ROLE);
  const staffIds = users.filter((u) => !isClient(u)).map((u) => u.id);
  const clientIds = users.filter(isClient).map((u) => u.id);

  const projects = staffIds.length
    ? (
        await Promise.all(
          chunks(staffIds).map((part) =>
            prisma.project.findMany({
              where: { deletedAt: null, OR: [{ ownerId: { in: part } }, { managerId: { in: part } }, { members: { some: { userId: { in: part } } } }] },
              select: { id: true, status: true, ownerId: true, managerId: true, members: { select: { userId: true, role: true } }, ...PROJECT_COMPANIES },
            }),
          ),
        )
      ).flat()
    : [];
  const live = [...new Map(projects.map((p) => [p.id, p])).values()].filter((p) => !archivedOf(p));

  const grants = clientIds.length
    ? (
        await Promise.all(
          chunks(clientIds).map((part) =>
            prisma.clientProjectGrant.findMany({
              where: { userId: { in: part } },
              select: { userId: true, project: { select: { id: true, deletedAt: true, status: true, mainCompanyId: true, ...PROJECT_COMPANIES } } },
            }),
          ),
        )
      ).flat()
    : [];

  const out = new Map<string, PersonRecord>();
  for (const u of users) {
    const client = isClient(u);
    const activeCompanies = u.companies.filter((c) => c.company.status === 'ACTIVE').map((c) => c.companyId);
    let companyIds: string[] = activeCompanies;
    let teamProjectIds: string[] = [];
    let runProjectIds: string[] = [];
    if (client) {
      companyIds = [
        ...new Set(
          grants
            .filter((g) => g.userId === u.id && g.project.deletedAt === null && !archivedOf(g.project))
            .map((g) => g.project.mainCompanyId ?? g.project.companies[0]?.companyId ?? null)
            .filter((c): c is string => !!c),
        ),
      ];
    } else {
      const mine = live.filter((p) => p.ownerId === u.id || p.managerId === u.id || p.members.some((m) => m.userId === u.id));
      teamProjectIds = mine.map((p) => p.id);
      runProjectIds = mine
        .filter((p) => p.ownerId === u.id || p.managerId === u.id || p.members.some((m) => m.userId === u.id && m.role === 'MANAGER'))
        .filter((p) => p.companies.some((c) => c.company.status === 'ACTIVE' && activeCompanies.includes(c.companyId)))
        .map((p) => p.id);
    }
    const roles = u.roles.map((r) => r.role.name);
    out.set(u.id, {
      id: u.id,
      name: personName(u),
      email: u.email,
      client,
      admin: !client && roles.includes('ADMIN'),
      trainingManager: !client && u.trainingManager,
      runsProject: runProjectIds.length > 0,
      companyIds,
      active: u.status === 'ACTIVE',
      departmentId: client ? null : u.departmentId,
      teamProjectIds,
      runProjectIds,
      createdAt: u.createdAt,
      reportsToId: u.reportsToId,
      primaryCompanyId: u.primaryCompanyId,
      tourDoneAt: u.tourDoneAt,
    });
  }
  return out;
}

/** One person, or null when there is no such (non-deleted) account. */
export async function loadPerson(prisma: PrismaClient, id: string): Promise<PersonRecord | null> {
  return (await loadPeople(prisma, [id])).get(id) ?? null;
}

/** A setting's JSON value (system_settings), or null. */
export async function readSetting<T>(prisma: PrismaClient, key: string): Promise<T | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key } });
  return row ? (row.value as T) : null;
}

export async function writeSetting(prisma: PrismaClient, key: string, value: unknown): Promise<void> {
  const v = JSON.parse(JSON.stringify(value));
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
}

/** A JSON column holding a list of strings (roleKeys, companyIds, courseIds) → the list. */
export const stringList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
