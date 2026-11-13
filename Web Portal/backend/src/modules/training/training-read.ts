import type { TrainingEnrolment } from '@prisma/client';
import type { LearnerFacts } from './training-access';
import type { TrainingContext } from './training-context';
import { stringList, type PersonRecord } from './prisma-training-store';
import { OTHER_UNIT, continueTarget, orderedLessonIds, unitProgress, unitsFor, type Unit, type UnitProgress } from './training-modules';
import { assignmentTerms, courseState, cycleStart, doneInCycle, lessonSince, retakeActive, type CourseState, type LessonFacts, type Terms } from './training-state';
import type { LessonKind } from './training-types';

/**
 * Reading people's state on courses in a few queries (My training, the catalogue's cards, a course,
 * reports, reminders): the enrolment, the lessons, when each lesson was last done, the active
 * assignments' terms (R6), the state (R9–R11) and the best quiz scores of the current cycle.
 *
 * 1.23.30 (Learning Hub as one course): a course with modules is read as the PERSON sees it — only the
 * modules shown to them (training-access `moduleShown`: on, their feature, group and company) that have a
 * lesson they can see, then "Other lessons" for lessons with no module. `lessons` are those modules' lessons
 * in module order, so every reader (outline, previous/next, %, review, cycle) works on the person's view and a
 * hidden module's lessons, progress and quiz scores are never counted. A module is done when recorded
 * (training_module_done, from this cycle) or when its lessons are; the course's % is modules done of theirs.
 */

/** One module of the course (shown to the person or not), for the editor's words and reports. */
export interface ModuleRow {
  id: string;
  title: string;
  position: number;
  moduleKey: string;
  roleKeys: string[];
  companyIds: string[];
  enabled: boolean;
  offReason: string | null;
}

/** A module (unit) as the person sees it. */
export interface UnitState extends UnitProgress {
  unit: Unit;
  minutes: number;
  /** D3: the course is finished and this module isn't done — it appeared later (a grown role, a new module). */
  newForRole: boolean;
  /** When its completion was recorded (any cycle; a retake ignores an older one); null: never. */
  recordedAt: Date | null;
}

export interface PairState {
  userId: string;
  courseId: string;
  enrolment: TrainingEnrolment | null;
  /** The lessons the person sees, in order (a course with modules: their modules' lessons, module by module). */
  lessons: (LessonFacts & { position: number; title: string; minutes: number; moduleId: string | null })[];
  /** When each lesson was last done (any cycle). */
  done: Map<string, Date>;
  /** Lessons done in the current cycle (a retake counts from its start). */
  doneIds: Set<string>;
  terms: Terms;
  state: CourseState;
  /** The average of the best score on each quiz tried in this cycle; null: none tried. */
  bestScore: number | null;
  /** Best attempt per quiz lesson in this cycle. */
  best: Map<string, { scorePct: number; passed: boolean }>;
  /** Handed-in attempts per quiz lesson in this cycle. */
  attemptsUsed: Map<string, number>;
  /** The person's modules in order with their progress; [] for a course without modules. */
  units: UnitState[];
  /** Continue (D4): the first module not done, at the lesson they stopped on; null when all done (or no modules). */
  continueAt: { unitId: string; lessonId: string } | null;
  /** Every module of the course, in position order ([] for a course without modules). */
  modules: ModuleRow[];
}

export const pairKey = (userId: string, courseId: string) => `${userId}|${courseId}`;

/**
 * R2 (12 Nov): a video lesson without its link is hidden from learners — left out here, the one place every
 * learner read goes through, so the lesson list, status, %, next lesson, minutes, counts and reports agree.
 */
export const hiddenLesson = (l: { kind: string; videoId: string | null }): boolean => l.kind === 'VIDEO' && !l.videoId;

/** Lists split for `IN (…)` queries. */
function chunks<T>(list: readonly T[], size = 300): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}

/** A deleted account (no record): sees the modules everyone sees, none limited to a feature, group or company. */
const nobody = (id: string): LearnerFacts => ({ id, client: false, admin: false, trainingManager: false, runsProject: false, companyIds: [] });

/**
 * Everyone's state on these courses in a few reads. `people`: records already loaded (else the people on a
 * course with modules are read once; a course without modules reads nobody's record).
 */
