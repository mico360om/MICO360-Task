import type { EnrolmentStatus, ReportBy, ReportRow } from './training-types';
import { markPaper, type Paper, type StoredQuestion } from './training-quiz';

/**
 * The Reports page's figures (owner request), pure: participation, completion, overdue and quiz scores by
 * course, person, department, role, company or project. The service decides whose enrolments are in
 * scope (R5: everyone, a Training manager's companies, a project manager's team).
 */

export interface ReportEnrolment {
  userId: string;
  courseId: string;
  status: EnrolmentStatus;
  assigned: boolean;
  started: boolean;
  overdue: boolean;
  /** The average of their best score on each quiz of the course they tried; null: none tried. */
  bestScore: number | null;
}

export interface ReportPerson {
  id: string;
  name: string;
  client: boolean;
  admin: boolean;
  departmentId: string | null;
  companyIds: readonly string[];
  teamProjectIds: readonly string[];
}

export interface ReportLabels {
  course: ReadonlyMap<string, string>;
  department: ReadonlyMap<string, string>;
  company: ReadonlyMap<string, string>;
  project: ReadonlyMap<string, string>;
}

const NONE = { department: 'No department', company: 'No company', project: 'No project' } as const;

function groupsOf(by: ReportBy, e: ReportEnrolment, p: ReportPerson | undefined, labels: ReportLabels): { key: string; label: string }[] {
  switch (by) {
    case 'course':
      return [{ key: e.courseId, label: labels.course.get(e.courseId) ?? 'Course' }];
    case 'person':
      return [{ key: e.userId, label: p?.name ?? 'Someone' }];
    case 'department':
      return p?.departmentId ? [{ key: p.departmentId, label: labels.department.get(p.departmentId) ?? 'Department' }] : [{ key: 'none', label: NONE.department }];
    case 'role':
      return p?.client ? [{ key: 'clients', label: 'Clients' }] : p?.admin ? [{ key: 'admins', label: 'Administrators' }] : [{ key: 'employees', label: 'Employees' }];
    case 'company': {
      const ids = p?.companyIds ?? [];
      return ids.length ? ids.map((id) => ({ key: id, label: labels.company.get(id) ?? 'Company' })) : [{ key: 'none', label: NONE.company }];
    }
    case 'project': {
      const ids = p?.teamProjectIds ?? [];
      return ids.length ? ids.map((id) => ({ key: id, label: labels.project.get(id) ?? 'Project' })) : [{ key: 'none', label: NONE.project }];
    }
  }
}

const completedStatus = (s: EnrolmentStatus) => s === 'COMPLETED' || s === 'REVIEW';

function rowOf(key: string, label: string, list: readonly ReportEnrolment[]): ReportRow {
  const completed = list.filter((e) => completedStatus(e.status)).length;
  const scores = list.map((e) => e.bestScore).filter((s): s is number => s !== null);
  return {
    key,
    label,
    people: list.length,
    assigned: list.filter((e) => e.assigned).length,
    started: list.filter((e) => e.started || e.status !== 'NOT_STARTED').length,
    completed,
    overdue: list.filter((e) => e.overdue).length,
    completionRate: list.length ? Math.round((completed / list.length) * 100) : null,
    averageScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
    enrolments: list.length,
    selfStarted: list.filter((e) => e.started && !e.assigned).length,
  };
}

export function aggregateReport(by: ReportBy, enrolments: readonly ReportEnrolment[], people: readonly ReportPerson[], labels: ReportLabels): { totals: ReportRow; rows: ReportRow[] } {
  const person = new Map(people.map((p) => [p.id, p]));
  const groups = new Map<string, { label: string; list: ReportEnrolment[] }>();
  for (const e of enrolments) {
    for (const g of groupsOf(by, e, person.get(e.userId), labels)) {
      const entry = groups.get(g.key) ?? { label: g.label, list: [] };
      entry.list.push(e);
      groups.set(g.key, entry);
    }
  }
  const rows = [...groups.entries()].map(([key, g]) => rowOf(key, g.label, g.list)).sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
  return { totals: rowOf('all', 'All', enrolments), rows };
}

/** A quiz's questions: how often each was on a handed-in paper, and the share answered right. */
export function quizQuestionStats(questions: readonly StoredQuestion[], attempts: readonly { paper: Paper; answers: Record<string, string[]> }[]): { id: string; prompt: string; answered: number; rightPct: number | null }[] {
  return [...questions]
    .sort((a, b) => a.position - b.position)
    .map((q) => {
      let answered = 0;
      let right = 0;
      for (const a of attempts) {
        const onPaper = a.paper.questions.find((x) => x.id === q.id);
        if (!onPaper) continue;
        answered++;
        if (markPaper({ passMark: 0, questions: [onPaper] }, { [q.id]: a.answers[q.id] ?? [] }).right === 1) right++;
      }
      return { id: q.id, prompt: q.prompt, answered, rightPct: answered ? Math.round((right / answered) * 100) : null };
    });
}
