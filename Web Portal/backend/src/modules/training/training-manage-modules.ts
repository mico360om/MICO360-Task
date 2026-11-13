import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { ValidationError } from '../../lib/http-errors';
import { withRowLock } from '../../lib/sentinel-lock';
import { idOf, managerOf, notFound, type TrainingContext } from './training-context';
import { readSetting, stringList, type PersonRecord } from './prisma-training-store';
import { visibilityWords } from './training-modules';
import { LIMITS, ROLE_KEYS, TRAINING_MODULES, type ManageCourse, type ManageModule } from './training-types';

/**
 * Learning Hub as one course (1.23.31, owner D6 / design §9b): modules are a course-editor feature of ANY course — the
 * built-in one, courses people made and copies. Training managers and administrators add, rename, reorder, limit
 * (feature, staff groups, companies), switch on and off and remove modules, with the same rights as over the course.
 * - A course without modules stays a plain list of lessons.
 * - Removing a module never deletes a lesson: its lessons move to the module chosen (or to none), after that
 *   module's own. People's records of the removed module stay in training_module_done (no module reads them).
 * - Every change edits the course (`touchCourse`: a built-in course then gets no more built-in updates, and a
 *   published one reads "Changes not published"), is audited, may not leave a published course with nothing
 *   finished to learn (M8, `assertShownPublishable`), and finishing is checked again (switching a module off or
 *   limiting it can leave people with everything done: R3 `recheck`).
 * - For a course for clients a module's feature and staff groups are kept but don't apply (only its companies do).
 * The words for who sees a module or a course, and the notice on an edited built-in course, are worked out here.
 */

// ── Input shapes (the website's api/training.ts sends these) ────────────────────────────────────────

const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'Not a valid id.');

export const moduleInputSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Give it a title.')
    .max(LIMITS.moduleTitle, `Use at most ${LIMITS.moduleTitle.toLocaleString('en-US')} characters.`),
  moduleKey: z.enum(TRAINING_MODULES).optional(),
  roleKeys: z.array(z.enum(ROLE_KEYS)).max(ROLE_KEYS.length * 2).optional(),
  companyIds: z.array(id).max(50).optional(),
  enabled: z.boolean().optional(),
});
export type ModuleInputParsed = z.infer<typeof moduleInputSchema>;
export const modulePatchSchema = moduleInputSchema.partial();
/** Remove: where its lessons go (a module of the same course); null or not sent: no module. */
export const removeModuleSchema = z.object({ moveTo: id.nullable().optional() }).transform((b) => ({ moveTo: b.moveTo ?? null }));
export const moduleOrderSchema = z.object({ moduleIds: z.array(id).max(LIMITS.modulesPerCourse * 2) });

// ── Pure ──────────────────────────────────────────────────────────────────────────────────────────

const CLIENTS_WORD = 'Clients';

/** Who sees a module, in plain words: a staff course's (visibilityWords); a course for clients: "Clients" and its companies. */
export function moduleVisibility(
  m: { moduleKey: string; roleKeys: readonly string[]; companyIds: readonly string[]; enabled: boolean; offReason?: string | null },
  audience: string,
  companyNames: ReadonlyMap<string, string>,
): string {
  if (audience !== 'CLIENTS' || !m.enabled) return visibilityWords(m, companyNames);
  const names = m.companyIds.map((c) => companyNames.get(c)).filter((n): n is string => !!n);
  return names.length > 0 ? `${CLIENTS_WORD} · ${names.join(', ')}` : CLIENTS_WORD;
}

/** The Manage list's "limited to": who a course is for in words; null when it is everyone it is meant for ("All staff", "Clients"). */
export function courseLimitedTo(
  c: { audience: string; moduleKey: string; roleKeys: readonly string[]; companyIds: readonly string[] },
  companyNames: ReadonlyMap<string, string>,
): string | null {
  const words = moduleVisibility({ moduleKey: c.moduleKey, roleKeys: c.audience === 'CLIENTS' ? [] : c.roleKeys, companyIds: c.companyIds, enabled: true }, c.audience, companyNames);
  return words === 'All staff' || words === CLIENTS_WORD ? null : words;
}

