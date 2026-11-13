import { createPrismaReminderKeys, type ReminderKeyStore } from '../notify-policy/planner-sweep';
import { canLearn, inScope } from './training-access';
import { courseFacts, trainingManagersFor, type TrainingContext } from './training-context';
import { COURSE, createTrainingFinish, finishedUnsettled, type CourseRow } from './training-finish';
import { readSetting, type PersonRecord } from './prisma-training-store';
import { loadStates, pairKey, type PairState } from './training-read';
import { planTrainingReminders, type PlannedNotice, type ReminderCertificate, type ReminderEnrolment, type ReminderRules } from './training-reminders';
import type { SyncResult, TrainingSync } from './training-sync';

/**
 * The Training Center's scheduled work (ruling R13, R7), each run on one instance by server.ts:
 *
 *   reminders   hourly: expired certificates start a retake (R10), then the reminder planner's notices go
 *               through the Notification & Scheduling engine (ctx.notify). Each notice's key
 *               (`np:tr:<type>:<enrolmentId>:<step>`) is recorded in reminder_logs BEFORE it is sent, so a
 *               step is never sent twice (a failed send is not retried). The very first run after the
 *               upgrade records every key and sends nothing (system_settings `training.remindersSince`),
 *               so nobody gets a burst of old reminders.
 *               Final review (1.23.32): someone with every module they see done (or every changed lesson of a review
 *               they see) isn't reminded (nothing is left for them to do); when their own role or company shrank
 *               while part-way, they are finished (or their review done) here first.
 *   membership  every 15 minutes: the membership-following sync (training-sync.ts).
 */

export const REMINDERS_SINCE_KEY = 'training.remindersSince';

/** States are read this many person × course pairs at a time. */
const STATE_CHUNK = 300;

type Logger = TrainingContext['logger'];

/** R13: Reports to counts while it is an active staff account (and not the person themselves). */
export function reportsToOf(p: PersonRecord, people: ReadonlyMap<string, PersonRecord>): string | null {
  if (!p.reportsToId || p.reportsToId === p.id) return null;
  const boss = people.get(p.reportsToId);
  return boss && boss.active && !boss.client ? boss.id : null;
}

/**
 * M11: may this Reports-to person open the Learning Hub's Reports for the learner — an administrator, a
 * Training manager of one of the learner's companies, or someone running a project the learner is on.
 */
export function seesReportsOf(boss: PersonRecord | undefined, p: PersonRecord): boolean {
  if (!boss || boss.client) return false;
  if (boss.admin) return true;
  if (boss.trainingManager && inScope(boss.companyIds, p)) return true;
  return !p.client && p.teamProjectIds.some((id) => boss.runProjectIds.includes(id));
}

/** Whose working days and escalation numbers: their primary company while it is one of theirs, else their first, else the site's. */
export function reminderCompanyOf(p: PersonRecord): string | null {
  if (p.primaryCompanyId && p.companyIds.includes(p.primaryCompanyId)) return p.primaryCompanyId;
  return p.companyIds[0] ?? null;
}

/** The newest certificate per (person, course). */
export function newestCertificates<T extends { id: string; userId: string; courseId: string; issuedAt: Date }>(rows: readonly T[]): T[] {
  const best = new Map<string, T>();
  for (const r of rows) {
    const k = pairKey(r.userId, r.courseId);
    const b = best.get(k);
    if (!b || r.issuedAt.getTime() > b.issuedAt.getTime() || (r.issuedAt.getTime() === b.issuedAt.getTime() && r.id > b.id)) best.set(k, r);
  }
  return [...best.values()];
}

/**
 * Sends the planned notices whose keys aren't recorded yet: each key is recorded first, then its notices
 * go out; one failing send is logged and never stops the others (and is not retried).
 */
export async function deliverReminders(notices: readonly PlannedNotice[], d: { keys: ReminderKeyStore; notify: TrainingContext['notify']; logger?: Logger }): Promise<{ sent: number; fresh: number }> {
  const byKey = new Map<string, PlannedNotice[]>();
  for (const n of notices) {
    const list = byKey.get(n.key) ?? [];
    list.push(n);
    byKey.set(n.key, list);
  }
  if (byKey.size === 0) return { sent: 0, fresh: 0 };
  const existing = await d.keys.existing([...byKey.keys()]);
  let sent = 0;
  let fresh = 0;
  for (const [key, list] of byKey) {
    if (existing.has(key)) continue;
    await d.keys.addMany([key]);
    fresh++;
    for (const n of list) {
      try {
        await d.notify({ userId: n.userId, type: n.type, title: n.title, body: n.body, entityType: n.entityType, entityId: n.entityId, projectId: null });
        sent++;
      } catch (err) {
        const meta = { userId: n.userId, key, err: String((err as Error)?.message ?? err) };
        if (d.logger?.error) d.logger.error('training: a reminder could not be sent', meta);
        else d.logger?.warn('training: a reminder could not be sent', meta);
      }
    }
  }
  return { sent, fresh };
}