export async function loadStates(
  ctx: TrainingContext,
  pairs: readonly { userId: string; courseId: string }[],
  people?: ReadonlyMap<string, PersonRecord>,
): Promise<Map<string, PairState>> {
  const out = new Map<string, PairState>();
  if (pairs.length === 0) return out;
  const { prisma } = ctx;
  const userIds = [...new Set(pairs.map((p) => p.userId))];
  const courseIds = [...new Set(pairs.map((p) => p.courseId))];
  const wanted = new Set(pairs.map((p) => pairKey(p.userId, p.courseId)));
  // I3: every row read once (people in pieces), then indexed by its person × course.
  const [lessons, moduleRows] = await Promise.all([
    prisma.trainingLesson
      .findMany({
        where: { courseId: { in: courseIds } },
        select: { id: true, courseId: true, kind: true, changedVersion: true, position: true, title: true, minutes: true, videoId: true, moduleId: true },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      })
      .then((rows) => rows.filter((l) => !hiddenLesson(l))),
    prisma.trainingModule.findMany({
      where: { courseId: { in: courseIds } },
      select: { id: true, courseId: true, position: true, title: true, moduleKey: true, roleKeys: true, companyIds: true, enabled: true, offReason: true },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    }),
  ]);
  const modulesOf = new Map<string, ModuleRow[]>();
  for (const m of moduleRows) {
    push(modulesOf, m.courseId, { id: m.id, title: m.title, position: m.position, moduleKey: m.moduleKey, roleKeys: stringList(m.roleKeys), companyIds: stringList(m.companyIds), enabled: m.enabled, offReason: m.offReason });
  }
  const moduleCourseIds = [...modulesOf.keys()];
  const moduleUserIds = [...new Set(pairs.filter((p) => modulesOf.has(p.courseId)).map((p) => p.userId))];

  // Courses with modules only: their completion rules and the people taking them (one read for everyone).
  let ruleOf: ReadonlyMap<string, string> = new Map();
  let peopleOf: ReadonlyMap<string, PersonRecord> = new Map();
  if (moduleCourseIds.length) {
    [ruleOf, peopleOf] = await Promise.all([
      prisma.trainingCourse.findMany({ where: { id: { in: moduleCourseIds } }, select: { id: true, completionRule: true } }).then((rows) => new Map(rows.map((c) => [c.id, c.completionRule]))),
      peopleFor(ctx, moduleUserIds, people),
    ]);
  }

  const enrolmentOf = new Map<string, TrainingEnrolment>();
  const doneOf = new Map<string, Map<string, Date>>();
  const assigneesOf = new Map<string, { mandatory: boolean; dueDay: string | null; withdrawnAt: Date | null }[]>();
  const attemptsOf = new Map<string, { lessonId: string; scorePct: number | null; passed: boolean | null; submittedAt: Date | null }[]>();
  /** `${userId}|${moduleId}` → when the module's completion was recorded. */
  const recordedOf = new Map<string, Date>();
  for (const part of chunks(userIds)) {
    const where = { userId: { in: part }, courseId: { in: courseIds } };
    const [enrolments, progress, assignees, attempts, recorded] = await Promise.all([
      prisma.trainingEnrolment.findMany({ where }),
      prisma.trainingProgress.findMany({ where: { ...where, doneAt: { not: null } }, select: { userId: true, courseId: true, lessonId: true, doneAt: true } }),
      prisma.trainingAssignee.findMany({ where: { ...where, withdrawnAt: null }, select: { userId: true, courseId: true, mandatory: true, dueDay: true, withdrawnAt: true } }),
      prisma.trainingAttempt.findMany({ where: { ...where, submittedAt: { not: null } }, select: { userId: true, courseId: true, lessonId: true, scorePct: true, passed: true, submittedAt: true } }),
      moduleCourseIds.length
        ? prisma.trainingModuleDone.findMany({ where: { userId: { in: part }, courseId: { in: moduleCourseIds } }, select: { userId: true, moduleId: true, doneAt: true } })
        : Promise.resolve([]),
    ]);
    for (const e of enrolments) enrolmentOf.set(pairKey(e.userId, e.courseId), e);
    for (const p of progress) {
      const k = pairKey(p.userId, p.courseId);
      const m = doneOf.get(k) ?? new Map<string, Date>();
      m.set(p.lessonId, p.doneAt!);
      doneOf.set(k, m);
    }
    for (const a of assignees) push(assigneesOf, pairKey(a.userId, a.courseId), a);
    for (const a of attempts) push(attemptsOf, pairKey(a.userId, a.courseId), a);
    for (const r of recorded) recordedOf.set(pairKey(r.userId, r.moduleId), r.doneAt);
  }
  const lessonsOf = new Map<string, PairState['lessons']>();
  for (const l of lessons) {
    push(lessonsOf, l.courseId, { id: l.id, kind: l.kind as LessonKind, changedVersion: l.changedVersion, position: l.position, title: l.title, minutes: l.minutes, moduleId: l.moduleId });
  }
  /** Lesson ids of each course with modules (to tell a lesson of a hidden module from a removed one). */
  const lessonIdsOf = new Map(moduleCourseIds.map((id) => [id, new Set((lessonsOf.get(id) ?? []).map((l) => l.id))]));
  const today = ctx.today();
  for (const key of wanted) {
    const [userId, courseId] = key.split('|') as [string, string];
    const enrolment = enrolmentOf.get(key) ?? null;
    const allLessons = lessonsOf.get(courseId) ?? [];
    const modules = modulesOf.get(courseId) ?? [];
    // 1.23.30: a course with modules — only the person's modules, their lessons in module order.
    const unitList = modules.length ? unitsFor(modules, allLessons, peopleOf.get(userId) ?? nobody(userId)) : [];
    let courseLessons = allLessons;
    if (modules.length) {
      const all = new Map(allLessons.map((l) => [l.id, l]));
      courseLessons = orderedLessonIds(unitList).map((id) => all.get(id)!);
    }
    const byId = new Map(courseLessons.map((l) => [l.id, l]));
    const notTheirs = (lessonId: string) => !byId.has(lessonId) && !!lessonIdsOf.get(courseId)?.has(lessonId);
    const done = new Map([...(doneOf.get(key) ?? new Map<string, Date>())].filter(([lessonId]) => byId.has(lessonId)));
    const doneIds = doneInCycle(courseLessons, done, enrolment);
    const terms = assignmentTerms(assigneesOf.get(key) ?? []);
    const retakeDueDay = retakeActive(enrolment) && terms.mandatory ? ctx.dayOf(enrolment!.retakeFrom!) : null;
    const since = cycleStart(enrolment);
    const recordedAt = (u: Unit) => (u.id === OTHER_UNIT ? null : (recordedOf.get(pairKey(userId, u.id)) ?? null));
    const progress = unitList.map((u) =>
      unitProgress(
        u,
        ruleOf.get(courseId) ?? 'ALL_LESSONS',
        u.lessonIds.map((id) => byId.get(id)!),
        doneIds,
        done,
        recordedAt(u),
        since,
      ),
    );
    const state = courseState({ enrolment, lessons: courseLessons, done, terms, today, retakeDueDay, ...(modules.length ? { units: progress } : {}) });
    const units: UnitState[] = unitList.map((u, i) => ({
      ...progress[i]!,
      unit: u,
      minutes: u.lessonIds.reduce((n, id) => n + (byId.get(id)?.minutes ?? 0), 0),
      newForRole: state.status === 'COMPLETED' && progress[i]!.status !== 'DONE',
      recordedAt: recordedAt(u),
    }));
    const best = new Map<string, { scorePct: number; passed: boolean }>();
    const attemptsUsed = new Map<string, number>();
    for (const a of attemptsOf.get(key) ?? []) {
      // 1.23.30: a quiz of a module hidden from the person doesn't count (their scores are their modules').
      if (notTheirs(a.lessonId)) continue;
      const lesson = byId.get(a.lessonId);
      // I1: a retake counts from its start; a review counts the changed quiz from the review's start.
      const from = lesson ? lessonSince(lesson, enrolment) : since;
      if (from && a.submittedAt!.getTime() < from.getTime()) continue;
      attemptsUsed.set(a.lessonId, (attemptsUsed.get(a.lessonId) ?? 0) + 1);
      const b = best.get(a.lessonId);
      const score = a.scorePct ?? 0;
      if (!b || score > b.scorePct) best.set(a.lessonId, { scorePct: score, passed: !!a.passed || !!b?.passed });
      else if (a.passed) b.passed = true;
    }
    const scores = [...best.values()].map((b) => b.scorePct);
    out.set(key, {
      userId,
      courseId,
      enrolment,
      lessons: courseLessons,
      done,
      doneIds,
      terms,
      state,
      bestScore: scores.length ? Math.round(scores.reduce((x, y) => x + y, 0) / scores.length) : null,
      best,
      attemptsUsed,
      units,
      continueAt: modules.length ? continueTarget(unitList, progress, doneIds, enrolment?.lastLessonId ?? null) : null,
      modules,
    });
  }
  return out;
}

/** The records given, and one read for anyone missing from them. */
async function peopleFor(ctx: TrainingContext, ids: readonly string[], given?: ReadonlyMap<string, PersonRecord>): Promise<ReadonlyMap<string, PersonRecord>> {
  if (!given) return ctx.people(ids);
  const missing = ids.filter((id) => !given.has(id));
  if (missing.length === 0) return given;
  return new Map([...given, ...(await ctx.people(missing))]);
}

/** One person on one course. */
export async function loadState(ctx: TrainingContext, userId: string, courseId: string, person?: PersonRecord | null): Promise<PairState> {
  return (await loadStates(ctx, [{ userId, courseId }], person ? new Map([[userId, person]]) : undefined)).get(pairKey(userId, courseId))!;
}
