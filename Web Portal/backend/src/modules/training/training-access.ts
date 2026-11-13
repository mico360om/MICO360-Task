/**
 * Training Center access (rulings R1–R5), pure: who may see a course, who manages training, and whose
 * training a manager may assign, answer and report on. The server asks these on every request; the
 * database facts come from prisma-training-store.ts (people) and the course row.
 */

/** What the rules need to know about a person. */
export interface LearnerFacts {
  id: string;
  /** A client account (role CLIENT only): the Client portal's Help & training. */
  client: boolean;
  admin: boolean;
  /** users.trainingManager (staff only; a client never manages). */
  trainingManager: boolean;
  /** Owner, named manager or MANAGER member of a live project they can see (Management access). */
  runsProject: boolean;
  /** Staff: their ACTIVE companies. Clients: the main companies of their granted live projects. */
  companyIds: readonly string[];
}

export interface CourseFacts {
  audience: string;
  moduleKey: string;
  /** Staff groups (R2); empty: everyone in the audience. */
  roleKeys: readonly string[];
  /** R3: limited to these companies; empty: every company. */
  companyIds: readonly string[];
  status: string;
}

const EVERY_STAFF_MODULE = new Set(['tasks', 'board', 'meetings', 'calendar', 'projects', 'chat', 'mico-ai', 'training', 'general']);

/** R1: may this STAFF member see courses of this module? (Clients' courses are decided by the audience.) */
export function moduleVisible(moduleKey: string, p: LearnerFacts): boolean {
  if (p.client) return false;
  if (moduleKey === 'reports' || moduleKey === 'admin') return p.admin;
  if (moduleKey === 'management') return p.admin || p.runsProject;
  return EVERY_STAFF_MODULE.has(moduleKey);
}

/** R2: the course's staff groups (any one matching is enough; none: everyone). */
export function groupsMatch(roleKeys: readonly string[], p: LearnerFacts): boolean {
  if (roleKeys.length === 0) return true;
  return roleKeys.some(
    (k) => (k === 'admins' && p.admin) || (k === 'employees' && !p.admin) || (k === 'project-runners' && p.runsProject) || (k === 'training-managers' && p.trainingManager),
  );
}

/** R3: limited to companies — staff in one of them (administrators always), clients through their projects. */
export function companiesMatch(companyIds: readonly string[], p: LearnerFacts): boolean {
  if (companyIds.length === 0) return true;
  if (!p.client && p.admin) return true;
  return p.companyIds.some((c) => companyIds.includes(c));
}

/** May this person see the course at all (audience, module, groups, companies)? Its status is not asked. */
export function courseVisible(c: CourseFacts, p: LearnerFacts): boolean {
  if (c.audience === 'CLIENTS') return p.client && companiesMatch(c.companyIds, p);
  if (c.audience !== 'STAFF' || p.client) return false;
  return moduleVisible(c.moduleKey, p) && groupsMatch(c.roleKeys, p) && companiesMatch(c.companyIds, p);
}

/** A published course this person may see: they may take it. */
export function canLearn(c: CourseFacts, p: LearnerFacts): boolean {
  return c.status === 'PUBLISHED' && courseVisible(c, p);
}

/** Training managers and administrators: the Training Center (authoring every course, drafts too). */
export function isManager(p: LearnerFacts): boolean {
  return !p.client && (p.admin || p.trainingManager);
}

/** R5: whose training this person may report on — everyone, their companies' people, their projects' teams. */
export function reportScope(p: LearnerFacts): 'ALL' | 'COMPANIES' | 'TEAM' | null {
  if (p.client) return null;
  if (p.admin) return 'ALL';
  if (p.trainingManager) return 'COMPANIES';
  if (p.runsProject) return 'TEAM';
  return null;
}

/** R5: is this person inside a Training manager's companies? A null scope (an administrator's) is everyone. */
export function inScope(scopeCompanyIds: readonly string[] | null, p: Pick<LearnerFacts, 'companyIds'>): boolean {
  if (scopeCompanyIds === null) return true;
  return p.companyIds.some((c) => scopeCompanyIds.includes(c));
}

/** What the rules need to know about one module of the one course. */
export interface ModuleFacts {
  moduleKey: string;
  roleKeys: readonly string[];
  companyIds: readonly string[];
  enabled: boolean;
}

/**
 * A module is shown when it is on and the person has the feature, the group and the company — never more than their
 * feature access. A client (who only ever sees courses for clients): on and their company — features and staff groups
 * don't apply to them (ruling 13 Nov, Task 3 review).
 */
export function moduleShown(m: ModuleFacts, p: LearnerFacts): boolean {
  if (p.client) return m.enabled && companiesMatch(m.companyIds, p);
  return m.enabled && moduleVisible(m.moduleKey, p) && groupsMatch(m.roleKeys, p) && companiesMatch(m.companyIds, p);
}
