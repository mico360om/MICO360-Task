import { isProjectArchived } from './company-rules';
import type { CompanyPerson, CompanyProject, CompanyRecord, CompanyRepository } from './company-repository';
import type { UserStatus } from '../users/user-repository';

interface Person {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  status: UserStatus;
  deleted: boolean;
  primaryCompanyId: string | null;
}
interface Project {
  id: string;
  code: string;
  name: string;
  status: string;
  deleted: boolean;
  companyIds: string[];
  mainCompanyId: string | null;
}

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);
const personName = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`;

/** Companies in memory, with the same rules as the Prisma repository (unit tests). */
export function createMemoryCompanyRepository() {
  const companies = new Map<string, CompanyRecord>();
  const members: { companyId: string; userId: string; addedAt: number }[] = [];
  const people = new Map<string, Person>();
  const projects = new Map<string, Project>();
  let seq = 0;
  let clock = 0;

  const company = (id: string) => {
    const c = companies.get(id);
    if (!c) throw new Error(`no company ${id}`);
    return c;
  };

  const repo: CompanyRepository = {
    async list() {
      return [...companies.values()].sort(byName);
    },
    async findById(id) {
      return companies.get(id) ?? null;
    },
    async findByName(name) {
      return [...companies.values()].find((c) => c.name.toLowerCase() === name.toLowerCase()) ?? null;
    },
    async findByCode(code) {
      return [...companies.values()].find((c) => c.code === code) ?? null;
    },
    async create(data) {
      const now = new Date();
      const rec: CompanyRecord = {
        id: `co${++seq}`,
        name: data.name,
        code: data.code,
        logoUrl: null,
        weekStart: data.weekStart ?? null,
        workingHours: data.workingHours ?? null,
        senderName: data.senderName ?? null,
        status: 'ACTIVE',
        archivedAt: null,
        createdById: data.createdById,
        createdAt: now,
        updatedAt: now,
      };
      companies.set(rec.id, rec);
      return rec;
    },
    async update(id, patch) {
      const next = { ...company(id), ...patch, updatedAt: new Date() };
      companies.set(id, next);
      return next;
    },
    async countActive() {
      return [...companies.values()].filter((c) => c.status === 'ACTIVE').length;
    },
    async counts(ids) {
      return new Map(
        ids.map((id) => [
          id,
          {
            people: members.filter((m) => m.companyId === id && people.get(m.userId)?.deleted !== true).length,
            projects: [...projects.values()].filter((p) => !p.deleted && p.companyIds.includes(id)).length,
          },
        ]),
      );
    },
    async memberIds(companyId) {
      return members.filter((m) => m.companyId === companyId).map((m) => m.userId);
    },
    async projectIds(companyId) {
      return [...projects.values()].filter((p) => p.companyIds.includes(companyId)).map((p) => p.id);
    },
    async people(companyId) {
      return members
        .filter((m) => m.companyId === companyId)
        .flatMap((m) => {
          const p = people.get(m.userId);
          return p && !p.deleted ? [p] : [];
        })
        .sort((a, b) => personName(a).localeCompare(personName(b)))
        .map((p): CompanyPerson => ({ id: p.id, firstName: p.firstName, lastName: p.lastName, username: p.username, email: p.email, status: p.status, isPrimary: p.primaryCompanyId === companyId }));
    },
    async projects(companyId) {
      return [...projects.values()]
        .filter((p) => !p.deleted && p.companyIds.includes(companyId))
        .sort(byName)
        .map((p): CompanyProject => ({
          id: p.id,
          code: p.code,
          name: p.name,
          isMain: p.mainCompanyId === companyId,
          archived: isProjectArchived({ status: p.status, companies: p.companyIds.map((id) => ({ status: company(id).status })) }),
        }));
    },
    async activeOf(userId) {
      return members
        .filter((m) => m.userId === userId)
        .map((m) => company(m.companyId))
        .filter((c) => c.status === 'ACTIVE')
        .sort(byName);
    },
    async primaryOf(userId) {
      return people.get(userId)?.primaryCompanyId ?? null;
    },
    async addMembers(companyId, userIds) {
      company(companyId);
      let added = 0;
      for (const userId of new Set(userIds)) {
        if (members.some((m) => m.companyId === companyId && m.userId === userId)) continue;
        members.push({ companyId, userId, addedAt: ++clock });
        added += 1;
      }
      return added;
    },
    async removeMember(companyId, userId) {
      const at = members.findIndex((m) => m.companyId === companyId && m.userId === userId);
      if (at < 0) return false;
      members.splice(at, 1);
      return true;
    },
  };

  return {
    repo,
    addPerson(p: { id: string; firstName: string; lastName: string; username: string; email: string; status?: UserStatus; deleted?: boolean }) {
      people.set(p.id, { status: 'ACTIVE', deleted: false, primaryCompanyId: null, ...p });
    },
    setPrimary(userId: string, companyId: string | null) {
      const p = people.get(userId);
      if (p) p.primaryCompanyId = companyId;
    },
    addProject(p: { id: string; code: string; name: string; companyIds: string[]; status?: string; deleted?: boolean }) {
      projects.set(p.id, { status: 'ACTIVE', deleted: false, mainCompanyId: p.companyIds[0] ?? null, ...p });
    },
    /** The company's people, oldest membership first. */
    membersOf: (companyId: string) => members.filter((m) => m.companyId === companyId).map((m) => m.userId),
  };
}