/** Design §9a C1: Manage's notice on a built-in short course the conversion left as it was (edited), until it is archived. */
export const EDITED_NOTICE = 'This built-in course was edited, so it wasn’t merged. Its assignments moved to MICO360 Tasks User Training. Archive it when you’re ready.';

/** The conversion record's (training.oneCourse) edited short courses; nothing when there is no record. */
export function notMergedOf(record: unknown): Set<string> {
  if (!record || typeof record !== 'object') return new Set();
  const list = (record as { notMerged?: unknown }).notMerged;
  return new Set(Array.isArray(list) ? stringList(list) : []);
}

export function courseNotice(c: { id: string; status: string }, notMerged: ReadonlySet<string>): string | null {
  return notMerged.has(c.id) && c.status !== 'ARCHIVED' ? EDITED_NOTICE : null;
}

/** A new module teaches the course's feature; in a course for clients (whose feature is the Client portal) General. */
export function defaultModuleKey(c: { audience: string; moduleKey: string }): string {
  return c.audience === 'CLIENTS' || c.moduleKey === 'portal' ? 'general' : c.moduleKey;
}

/** `sent` lists every id of `known` exactly once (and nothing else). */
export function everyIdOnce(known: readonly string[], sent: readonly string[]): boolean {
  const k = new Set(known);
  return sent.length === known.length && new Set(sent).size === sent.length && sent.every((x) => k.has(x));
}

// ── The service ─────────────────────────────────────────────────────────────────────────────────────

type Meta = { ip: string | null } | undefined;

/** What a module change would leave: modules switched on / off, lessons moved (lesson → module or null), a module gone. */
export interface ModuleAfter {
  enabled?: ReadonlyMap<string, boolean>;
  moduleOf?: ReadonlyMap<string, string | null>;
  removed?: string;
}

export interface ModuleOpsDeps {
  manageCourse(courseId: string): Promise<ManageCourse>;
  /** A change to the course itself (updatedById + updatedAt): a built-in course is then edited (D6). */
  touchCourse(courseId: string, actor: PersonRecord): Promise<unknown>;
  audit(actor: PersonRecord, meta: Meta, action: string, entityId: string | null, values?: { oldValue?: unknown; newValue?: unknown }): Promise<void>;
  /** R3: finish anyone the change leaves with everything done. */
  recheck(courseId: string): Promise<void>;
  /** M8: a published course keeps something finished to learn after the change (training-manage). */
  assertShownPublishable(courseId: string, after: ModuleAfter): Promise<void>;
}

const jsonList = (list: readonly string[] | undefined) => (list && list.length ? [...new Set(list)] : Prisma.DbNull);
const MODULE_ORDER = [{ position: 'asc' as const }, { createdAt: 'asc' as const }, { id: 'asc' as const }];

