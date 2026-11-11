import { daysBetween, shiftDay } from '../../lib/working-days';
import { courseVisible, inScope, type CourseFacts, type LearnerFacts } from './training-access';
import type { TargetKind } from './training-types';

/**
 * Assignments (rulings R4, R6, R7, R8), pure: who a target names, whom an assignment reaches, each
 * person's due day, and the membership-following sync — new matches get it with their own due day,
 * people who no longer match lose that assignment (finished courses are kept; unfinished training with no
 * assignment left is withdrawn unless they started it themselves).
 */

export interface PersonFacts extends LearnerFacts {
  name: string;
  /** ACTIVE and not deleted. */
  active: boolean;
  departmentId: string | null;
  /** Staff: the live projects whose team they are on (owner, named manager or member). */
  teamProjectIds: readonly string[];
  createdAt: Date;
}

export interface AssignmentFacts {
  id: string;
  courseId: string;
  targetKind: TargetKind | string;
  targetId: string;
  mandatory: boolean;
  dueDay: string | null;
  dueDays: number | null;
  /** R8: an onboarding rule's — accounts made after it was set up only. */
  newAccountsOnly: boolean;
  /** R5: a Training manager's companies when they assigned it; null: everyone. */
  scopeCompanyIds: readonly string[] | null;
  createdAt: Date;
  /** The site's day it was made (R6's allowance for a later joiner); default: the UTC day of createdAt. */
  createdDay?: string;
  /** R7: stopped following membership (a rule switched off). */
  frozen: boolean;
}

/** R4: does the target name this person (ignoring whether they can see the course)? */
export function targetMatches(a: { targetKind: string; targetId: string }, p: PersonFacts): boolean {
  switch (a.targetKind) {
    case 'USER':
      return p.id === a.targetId;
    case 'GROUP':
      switch (a.targetId) {
        case 'everyone':
          return !p.client;
        case 'admins':
          return !p.client && p.admin;
        case 'employees':
          return !p.client && !p.admin;
        case 'clients':
          return p.client;
        case 'project-runners':
          return !p.client && p.runsProject;
        case 'training-managers':
          return !p.client && p.trainingManager;
        default:
          return false;
      }
    case 'DEPARTMENT':
      return !p.client && p.departmentId === a.targetId;
    case 'COMPANY':
      return !p.client && p.companyIds.includes(a.targetId);
    case 'PROJECT':
      return !p.client && p.teamProjectIds.includes(a.targetId);
    default:
      return false;
  }
}

/** Named by the target, active, inside the assigner's companies, new enough for a rule — before the course. */
function candidate(a: AssignmentFacts, p: PersonFacts): boolean {
  return p.active && targetMatches(a, p) && inScope(a.scopeCompanyIds, p) && (!a.newAccountsOnly || p.createdAt.getTime() > a.createdAt.getTime());
}

/** R4: the assignment reaches this person (and they may see the course). */
export function reaches(a: AssignmentFacts, course: CourseFacts, p: PersonFacts): boolean {
  return candidate(a, p) && courseVisible(course, p);
}

/** R6: a person's due day — N days after they got it, or a fixed day (a later joiner: the same allowance from joining, ≥ 1 day). */
export function assigneeDueDay(a: { dueDay: string | null; dueDays: number | null }, createdDay: string, joinDay: string): string | null {
  if (a.dueDays !== null && a.dueDays > 0) return shiftDay(joinDay, a.dueDays);
  if (!a.dueDay) return null;
  if (joinDay <= createdDay) return a.dueDay;
  return shiftDay(joinDay, Math.max(1, daysBetween(createdDay, a.dueDay)));
}

export interface ExistingAssignee {
  id: string;
  userId: string;
  withdrawnAt: Date | null;
}

export interface SyncPlan {
  add: { userId: string; mandatory: boolean; dueDay: string | null }[];
  reactivate: { assigneeId: string; userId: string; dueDay: string | null }[];
  withdraw: { assigneeId: string; userId: string }[];
}

/**
 * R7: what syncing one assignment over these people changes. People not in `people` are left alone (the
 * sync for one person passes only them). A frozen assignment, or a course not published, changes nothing.
 */
export function planAssignmentSync(a: AssignmentFacts, course: CourseFacts, people: readonly PersonFacts[], existing: readonly ExistingAssignee[], today: string): SyncPlan {
  const plan: SyncPlan = { add: [], reactivate: [], withdraw: [] };
  if (a.frozen || course.status !== 'PUBLISHED') return plan;
  const createdDay = a.createdDay ?? a.createdAt.toISOString().slice(0, 10);
  const rows = new Map(existing.map((r) => [r.userId, r]));
  for (const p of people) {
    const row = rows.get(p.id);
    if (reaches(a, course, p)) {
      if (!row) plan.add.push({ userId: p.id, mandatory: a.mandatory, dueDay: assigneeDueDay(a, createdDay, today) });
      else if (row.withdrawnAt) plan.reactivate.push({ assigneeId: row.id, userId: p.id, dueDay: assigneeDueDay(a, createdDay, today) });
    } else if (row && !row.withdrawnAt) {
      plan.withdraw.push({ assigneeId: row.id, userId: p.id });
    }
  }
  return plan;
}

/** R7: an enrolment after its assignments changed — kept, withdrawn (hidden) or shown again. */
export function enrolmentAfterSync(e: { completedAt: Date | null; selfStarted: boolean; withdrawnAt: Date | null }, activeAssignees: number): 'keep' | 'withdraw' | 'restore' {
  if (activeAssignees > 0) return e.withdrawnAt ? 'restore' : 'keep';
  if (!e.withdrawnAt && !e.completedAt && !e.selfStarted) return 'withdraw';
  return 'keep';
}

/** The assignment preview: how many it reaches, who can't see the course (skipped), who has it already. */
export function previewReach(a: AssignmentFacts, course: CourseFacts, people: readonly PersonFacts[], enrolled: ReadonlySet<string>): { reach: number; already: number; skipped: { name: string; reason: string }[] } {
  const named = people.filter((p) => candidate(a, p));
  const visible = named.filter((p) => courseVisible(course, p));
  return {
    reach: visible.length,
    already: visible.filter((p) => enrolled.has(p.id)).length,
    skipped: named.filter((p) => !courseVisible(course, p)).map((p) => ({ name: p.name, reason: 'can’t see this course' })),
  };
}
