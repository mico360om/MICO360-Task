import type { PrismaClient } from '@prisma/client';
import { HttpError, NotFoundError, ValidationError } from '../../lib/http-errors';
import { isAdminRoles, type Viewer } from './company-access';
import { COMPANY_WORDS, checkProjectCompanyChange, isProjectArchived, type CompanyChangeRefusal } from './company-rules';
import type { WeekStart } from './company-repository';

/**
 * Projects' companies (MC1 Task 7). Every project belongs to one or more companies, the first of
 * them its MAIN company (its branding). Who may put a project where:
 *   - a new project goes into the companies named, else the picked company, else its creator's
 *     primary company, else the site's only active company (Ruling 12);
 *   - administrators may use any active company; the people who run a project may add or take away
 *     only their own companies, and not so that they'd lose the project themselves.
 */

/** One of a project's companies as its payload shows it (main first). Every company uses the site's time zone. */
export interface ApiProjectCompany {
  id: string;
  name: string;
  code: string;
  logoUrl: string | null;
  isMain: boolean;
  timeZone: string;
  weekStart: WeekStart;
}

/** What a project's payload says about its companies. */
export interface ProjectCompanyFacts {
  companies: ApiProjectCompany[];
  mainCompanyId: string | null;
  /** Its own status is ARCHIVED, or every one of its companies is archived. */
  archived: boolean;
}

/** A checked change of a project's companies (`after[0]` is the main company). */
export interface CompanyChangePlan {
  projectId: string;
  /** Its companies before, main first. */
  before: string[];
  mainBefore: string | null;
  after: string[];
  added: { id: string; name: string }[];
  removed: { id: string; name: string }[];
  /** The new main company, when it changed. */
  main: { id: string; name: string } | null;
}

/** The rules the project service asks (create and edit). */
export interface ProjectCompanyRules {
  /** The companies a new project goes into; refused in the rule's words. */
  forNewProject(actor: Viewer, companyIds: string[] | undefined, pick: string | null): Promise<string[]>;
  /** A checked change, or null when nothing would change; refused in the rule's words. */
  planChange(projectId: string, actor: Viewer, companyIds: string[]): Promise<CompanyChangePlan | null>;
  /** Writes a checked change in one transaction. */
  applyChange(plan: CompanyChangePlan): Promise<void>;
}

export interface ProjectCompanies extends ProjectCompanyRules {
  /** The payload facts of these projects. */
  facts(projectIds: string[]): Promise<Map<string, ProjectCompanyFacts>>;
}

/** Someone told about a project whose audience changed (the realtime server re-checks its rooms: MC1 Task 12). */
export type OnProjectAudienceChanged = (projectId: string) => void;

const STATUS: Record<CompanyChangeRefusal, number> = { NO_COMPANY: 400, NOT_YOUR_COMPANY: 403, COMPANY_ARCHIVED: 400, WOULD_LOSE_ACCESS: 409 };
const unique = (ids: readonly string[]) => [...new Set(ids)];

export interface ProjectCompaniesOptions {
  /** The site's time zone and week start (a company's own week start wins). */
  site: () => Promise<{ timeZone: string; weekStart: WeekStart }>;
}