export function createModuleOps(ctx: TrainingContext, d: ModuleOpsDeps) {
  const { prisma } = ctx;

  async function courseOf(courseId: unknown) {
    const c = await prisma.trainingCourse.findUnique({ where: { id: idOf(courseId) }, select: { id: true, audience: true, moduleKey: true } });
    if (!c) throw notFound();
    return c;
  }

  async function moduleRow(moduleId: unknown) {
    const m = await prisma.trainingModule.findUnique({ where: { id: idOf(moduleId, 'Module') } });
    if (!m) throw notFound('Module');
    return m;
  }

  /** The names of these companies (any status), for the words. */
  async function companyNames(ids: readonly string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    return new Map((await prisma.company.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
  }

  /** The feature, groups and companies checked (a staff course's module never teaches the Client portal; companies exist). */
  async function checkFacts(input: { moduleKey?: string; companyIds?: readonly string[] }, course: { audience: string }): Promise<void> {
    if (input.moduleKey === 'portal' && course.audience !== 'CLIENTS') {
      throw new ValidationError('The Client portal is for courses for clients: choose another feature.', { field: 'moduleKey' });
    }
    if (input.companyIds && input.companyIds.length) {
      const unique = [...new Set(input.companyIds)];
      if ((await prisma.company.count({ where: { id: { in: unique } } })) !== unique.length) throw new ValidationError('One of those companies doesn’t exist.', { field: 'companyIds' });
    }
  }

  /** The editor's modules of a course, in order, with who sees each in words. */
  async function manageModules(course: { id: string; audience: string }): Promise<ManageModule[]> {
    const rows = await prisma.trainingModule.findMany({ where: { courseId: course.id }, orderBy: MODULE_ORDER });
    const names = await companyNames(rows.flatMap((m) => stringList(m.companyIds)));
    return rows.map((m) => {
      const facts = { moduleKey: m.moduleKey, roleKeys: stringList(m.roleKeys), companyIds: stringList(m.companyIds), enabled: m.enabled, offReason: m.offReason };
      return {
        id: m.id,
        title: m.title,
        position: m.position,
        moduleKey: m.moduleKey as ManageModule['moduleKey'],
        roleKeys: facts.roleKeys as ManageModule['roleKeys'],
        companyIds: facts.companyIds,
        enabled: m.enabled,
        offReason: m.offReason === 'REMOVED' ? 'REMOVED' : null,
        starter: m.starterKey !== null,
        visibility: moduleVisibility(facts, course.audience, names),
      };
    });
  }

  /** Every module change ends the same way: the course edited, audited, finishing checked again, the editor's course. */
  async function done(actor: PersonRecord, meta: Meta, courseId: string, action: string, entityId: string, values: { oldValue?: unknown; newValue?: unknown }): Promise<ManageCourse> {
    await d.touchCourse(courseId, actor);
    await d.audit(actor, meta, action, entityId, values);
    await d.recheck(courseId);
    return d.manageCourse(courseId);
  }

  async function addModule(actorId: string, courseId: unknown, body: unknown, meta?: Meta): Promise<ManageCourse> {
    const actor = await managerOf(ctx, actorId);
    const c = await courseOf(courseId);
    const input = moduleInputSchema.parse(body ?? {});
    if ((await prisma.trainingModule.count({ where: { courseId: c.id } })) >= LIMITS.modulesPerCourse) {
      throw new ValidationError(`A course has at most ${LIMITS.modulesPerCourse} modules.`);
    }
    await checkFacts(input, c);
    const last = await prisma.trainingModule.findFirst({ where: { courseId: c.id }, orderBy: [{ position: 'desc' }], select: { position: true } });
    const moduleKey = input.moduleKey ?? defaultModuleKey(c);
    const created = await prisma.trainingModule.create({
      data: {
        courseId: c.id,
        title: input.title,
        position: (last?.position ?? -1) + 1,
        moduleKey,
        roleKeys: jsonList(input.roleKeys),
        companyIds: jsonList(input.companyIds),
        enabled: input.enabled ?? true,
      },
    });
    return done(actor, meta, c.id, 'training.module.create', created.id, { newValue: { courseId: c.id, title: input.title, moduleKey, roleKeys: input.roleKeys ?? [], companyIds: input.companyIds ?? [], enabled: created.enabled } });
  }

  async function updateModule(actorId: string, moduleId: unknown, body: unknown, meta?: Meta): Promise<ManageCourse> {
    const actor = await managerOf(ctx, actorId);
    const m = await moduleRow(moduleId);
    const c = await courseOf(m.courseId);
    const input = modulePatchSchema.parse(body ?? {});
    await checkFacts(input, c);
    const data: Prisma.TrainingModuleUncheckedUpdateManyInput = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.moduleKey !== undefined) data.moduleKey = input.moduleKey;
    if (input.roleKeys !== undefined) data.roleKeys = jsonList(input.roleKeys);
    if (input.companyIds !== undefined) data.companyIds = jsonList(input.companyIds);
    // Switched on or off by a person: the old reason ("the old course was removed") no longer says why.
    if (input.enabled !== undefined && input.enabled !== m.enabled) Object.assign(data, { enabled: input.enabled, offReason: null });
    if (Object.keys(data).length === 0) return d.manageCourse(c.id);
    if ('enabled' in data) await d.assertShownPublishable(c.id, { enabled: new Map([[m.id, input.enabled!]]) });
    // One statement (two managers saving the same module at once never hit MariaDB's error 1020).
    await prisma.trainingModule.updateMany({ where: { id: m.id }, data });
    return done(actor, meta, c.id, 'training.module.update', m.id, {
      oldValue: { title: m.title, moduleKey: m.moduleKey, roleKeys: stringList(m.roleKeys), companyIds: stringList(m.companyIds), enabled: m.enabled, offReason: m.offReason },
      newValue: input,
    });
  }

  async function removeModule(actorId: string, moduleId: unknown, body: unknown, meta?: Meta): Promise<ManageCourse> {
    const actor = await managerOf(ctx, actorId);
    const m = await moduleRow(moduleId);
    const { moveTo } = removeModuleSchema.parse(body ?? {});
    if (moveTo !== null) {
      const target = moveTo === m.id ? null : await prisma.trainingModule.findFirst({ where: { id: moveTo, courseId: m.courseId }, select: { id: true } });
      if (!target) throw new ValidationError('Choose another module of this course for its lessons, or no module.', { field: 'moveTo' });
    }
    const theirs = await prisma.trainingLesson.findMany({ where: { moduleId: m.id }, select: { id: true } });
    await d.assertShownPublishable(m.courseId, { removed: m.id, moduleOf: new Map(theirs.map((l) => [l.id, moveTo])) });
    // The module row is locked first: two removals of it at once move its lessons once.
    const moved = await withRowLock(
      prisma,
      (tx) => tx.$queryRaw`SELECT id FROM training_modules WHERE id = ${m.id} FOR UPDATE`,
      async (tx, locked) => {
        if ((locked as unknown[]).length === 0) return null;
        const lessons = await tx.trainingLesson.findMany({ where: { moduleId: m.id }, select: { id: true, updatedAt: true }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] });
        const last = await tx.trainingLesson.findFirst({ where: { courseId: m.courseId }, orderBy: [{ position: 'desc' }], select: { position: true } });
        let position = (last?.position ?? -1) + 1;
        // After the other module's lessons (at the end of the course); each lesson keeps its own edit time (the move is the course's change).
        for (const l of lessons) await tx.trainingLesson.updateMany({ where: { id: l.id }, data: { moduleId: moveTo, position: position++, updatedAt: l.updatedAt } });
        await tx.trainingModule.deleteMany({ where: { id: m.id } });
        return lessons.length;
      },
    );
    if (moved === null) throw notFound('Module');
    return done(actor, meta, m.courseId, 'training.module.remove', m.id, { oldValue: { courseId: m.courseId, title: m.title }, newValue: { moveTo, lessonsMoved: moved } });
  }

  async function reorderModules(actorId: string, courseId: unknown, body: unknown, meta?: Meta): Promise<ManageCourse> {
    const actor = await managerOf(ctx, actorId);
    const c = await courseOf(courseId);
    const { moduleIds } = moduleOrderSchema.parse(body ?? {});
    const modules = await prisma.trainingModule.findMany({ where: { courseId: c.id }, select: { id: true } });
    if (!everyIdOnce(modules.map((x) => x.id), moduleIds)) throw new ValidationError('Send every module of the course once, in the new order.', { field: 'moduleIds' });
    await prisma.$transaction(moduleIds.map((mid, i) => prisma.trainingModule.updateMany({ where: { id: mid }, data: { position: i } })));
    return done(actor, meta, c.id, 'training.module.reorder', c.id, { newValue: { moduleIds } });
  }

  /** A lesson's new module: one of its own course's (else 400); null: none. */
  async function checkLessonModule(courseId: string, moduleId: string | null): Promise<void> {
    if (moduleId === null) return;
    const found = await prisma.trainingModule.findFirst({ where: { id: moduleId, courseId }, select: { id: true } });
    if (!found) throw new ValidationError('Choose a module of this course.', { field: 'moduleId' });
  }

  /** The Manage list: each course's number of modules. */
  async function moduleCounts(courseIds: readonly string[]): Promise<Map<string, number>> {
    if (courseIds.length === 0) return new Map();
    const rows = await prisma.trainingModule.groupBy({ by: ['courseId'], where: { courseId: { in: [...courseIds] } }, _count: { _all: true } });
    return new Map(rows.map((r) => [r.courseId, r._count._all]));
  }

  return { addModule, updateModule, removeModule, reorderModules, manageModules, checkLessonModule, moduleCounts, companyNames };
}

/** The edited built-in short courses the conversion left as they were (the record under `key`). */
export async function readNotMerged(prisma: TrainingContext['prisma'], key: string): Promise<Set<string>> {
  return notMergedOf(await readSetting<unknown>(prisma, key));
}

export type ModuleOps = ReturnType<typeof createModuleOps>;
