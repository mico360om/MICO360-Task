import type { Prisma, PrismaClient } from '@prisma/client';
import { NotFoundError, ValidationError } from '../../lib/http-errors';
import type { CreateAuditData } from '../audit/audit-repository';
import type { UserService } from '../users/user-service';
import type { TemporaryPasswordMark } from '../users/user-repository';
import { ARCHIVE_SELECT, archivedOf } from '../companies/project-archive';
import { CLIENT_ONLY_WHERE, CLIENT_ROLE } from './client-kind';
import { GRANT_WORDS, grantOf, grantRows, grantWords, type ClientGrant, type GrantRow } from './client-grants';
import { accountProblems, organisationProblem, phoneProblem } from '../../lib/account-rules';
import { fieldProblem } from '../users/user-service';
import { liveInvitation, onboardingStatus, type OnboardingStatus } from '../users/onboarding-status';

/**
 * 1.23 Client accounts, for administrators: the Clients page and User Management's Role "Client" (one
 * editor, one API). A client is a user account with only the CLIENT role, their organisation and phone,
 * and per project the modules and actions ticked for them. Status, delete, password and the welcome
 * email are User Management's own routes (/users/:id/…), which work for clients too.
 */
export interface ClientProjectAccess extends ClientGrant {
  code: string;
  name: string;
  /** Its main company's name. */
  company: string | null;
  /** Archived (its own status or all its companies): the portal doesn't show it. */
  archived: boolean;
}

export interface ClientAccountView {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  organisation: string | null;
  phone: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  locked: boolean;
  lastLoginAt: Date | null;
  welcomeSentAt: Date | null;
  /** Onboarding: first invitation, the account became theirs, the address confirmed, the live invitation's end. */
  invitedAt: Date | null;
  activatedAt: Date | null;
  emailVerifiedAt: Date | null;
  inviteExpiresAt: Date | null;
  /** Onboarding: Invited / Invite expired / Active / Locked / Deactivated (1.23.6: and cancelled / temp expired). */
  onboarding: OnboardingStatus;
  /** 1.23.6: a temporary password still to be changed; when and by whom it was set (never the value). */
  mustChangePassword: boolean;
  temporaryPasswordSetAt: Date | null;
  temporaryPasswordSetBy: { id: string; name: string } | null;
  temporaryPasswordExpiresAt: Date | null;
  invitationCancelledAt: Date | null;
  createdAt: Date;
  roles: string[];
  projects: ClientProjectAccess[];
}

export interface NewClientInput {
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  password?: string;
  /** 1.23.6: the password is a temporary one (changed at the first sign-in). */
  temporary?: TemporaryPasswordMark;
  organisation?: string | null;
  phone?: string | null;
  projects?: ClientGrant[];
}

export interface ClientPatch {
  firstName?: string;
  lastName?: string;
  username?: string;
  email?: string;
  organisation?: string | null;
  phone?: string | null;
  /** Exactly these projects (absent: unchanged). */
  projects?: ClientGrant[];
}

export interface ClientAccountsDeps {
  prisma: PrismaClient;
  userService: Pick<UserService, 'createUser' | 'updateUser' | 'getUser'>;
  audit?: { record(entry: CreateAuditData): Promise<unknown> };
  now?: () => Date;
}

const accountSelect = {
  id: true,
  firstName: true,
  lastName: true,
  username: true,
  email: true,
  organisation: true,
  phone: true,
  status: true,
  lockedUntil: true,
  lastLoginAt: true,
  welcomeSentAt: true,
  invitedAt: true,
  activatedAt: true,
  emailVerifiedAt: true,
  mustChangePassword: true,
  temporaryPasswordSetAt: true,
  temporaryPasswordExpiresAt: true,
  invitationCancelledAt: true,
  temporaryPasswordSetBy: { select: { id: true, firstName: true, lastName: true, username: true } },
  loginOtps: liveInvitation(new Date(0)),
  createdAt: true,
  roles: { select: { role: { select: { name: true } } } },
  clientGrants: {
    select: {
      projectId: true,
      progress: true,
      meetings: true,
      canComment: true,
      canSignOff: true,
      canRespond: true,
      canDownload: true,
      project: { select: { code: true, name: true, deletedAt: true, mainCompany: { select: { name: true } }, ...ARCHIVE_SELECT } },
    },
  },
} as const satisfies Prisma.UserSelect;
type AccountRow = Prisma.UserGetPayload<{ select: typeof accountSelect }>;
/** The select, with "the invitation still works" judged now. */
const selectNow = () => ({ ...accountSelect, loginOtps: liveInvitation(new Date()) });

const blank = (v: string | null | undefined) => {
  const t = (v ?? '').trim();
  return t ? t : null;
};

