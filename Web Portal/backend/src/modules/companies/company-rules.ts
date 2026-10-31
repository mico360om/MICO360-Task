/**
 * Companies: the pure rules and their words (no database). Several companies share one site; people
 * and projects belong to companies, and a non-admin sees a project only inside a company they share
 * with it. The query pieces and the access service built on these live in company-access.ts.
 */

export type CompanyStatus = 'ACTIVE' | 'ARCHIVED';

/** A company's short code: 2–10 capital letters or digits (typed in any case, see normalizeCompanyCode). */
export const COMPANY_CODE = /^[A-Z0-9]{2,10}$/;

export function normalizeCompanyCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/**
 * A project counts as archived when its own status is ARCHIVED, or when it has companies and every
 * one of them is archived. Nothing is written onto the project: unarchiving the company restores it.
 */
export function isProjectArchived(p: { status: string; companies: readonly { status: CompanyStatus }[] }): boolean {
  if (p.status === 'ARCHIVED') return true;
  return p.companies.length > 0 && p.companies.every((c) => c.status === 'ARCHIVED');
}

export function sharesCompany(a: readonly string[], b: readonly string[]): boolean {
  const set = new Set(a);
  return b.some((id) => set.has(id));
}

/** The words people see (website English). */
export const COMPANY_WORDS = {
  notAvailable: 'You no longer have access to this company.',
  notColleague: 'You can only message people who share a company with you.',
  inviteeOnly: 'You can see this meeting because you were invited; its notes stay with the project’s team.',
  lastActive: 'You can’t archive the last active company.',
  noCompany: 'A project needs at least one company.',
  notYours: 'You can only add or remove your own companies.',
  loseAccess: 'You’d lose access to this project. Ask an administrator to make this change.',
  chooseProjectCompany: 'Choose at least one company for this project.',
  chooseUserCompany: 'Choose at least one company.',
  meetingCompany: 'Pick the company this meeting belongs to.',
} as const;

/** A direct chat that has become read-only: "You no longer share a company with Sara." */
export function dmReadOnlyMessage(name: string): string {
  return `You no longer share a company with ${name}.`;
}

export type CompanyChangeRefusal = 'NO_COMPANY' | 'NOT_YOUR_COMPANY' | 'COMPANY_ARCHIVED' | 'WOULD_LOSE_ACCESS';

/**
 * May this person change a project's companies from `before` to `after` (`after[0]` is the main one)?
 * Checked in this order:
 *   1. `after` is empty → NO_COMPANY;
 *   2. an added company isn't active → COMPANY_ARCHIVED (the service names the company);
 *   3. (non-admins) a company added or removed, or a new main company, isn't one of theirs → NOT_YOUR_COMPANY;
 *   4. (non-admins) `after` holds none of their companies, so they'd lose the project → WOULD_LOSE_ACCESS.
 * `actorCompanyIds` are the person's ACTIVE companies; `activeCompanyIds` every active company on the site.
 */
export function checkProjectCompanyChange(c: {
  actorIsAdmin: boolean;
  actorCompanyIds: readonly string[];
  activeCompanyIds: readonly string[];
  before: { ids: readonly string[]; mainId: string | null };
  after: readonly string[];
}): { ok: true } | { ok: false; code: CompanyChangeRefusal; message: string; companyId?: string } {
  if (c.after.length === 0) return { ok: false, code: 'NO_COMPANY', message: COMPANY_WORDS.noCompany };
  const before = new Set(c.before.ids);
  const after = new Set(c.after);
  const added = [...after].filter((id) => !before.has(id));
  const removed = [...before].filter((id) => !after.has(id));
  const active = new Set(c.activeCompanyIds);
  const archived = added.find((id) => !active.has(id));
  if (archived) return { ok: false, code: 'COMPANY_ARCHIVED', message: 'That company is archived.', companyId: archived };
  if (c.actorIsAdmin) return { ok: true };

  const mine = new Set(c.actorCompanyIds);
  const notMine = [...added, ...removed].find((id) => !mine.has(id));
  if (notMine) return { ok: false, code: 'NOT_YOUR_COMPANY', message: COMPANY_WORDS.notYours, companyId: notMine };
  const main = c.after[0]!;
  if (main !== c.before.mainId && !mine.has(main)) return { ok: false, code: 'NOT_YOUR_COMPANY', message: COMPANY_WORDS.notYours, companyId: main };
  if (!sharesCompany(c.actorCompanyIds, c.after)) return { ok: false, code: 'WOULD_LOSE_ACCESS', message: COMPANY_WORDS.loseAccess };
  return { ok: true };
}
