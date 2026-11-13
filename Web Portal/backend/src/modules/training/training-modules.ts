/**
 * Learning Hub as one course (1.23.30), pure: which modules (units) a person sees, how far they are in each,
 * where Continue goes, and the plain words for who sees a module. The database facts come from the store.
 */
import { moduleShown, type LearnerFacts, type ModuleFacts } from './training-access';
import { isCourseComplete, type LessonFacts } from './training-state';
import type { CompletionRule, LessonKind } from './training-types';

/** Id of the "Other lessons" unit (lessons with no module in a course that has modules). */
export const OTHER_UNIT = 'other';

export interface UnitLesson {
  id: string;
  kind: LessonKind;
  moduleId: string | null;
}

export interface Unit {
  id: string;
  title: string;
  position: number;
  lessonIds: string[];
}

/** Modules shown to the person (with at least one visible lesson), in position order, then OTHER_UNIT when loose lessons exist. Plain course (no modules): []. */
export function unitsFor(
  modules: readonly (ModuleFacts & { id: string; title: string; position: number })[],
  lessons: readonly UnitLesson[],
  p: LearnerFacts,
): Unit[] {
  if (modules.length === 0) return [];
  const known = new Set(modules.map((m) => m.id));
  const units: Unit[] = [];
  const sorted = [...modules].sort((a, b) => a.position - b.position);
  for (const m of sorted) {
    if (!moduleShown(m, p)) continue;
    const ids = lessons.filter((l) => l.moduleId === m.id).map((l) => l.id);
    if (ids.length > 0) units.push({ id: m.id, title: m.title, position: m.position, lessonIds: ids });
  }
  const loose = lessons.filter((l) => l.moduleId === null || !known.has(l.moduleId)).map((l) => l.id);
  if (loose.length > 0) {
    const last = sorted[sorted.length - 1]!.position;
    units.push({ id: OTHER_UNIT, title: 'Other lessons', position: last + 1, lessonIds: loose });
  }
  return units;
}

/** The lessons of `units` in course order — the person's visible lessons. */
export function orderedLessonIds(units: readonly Unit[]): string[] {
  return units.flatMap((u) => u.lessonIds);
}

export interface UnitProgress {
  unitId: string;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'DONE';
  lessonsDone: number;
  lessonCount: number;
  doneAt: Date | null;
}

/** Done when recorded (doneAt on or after `since`) or every needed lesson done under the completion rule. */
export function unitProgress(
  u: Unit,
  rule: CompletionRule | string,
  lessons: readonly LessonFacts[],
  doneIds: ReadonlySet<string>,
  lessonDoneAt: ReadonlyMap<string, Date>,
  recorded: Date | null,
  since: Date | null,
): UnitProgress {
  const lessonsDone = lessons.filter((l) => doneIds.has(l.id)).length;
  const recordedCounts = recorded !== null && (since === null || recorded.getTime() >= since.getTime());
  const computed = isCourseComplete(rule, lessons, doneIds);
  const base = { unitId: u.id, lessonsDone, lessonCount: lessons.length };
  if (recordedCounts) return { ...base, status: 'DONE', doneAt: recorded };
  if (computed) {
    let latest: Date | null = null;
    for (const l of lessons) {
      const at = lessonDoneAt.get(l.id);
      if (at && (!latest || at.getTime() > latest.getTime())) latest = at;
    }
    return { ...base, status: 'DONE', doneAt: latest };
  }
  return { ...base, status: lessonsDone > 0 ? 'IN_PROGRESS' : 'NOT_STARTED', doneAt: null };
}

export function allUnitsDone(list: readonly UnitProgress[]): boolean {
  return list.length > 0 && list.every((x) => x.status === 'DONE');
}

/** Continue: the first unit not done (in order) → the lesson the person last opened if not done there, else its first not-done lesson; null when all done. */
export function continueTarget(
  units: readonly Unit[],
  progress: readonly UnitProgress[],
  doneIds: ReadonlySet<string>,
  lastLessonId: string | null,
): { unitId: string; lessonId: string } | null {
  const status = new Map(progress.map((x) => [x.unitId, x.status]));
  for (const u of units) {
    if (status.get(u.id) === 'DONE') continue;
    if (lastLessonId && u.lessonIds.includes(lastLessonId) && !doneIds.has(lastLessonId)) return { unitId: u.id, lessonId: lastLessonId };
    const next = u.lessonIds.find((id) => !doneIds.has(id));
    if (next) return { unitId: u.id, lessonId: next };
  }
  return null;
}

/** D3: a valid certificate already covers these done units (ids within the certificate's moduleIds). */
export function certificateCovers(moduleIds: readonly string[] | null, doneUnitIds: readonly string[]): boolean {
  if (!moduleIds) return false;
  const have = new Set(moduleIds);
  return doneUnitIds.every((id) => have.has(id));
}

const GROUP_WORDS: Readonly<Record<string, string>> = {
  admins: 'Admins',
  employees: 'Employees',
  'project-runners': 'People who run a project',
  'training-managers': 'Training managers',
};

/** Who sees a module, in plain words; the feature limits (Reports, Admin settings, Management) win over groups. */
export function visibilityWords(m: ModuleFacts & { offReason?: string | null }, companyNames: ReadonlyMap<string, string>): string {
  if (!m.enabled) return m.offReason === 'REMOVED' ? 'Off — the old course was removed' : 'Off';
  let who: string;
  if (m.moduleKey === 'reports' || m.moduleKey === 'admin') who = 'Admins only';
  else if (m.moduleKey === 'management') who = 'Admins and people who run a project';
  else if (m.roleKeys.length === 0) who = 'All staff';
  else {
    const words = m.roleKeys.map((k) => GROUP_WORDS[k] ?? k);
    if (words.length === 1) who = k1(m.roleKeys[0]!, words[0]!);
    else who = words.map((w, i) => (i === 0 ? w : w.charAt(0).toLowerCase() + w.slice(1))).join(' or ');
  }
  const names = m.companyIds.map((id) => companyNames.get(id)).filter((n): n is string => !!n);
  return names.length > 0 ? `${who} · ${names.join(', ')}` : who;
}

function k1(key: string, word: string): string {
  return key === 'project-runners' ? word : `${word} only`;
}