export function createClientAccounts(deps: ClientAccountsDeps) {
  const { prisma } = deps;
  const now = deps.now ?? (() => new Date());

  function view(u: AccountRow): ClientAccountView {
    const at = now().getTime();
    const locked = !!u.lockedUntil && u.lockedUntil.getTime() > at;
    const inviteExpiresAt = u.loginOtps[0]?.expiresAt ?? null;
    return {
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      username: u.username,
      email: u.email,
      organisation: u.organisation ?? null,
      phone: u.phone ?? null,
      status: u.status,
      locked,
      lastLoginAt: u.lastLoginAt ?? null,
      welcomeSentAt: u.welcomeSentAt ?? null,
      invitedAt: u.invitedAt ?? null,
      activatedAt: u.activatedAt ?? null,
      emailVerifiedAt: u.emailVerifiedAt ?? null,
      inviteExpiresAt,
      onboarding: onboardingStatus(
        {
          status: u.status,
          locked,
          activatedAt: u.activatedAt,
          lastLoginAt: u.lastLoginAt,
          invitedAt: u.invitedAt,
          welcomeSentAt: u.welcomeSentAt,
          inviteExpiresAt,
          mustChangePassword: u.mustChangePassword,
          temporaryPasswordExpiresAt: u.temporaryPasswordExpiresAt,
          invitationCancelledAt: u.invitationCancelledAt,
        },
        now(),
      ),
      mustChangePassword: u.mustChangePassword,
      temporaryPasswordSetAt: u.temporaryPasswordSetAt,
      temporaryPasswordSetBy: u.temporaryPasswordSetBy
        ? { id: u.temporaryPasswordSetBy.id, name: `${u.temporaryPasswordSetBy.firstName} ${u.temporaryPasswordSetBy.lastName}`.trim() || u.temporaryPasswordSetBy.username }
        : null,
      temporaryPasswordExpiresAt: u.temporaryPasswordExpiresAt,
      invitationCancelledAt: u.invitationCancelledAt,
      createdAt: u.createdAt,
      roles: u.roles.map((r) => r.role.name),
      projects: u.clientGrants
        .filter((g) => g.project.deletedAt === null)
        .map((g) => ({
          ...grantOf(g),
          code: g.project.code,
          name: g.project.name,
          company: g.project.mainCompany?.name ?? null,
          archived: archivedOf({ status: g.project.status, companies: g.project.companies }),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  /** A client account (404 for anyone else, or a deleted one). */
  async function get(id: string): Promise<ClientAccountView> {
    const u = await prisma.user.findFirst({ where: { id, deletedAt: null, ...CLIENT_ONLY_WHERE }, select: selectNow() });
    if (!u) throw new NotFoundError('Client not found.');
    return view(u);
  }

  /** The projects a grant list names must exist and not be deleted (400 otherwise). */
  async function checkProjects(rows: GrantRow[]): Promise<void> {
    if (rows.length === 0) return;
    const ids = rows.map((r) => r.projectId);
    const found = await prisma.project.count({ where: { id: { in: ids }, deletedAt: null } });
    if (found !== ids.length) throw new ValidationError(GRANT_WORDS.unknownProject, { field: 'projects' });
  }

  async function writeGrants(userId: string, rows: GrantRow[], actorId: string): Promise<void> {
    await prisma.$transaction([
      prisma.clientProjectGrant.deleteMany({ where: { userId, projectId: { notIn: rows.map((r) => r.projectId) } } }),
      ...rows.map(({ projectId, ...ticks }) =>
        prisma.clientProjectGrant.upsert({
          where: { userId_projectId: { userId, projectId } },
          update: ticks,
          create: { userId, projectId, ...ticks, createdById: actorId },
        }),
      ),
    ]);
  }

  const audit = async (entry: Omit<CreateAuditData, 'module'>) => {
    await deps.audit?.record({ module: 'clients', ...entry });
  };
  const grantsForLog = (projects: ClientProjectAccess[] | GrantRow[]) =>
    projects.map((p) => {
      const r = 'modules' in p ? { projectId: p.projectId, progress: p.modules.progress, meetings: p.modules.meetings, canComment: p.actions.comment, canSignOff: p.actions.signOff, canRespond: p.actions.respond, canDownload: p.actions.download } : p;
      return { projectId: r.projectId, access: grantWords(r) };
    });

  return {
    get,

    async list(): Promise<ClientAccountView[]> {
      const rows = await prisma.user.findMany({ where: { deletedAt: null, ...CLIENT_ONLY_WHERE }, select: selectNow(), orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }] });
      return rows.map(view);
    },

    /** Projects an administrator may give a client: every live project, A–Z. */
    async projectOptions(): Promise<{ id: string; code: string; name: string; company: string | null }[]> {
      const rows = await prisma.project.findMany({
        where: { deletedAt: null },
        select: { id: true, code: true, name: true, mainCompany: { select: { name: true } }, ...ARCHIVE_SELECT },
        orderBy: { name: 'asc' },
        take: 2000,
      });
      return rows.filter((p) => !archivedOf(p)).map((p) => ({ id: p.id, code: p.code, name: p.name, company: p.mainCompany?.name ?? null }));
    },

    /** Make a client account (no companies, the Client role only) with its projects. */
    async create(input: NewClientInput, actor: { id: string; ip?: string | null }): Promise<ClientAccountView> {
      // Onboarding: the detail rules the form shows (an organisation is required for a client).
      const problems = accountProblems(
        { firstName: input.firstName, lastName: input.lastName, email: input.email, username: input.username, phone: input.phone ?? null, organisation: input.organisation ?? null },
        { client: true },
      );
      const [badField, problem] = Object.entries(problems)[0] ?? [];
      if (badField && problem) throw fieldProblem(badField, problem);
      const rows = grantRows(input.projects ?? []);
      await checkProjects(rows);
      const user = await deps.userService.createUser({
        email: input.email,
        username: input.username,
        firstName: input.firstName,
        lastName: input.lastName,
        ...(input.password ? { password: input.password } : {}),
        ...(input.password && input.temporary ? { temporary: input.temporary } : {}),
        roleNames: [CLIENT_ROLE],
      });
      await prisma.user.update({ where: { id: user.id }, data: { organisation: blank(input.organisation), phone: blank(input.phone) } });
      await writeGrants(user.id, rows, actor.id);
      const created = await get(user.id);
      await audit({
        userId: actor.id,
        ip: actor.ip ?? null,
        action: 'client.create',
        entityId: user.id,
        newValue: { email: created.email, username: created.username, organisation: created.organisation, projects: grantsForLog(rows) },
      });
      return created;
    },

    /** Change a client's details and (when given) exactly which projects they have, with what. */
    async update(id: string, patch: ClientPatch, actor: { id: string; ip?: string | null }): Promise<ClientAccountView> {
      const before = await get(id);
      // Onboarding: the rules bite on what changes (an older phone still saves); an organisation once set
      // can't be emptied.
      if (patch.phone !== undefined && (blank(patch.phone) ?? null) !== before.phone) {
        const problem = phoneProblem(patch.phone);
        if (problem) throw fieldProblem('phone', problem);
      }
      if (patch.organisation !== undefined && (blank(patch.organisation) ?? null) !== before.organisation) {
        const problem = organisationProblem(patch.organisation, before.organisation !== null);
        if (problem) throw fieldProblem('organisation', problem);
      }
      const rows = patch.projects !== undefined ? grantRows(patch.projects) : null;
      if (rows) await checkProjects(rows);
      const details = {
        ...(patch.firstName !== undefined ? { firstName: patch.firstName } : {}),
        ...(patch.lastName !== undefined ? { lastName: patch.lastName } : {}),
        ...(patch.username !== undefined ? { username: patch.username } : {}),
        ...(patch.email !== undefined ? { email: patch.email } : {}),
      };
      // Through User Management's own rules (unique email and username, links ended on an email change).
      if (Object.keys(details).length) await deps.userService.updateUser(id, details, { id: actor.id, ip: actor.ip ?? null });
      if (patch.organisation !== undefined || patch.phone !== undefined) {
        await prisma.user.update({
          where: { id },
          data: { ...(patch.organisation !== undefined ? { organisation: blank(patch.organisation) } : {}), ...(patch.phone !== undefined ? { phone: blank(patch.phone) } : {}) },
        });
      }
      if (rows) await writeGrants(id, rows, actor.id);
      const after = await get(id);
      const changedDetails = { ...details, ...(patch.organisation !== undefined ? { organisation: after.organisation } : {}), ...(patch.phone !== undefined ? { phone: after.phone } : {}) };
      // Onboarding: which details really changed, by name.
      const changed = (['firstName', 'lastName', 'username', 'email', 'organisation', 'phone'] as const).filter((k) => before[k] !== after[k]);
      if (Object.keys(changedDetails).length) await audit({ userId: actor.id, ip: actor.ip ?? null, action: 'client.update', entityId: id, newValue: { ...changedDetails, changed } });
      if (rows && JSON.stringify(grantsForLog(before.projects)) !== JSON.stringify(grantsForLog(after.projects))) {
        await audit({ userId: actor.id, ip: actor.ip ?? null, action: 'client.projects', entityId: id, oldValue: grantsForLog(before.projects), newValue: grantsForLog(after.projects) });
      }
      return after;
    },

    /**
     * "Clients with access" on a project's page: who may open it in the Client portal and what each may
     * do. Only active client accounts; their email and organisation, never anything of the portal itself.
     */
    async forProject(projectId: string): Promise<{ id: string; name: string; organisation: string | null; email: string; status: string; access: string[]; modules: ClientGrant['modules']; actions: ClientGrant['actions'] }[]> {
      const rows = await prisma.clientProjectGrant.findMany({
        where: { projectId, user: { deletedAt: null, ...CLIENT_ONLY_WHERE } },
        select: {
          projectId: true,
          progress: true,
          meetings: true,
          canComment: true,
          canSignOff: true,
          canRespond: true,
          canDownload: true,
          user: { select: { id: true, firstName: true, lastName: true, email: true, organisation: true, status: true } },
        },
      });
      return rows
        .map((r) => {
          const g = grantOf(r);
          return { id: r.user.id, name: `${r.user.firstName} ${r.user.lastName}`.trim(), organisation: r.user.organisation ?? null, email: r.user.email, status: r.user.status, access: grantWords(r), modules: g.modules, actions: g.actions };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  };
}

export type ClientAccounts = ReturnType<typeof createClientAccounts>;
