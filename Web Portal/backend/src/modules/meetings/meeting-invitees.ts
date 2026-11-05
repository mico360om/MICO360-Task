import type { PrismaClient } from '@prisma/client';
import { NotFoundError, ValidationError } from '../../lib/http-errors';
import { colleagueWhere, isAdminRoles, type CompanyAccess, type Viewer } from '../companies/company-access';
import type { PersonOption, PersonOptions } from '../companies/person-options';
import { STAFF_ONLY_WHERE, projectMeetingClientIds } from '../clients/client-kind';

/** What a meeting's people come from: its project, or (no project) its company. */
export type InviteTarget = { projectId: string } | { companyId: string | null };

/**
 * Companies (MC1 Ruling 11): who may be invited to a meeting.
 *   - a project meeting: active people in any of the project's active companies whom the inviter
 *     can see — a colleague (sharing a company with them) or a teammate on that project (and themselves);
 *   - a meeting without a project: the inviter's colleagues in the meeting's company;
 *   - administrators: every active person in those companies.
 * Outside guests (by email) are invited as before.
 */
export interface MeetingInvitees {
  candidates(viewer: Viewer, target: InviteTarget): Promise<PersonOption[]>;
  /** Refuses (400) the first of these people who isn't a candidate: "{Name} can't be invited: …". */
  assertInvitable(viewer: Viewer, target: InviteTarget, userIds: readonly string[]): Promise<void>;
}

export const inviteTargetOf = (m: { projectId: string | null; companyId?: string | null }): InviteTarget =>
  m.projectId ? { projectId: m.projectId } : { companyId: m.companyId ?? null };

export function createPrismaMeetingInvitees(prisma: PrismaClient, deps: { companyAccess: CompanyAccess; personOptions: PersonOptions }): MeetingInvitees {
  const { companyAccess } = deps;
  const activeIds = async (where: object): Promise<string[]> =>
    (await prisma.user.findMany({ where: { deletedAt: null, status: 'ACTIVE', ...STAFF_ONLY_WHERE, ...where }, select: { id: true } })).map((u) => u.id);

  async function candidateIds(viewer: Viewer, target: InviteTarget): Promise<Set<string>> {
    const admin = isAdminRoles(viewer.roles);
    if ('projectId' in target) {
      const project = await prisma.project.findFirst({
        where: { id: target.projectId, deletedAt: null },
        select: { ownerId: true, managerId: true, members: { select: { userId: true } }, companies: { where: { company: { status: 'ACTIVE' } }, select: { companyId: true } } },
      });
      if (!project) throw new NotFoundError('Project not found.');
      // Who may ask: someone who can see the project, or (as in 1.20, where an organizer off the team
      // could still add people) someone in one of its active companies — the candidates below are
      // their colleagues there anyway. Anyone else: as if there were no such project.
      if (!(await companyAccess.canSeeProject(viewer, target.projectId))) {
        const mine = new Set(await companyAccess.activeCompanyIds(viewer.id));
        if (!project.companies.some((c) => mine.has(c.companyId))) throw new NotFoundError('Project not found.');
      }
      const inCompanies = await companyAccess.projectCompanyPeople(project.companies.map((c) => c.companyId));
      // 1.23: the project's client accounts that have its Meetings module (marked "Client" in the picker).
      const clients = await projectMeetingClientIds(prisma, target.projectId);
      if (admin) return new Set([...inCompanies, ...clients]);
      const team = new Set([project.ownerId, project.managerId, ...project.members.map((m) => m.userId)].filter((id): id is string => !!id));
      const colleagues = new Set(await activeIds({ id: { in: inCompanies }, ...colleagueWhere(viewer.id) }));
      return new Set([...inCompanies.filter((id) => id === viewer.id || team.has(id) || colleagues.has(id)), ...clients]);
    }
    if (target.companyId) {
      if (!admin) await companyAccess.checkPick(viewer, target.companyId); // one of their own companies
      return new Set(await companyAccess.projectCompanyPeople([target.companyId]));
    }
    // A meeting without a project or company (made before companies): the inviter's colleagues.
    if (admin) return new Set(await activeIds({}));
    return new Set([viewer.id, ...(await activeIds(colleagueWhere(viewer.id)))]);
  }

  return {
    async candidates(viewer, target) {
      return deps.personOptions([...(await candidateIds(viewer, target))]);
    },

    async assertInvitable(viewer, target, userIds) {
      const ids = [...new Set(userIds)];
      if (ids.length === 0) return;
      const allowed = await candidateIds(viewer, target);
      const refused = ids.find((id) => !allowed.has(id));
      if (!refused) return;
      const u = await prisma.user.findUnique({ where: { id: refused }, select: { firstName: true, lastName: true, username: true } });
      const name = (u && (`${u.firstName} ${u.lastName}`.trim() || u.username)) || 'This person';
      throw new ValidationError(`${name} can’t be invited: they aren’t in this meeting’s companies.`, { field: 'userId', userId: refused });
    },
  };
}