export function createProjectCompanies(prisma: PrismaClient, opts: ProjectCompaniesOptions): ProjectCompanies {
  async function companies(ids: readonly string[]) {
    return prisma.company.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true, status: true } });
  }

  /** Checks a change by the rule (companies must exist), naming the company in a refusal. */
  async function check(actor: Viewer, before: { ids: string[]; mainId: string | null }, after: string[]): Promise<Map<string, string>> {
    const known = await companies(unique([...before.ids, ...after]));
    if (after.some((id) => !known.some((c) => c.id === id))) throw new ValidationError('Company not found.');
    const [mine, active] = await Promise.all([
      prisma.companyMember.findMany({ where: { userId: actor.id, company: { status: 'ACTIVE' } }, select: { companyId: true } }),
      prisma.company.findMany({ where: { status: 'ACTIVE' }, select: { id: true } }),
    ]);
    const verdict = checkProjectCompanyChange({
      actorIsAdmin: isAdminRoles(actor.roles),
      actorCompanyIds: mine.map((m) => m.companyId),
      activeCompanyIds: active.map((c) => c.id),
      before,
      after,
    });
    const names = new Map(known.map((c) => [c.id, c.name]));
    if (!verdict.ok) {
      const message = verdict.code === 'COMPANY_ARCHIVED' ? `${names.get(verdict.companyId!) ?? 'That company'} is archived.` : verdict.message;
      throw new HttpError(message, verdict.code, STATUS[verdict.code]);
    }
    return names;
  }

  async function forNewProject(actor: Viewer, companyIds: string[] | undefined, pick: string | null): Promise<string[]> {
    let ids = unique(companyIds ?? []);
    if (ids.length === 0 && pick) ids = [pick];
    if (ids.length === 0) {
      // Its creator's primary company (while it is active and theirs), else the site's only active company.
      const primary = await prisma.companyMember.findFirst({
        where: { userId: actor.id, company: { status: 'ACTIVE', primaryOf: { some: { id: actor.id } } } },
        select: { companyId: true },
      });
      if (primary) ids = [primary.companyId];
      else {
        const active = await prisma.company.findMany({ where: { status: 'ACTIVE' }, select: { id: true }, take: 2 });
        if (active.length === 1) ids = [active[0]!.id];
      }
    }
    if (ids.length === 0) throw new ValidationError(COMPANY_WORDS.chooseProjectCompany);
    await check(actor, { ids: [], mainId: null }, ids);
    return ids;
  }

  /** The project's companies, main first (then the oldest), or a 404. */
  async function current(projectId: string): Promise<{ ids: string[]; mainId: string | null }> {
    const p = await prisma.project.findFirst({
      where: { id: projectId, deletedAt: null },
      select: { mainCompanyId: true, companies: { select: { companyId: true }, orderBy: [{ addedAt: 'asc' }, { companyId: 'asc' }] } },
    });
    if (!p) throw new NotFoundError('Project not found.');
    const ids = p.companies.map((c) => c.companyId);
    const main = p.mainCompanyId && ids.includes(p.mainCompanyId) ? p.mainCompanyId : (ids[0] ?? null);
    return { ids: main ? [main, ...ids.filter((id) => id !== main)] : ids, mainId: main };
  }

  async function planChange(projectId: string, actor: Viewer, companyIds: string[]): Promise<CompanyChangePlan | null> {
    const before = await current(projectId);
    const after = unique(companyIds);
    if (after.length === before.ids.length && after.every((id) => before.ids.includes(id)) && after[0] === before.mainId) return null;
    const names = await check(actor, before, after);
    const named = (id: string) => ({ id, name: names.get(id) ?? id });
    return {
      projectId,
      before: before.ids,
      mainBefore: before.mainId,
      after,
      added: after.filter((id) => !before.ids.includes(id)).map(named),
      removed: before.ids.filter((id) => !after.includes(id)).map(named),
      main: after[0] !== before.mainId ? named(after[0]!) : null,
    };
  }

  async function applyChange(plan: CompanyChangePlan): Promise<void> {
    await prisma.$transaction([
      ...(plan.added.length ? [prisma.projectCompany.createMany({ data: plan.added.map((c) => ({ projectId: plan.projectId, companyId: c.id })), skipDuplicates: true })] : []),
      ...(plan.removed.length ? [prisma.projectCompany.deleteMany({ where: { projectId: plan.projectId, companyId: { in: plan.removed.map((c) => c.id) } } })] : []),
      prisma.project.update({ where: { id: plan.projectId }, data: { mainCompanyId: plan.after[0]! } }),
    ]);
  }

  async function facts(projectIds: string[]): Promise<Map<string, ProjectCompanyFacts>> {
    const ids = unique(projectIds);
    if (ids.length === 0) return new Map();
    const [rows, site] = await Promise.all([
      prisma.project.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          status: true,
          mainCompanyId: true,
          companies: {
            select: { company: { select: { id: true, name: true, code: true, logoUrl: true, weekStart: true, status: true } } },
            orderBy: [{ addedAt: 'asc' }, { companyId: 'asc' }],
          },
        },
      }),
      opts.site(),
    ]);
    return new Map(
      rows.map((p) => {
        const list = p.companies.map((c) => c.company);
        const main = list.find((c) => c.id === p.mainCompanyId) ?? list[0];
        const ordered = main ? [main, ...list.filter((c) => c !== main)] : list;
        return [
          p.id,
          {
            companies: ordered.map((c) => ({
              id: c.id,
              name: c.name,
              code: c.code,
              logoUrl: c.logoUrl,
              isMain: c === main,
              timeZone: site.timeZone,
              weekStart: c.weekStart === 0 || c.weekStart === 1 || c.weekStart === 6 ? c.weekStart : site.weekStart,
            })),
            mainCompanyId: main?.id ?? null,
            archived: isProjectArchived({ status: p.status, companies: list }),
          },
        ];
      }),
    );
  }

  return { forNewProject, planChange, applyChange, facts };
}