export function createTrainingSweeps(ctx: TrainingContext, sync: TrainingSync, deps: { keys?: ReminderKeyStore } = {}) {
  const { prisma } = ctx;
  const keys = deps.keys ?? createPrismaReminderKeys(prisma);
  const finish = createTrainingFinish(ctx);

  /**
   * Final review (1.23.32): all that is left for the person is in modules no longer theirs — their own role or company
   * shrank while part-way (finishedUnsettled). They are settled now (the completion and the certificate, or the review
   * done; once) when they may take the course; either way they get no reminder. A failure is warned (the next run tries again).
   */
  async function settleFinished(course: CourseRow, p: PersonRecord, s: PairState): Promise<void> {
    if (!canLearn(courseFacts(course), p)) return;
    try {
      await finish.settle(p.id, course, s, { person: p });
    } catch (err) {
      ctx.logger?.warn('training: finishing could not be checked for one person', { courseId: course.id, userId: p.id, err: String((err as Error)?.message ?? err) });
    }
  }

  /** Today's training notices (after expired certificates have started their retakes). */
  async function plan(): Promise<PlannedNotice[]> {
    await sync.applyExpiry();
    const courses = await prisma.trainingCourse.findMany({ where: { status: 'PUBLISHED' }, select: COURSE });
    if (courses.length === 0) return [];
    const courseOf = new Map(courses.map((c) => [c.id, c]));
    const titles = new Map(courses.map((c) => [c.id, c.title]));
    const courseIds = courses.map((c) => c.id);
    const enrolments = await prisma.trainingEnrolment.findMany({ where: { withdrawnAt: null, courseId: { in: courseIds } }, select: { id: true, userId: true, courseId: true } });
    const people = await ctx.people();
    const live = enrolments.filter((e) => people.get(e.userId)?.active);

    const states = new Map<string, PairState>();
    for (let i = 0; i < live.length; i += STATE_CHUNK) {
      for (const [k, s] of await loadStates(ctx, live.slice(i, i + STATE_CHUNK).map((e) => ({ userId: e.userId, courseId: e.courseId })))) states.set(k, s);
    }

    const companies = new Set<string | null>([null]);
    for (const e of live) companies.add(reminderCompanyOf(people.get(e.userId)!));
    const rules = new Map<string, ReminderRules>();
    for (const c of companies) rules.set(c ?? '', await ctx.rules(c));
    const rulesOf = (c: string | null): ReminderRules => rules.get(c ?? '') ?? rules.get('')!;

    const managers = new Map<string, { tms: string[]; admins: string[] }>();
    const managersOf = (p: PersonRecord) => {
      let m = managers.get(p.id);
      if (!m) managers.set(p.id, (m = trainingManagersFor(people, p.companyIds)));
      return m;
    };

    const reminderEnrolments: ReminderEnrolment[] = [];
    for (const e of live) {
      const s = states.get(pairKey(e.userId, e.courseId));
      const p = people.get(e.userId)!;
      if (!s) continue;
      if (finishedUnsettled(s)) {
        await settleFinished(courseOf.get(e.courseId)!, p, s);
        continue;
      }
      const m = p.client ? { tms: [], admins: [] } : managersOf(p);
      reminderEnrolments.push({
        enrolmentId: e.id,
        userId: p.id,
        learnerName: p.name,
        courseId: e.courseId,
        courseTitle: titles.get(e.courseId) ?? 'A course',
        client: p.client,
        mandatory: s.terms.mandatory,
        dueDay: s.state.dueDay,
        status: s.state.status,
        companyId: reminderCompanyOf(p),
        reportsToId: p.client ? null : reportsToOf(p, people),
        reportsToSeesReports: seesReportsOf(p.reportsToId ? people.get(p.reportsToId) : undefined, p),
        trainingManagerIds: m.tms,
        adminIds: m.admins,
      });
    }

    const enrolmentOf = new Map(live.map((e) => [pairKey(e.userId, e.courseId), e.id]));
    const certificates: ReminderCertificate[] = [];
    const rows = await prisma.trainingCertificate.findMany({
      where: { revokedAt: null, expiresAt: { not: null }, courseId: { in: courseIds } },
      select: { id: true, userId: true, courseId: true, issuedAt: true, expiresAt: true },
    });
    for (const c of newestCertificates(rows)) {
      const p = people.get(c.userId);
      const enrolmentId = enrolmentOf.get(pairKey(c.userId, c.courseId));
      if (!p || p.client || !enrolmentId) continue;
      certificates.push({
        certificateId: c.id,
        enrolmentId,
        userId: c.userId,
        courseId: c.courseId,
        courseTitle: titles.get(c.courseId) ?? 'A course',
        client: false,
        expiresDay: ctx.dayOf(c.expiresAt!),
      });
    }

    return planTrainingReminders({ enrolments: reminderEnrolments, certificates, today: ctx.today(), rulesOf });
  }

  async function runReminders(): Promise<{ planned: number; sent: number; recordedOnly: boolean }> {
    const notices = await plan();
    if ((await readSetting<string>(prisma, REMINDERS_SINCE_KEY)) === null) {
      // The first run after the upgrade: what is due already is remembered, nothing is sent.
      await keys.addMany([...new Set(notices.map((n) => n.key))]);
      await prisma.systemSetting.upsert({ where: { key: REMINDERS_SINCE_KEY }, create: { key: REMINDERS_SINCE_KEY, value: ctx.clock().toISOString() }, update: {} });
      ctx.logger?.info('training: reminders started (first run records only)', { planned: notices.length });
      return { planned: notices.length, sent: 0, recordedOnly: true };
    }
    const { sent } = await deliverReminders(notices, { keys, notify: ctx.notify, logger: ctx.logger });
    return { planned: notices.length, sent, recordedOnly: false };
  }

  return {
    reminders: { run: runReminders },
    membership: { run: (): Promise<SyncResult> => sync.all() },
  };
}

export type TrainingSweeps = ReturnType<typeof createTrainingSweeps>;
