import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { ConflictError, ForbiddenError, HttpError, NotFoundError, ValidationError } from '../../lib/http-errors';
import { managedVisibleWhere } from '../projects/project-managers';
import { firstFreeKey, highestKeyNumber, isTaskKeyConflict } from '../tasks/prisma-task-repository';
import { matchingColumn } from '../tasks/task-move';
import { boardDateFromKey, boardDateKey } from '../tasks/board-date';
import { defaultCompanyTimeZone } from '../tasks/task-status';
import {
  checklistKey,
  combineDescriptions,
  contactFill,
  countWords,
  defaultMainId,
  dependencyPlan,
  DESCRIPTION_MAX_BYTES,
  differences,
  fileKey,
  listWords,
  mainFirst,
  MAX_MERGE_TASKS,
  MIN_MERGE_TASKS,
  mergedText,
  resolveChoices,
  sameContact,
  undoDescription,
  undoValue,
  utf8Bytes,
  type ContactValues,
  type DependencyEdge,
  type FieldChange,
  type MergeChoices,
  type MergeDifference,
  type MergeField,
} from './merge-rules';
import { displayName, joinableOf, loadCounts, loadMergeTasks, teamOf, type Db, type MergeCounts, type MergeTask } from './merge-facts';

/** Who is merging (or undoing). */
export interface MergeActor {
  id: string;
  roles?: string[];
}

/** What happens to someone assigned who isn't on the main task's project team. */
export type PersonChoice = 'ADD_TO_TEAM' | 'LEAVE_OFF';

export interface MergeInput {
  /** Every task in the merge, the main task among them (2–10). */
  taskIds: string[];
  mainTaskId: string;
  /** Where the tasks differ: whose value to keep (the main task's when left out). */
  choices?: MergeChoices;
  /** For each person assigned who isn't on the main task's project team. */
  people?: Record<string, PersonChoice>;
  /** The versions the dialog showed: a task changed since is refused (reload, try again). */
  versions?: Record<string, number>;
}

export interface MergePreviewTask {
  id: string;
  key: string;
  title: string;
  projectId: string;
  projectName: string;
  status: { name: string; category: string };
  createdAt: Date;
  createdByName: string;
  version: number;
  canMerge: boolean;
  /** Why it can't be merged (null when it can). */
  reason: string | null;
  counts: MergeCounts;
}

export interface MergeOutsider {
  id: string;
  name: string;
  /** May join the main task's project team (companies: in one of its companies). */
  canJoin: boolean;
  /** The tasks they are assigned to. */
  keys: string[];
}

export interface MergeDuplicates {
  checklist: number;
  files: number;
  contacts: number;
  assignees: number;
  watchers: number;
  tags: number;
  blockers: number;
}

export interface DroppedLink {
  /** The merged task the link belonged to, and the other end. */
  key: string;
  otherKey: string;
  otherTitle: string;
  reason: 'between' | 'loop';
}

export interface MergePreview {
  /** In the order asked; one the person can't open looks like one that doesn't exist. */
  tasks: MergePreviewTask[];
  /** The main task (the one asked for, else the oldest that can be merged). */
  mainTaskId: string | null;
  canMerge: boolean;
  reason: string | null;
  /** Only the fields the tasks differ in. */
  differences: MergeDifference[];
  /** The main task's project after the merge (the project choice), and its number then. */
  project: { id: string; name: string; code: string; changes: boolean; newKey: string | null } | null;
  duplicates: MergeDuplicates;
  /** "2 checklist items, 1 file and 1 contact appear in more than one task — kept once." */
  duplicatesText: string | null;
  droppedLinks: DroppedLink[];
  outsiders: MergeOutsider[];
  /** Watchers who can't open the main task's project: they keep following their own task only. */
  watchersLeftOff: number;
  descriptionTooLong: boolean;
}

export interface MergeResult {
  mergeId: string;
  mainTaskId: string;
  mainKey: string;
  mainProjectId: string;
  /** The project the main task was in before (a project choice moved it). */
  mainProjectBefore: string;
  merged: { id: string; key: string; projectId: string }[];
  addedToTeam: { id: string; name: string }[];
  leftOff: { id: string; name: string }[];
  /** "Merged MICO-14 and MICO-15 into MICO-12". */
  text: string;
}

export interface MergedFromTask {
  id: string;
  key: string;
  title: string;
  projectId: string;
  projectName: string;
  createdByName: string;
  createdAt: Date;
}

export interface MergedFromEntry {
  mergeId: string;
  mergedAt: Date;
  mergedByName: string | null;
  tasks: MergedFromTask[];
  canUndo: boolean;
}

export interface MergedFromPanel {
  merges: MergedFromEntry[];
  /** Which task each moved item came from ("MICO-14"): comments, checklist items, history lines, files. */
  labels: { comments: Record<string, string>; checklist: Record<string, string>; activity: Record<string, string>; files: Record<string, string> };
}

export interface MergedRecord {
  id: string;
  key: string;
  title: string;
  description: string | null;
  project: { id: string; name: string };
  status: { name: string; category: string };
  priority: string;
  startDate: Date | null;
  dueDate: Date | null;
  isMilestone: boolean;
  createdByName: string;
  createdAt: Date;
  mergedAt: Date | null;
  mergedByName: string | null;
  main: { id: string; key: string };
  /** What stayed on it because the main task already had the same (kept once). */
  keptOnce: { checklist: number; files: number; contacts: number };
}

export interface UndoPreview {
  mergeId: string;
  mainTaskId: string;
  mainKey: string;
  tasks: { id: string; key: string; title: string }[];
  canUndo: boolean;
  reason: string | null;
  /** "1 file and 2 checklist items from MICO-14 were deleted after the merge." */
  deletedSince: string[];
  /** The merge moved the main task to another project; Undo leaves it there. */
  mainMoved: { fromProject: string; toProject: string } | null;
}

export interface UndoResult {
  mergeId: string;
  mainTaskId: string;
  mainKey: string;
  mainProjectId: string;
  restored: { id: string; key: string; projectId: string }[];
  text: string;
}

export interface MergeServiceDeps {
  prisma: PrismaClient;
  timeZone?: string;
  now?: () => Date;
  /** A file's bytes by its storage key (duplicate files are compared by content), or null when unreadable. */
  readFile?: (storageKey: string) => Promise<Buffer | null>;
  /** How far a task's checklist is (0-100): the progress a re-opened main task goes back to. */
  checklistPercent?: (taskId: string, db: Db) => Promise<number>;
  /** May this person see this meeting? (A linked meeting's title is shown only to them.) */
  canViewMeeting?: (userId: string, roles: string[], meetingId: string) => Promise<boolean>;
  /** After a merge is saved: search, notices (never turns the merge into a failure). */
  onMerged?: (result: MergeResult & { actorId: string }) => void | Promise<void>;
  onUndone?: (result: UndoResult & { actorId: string }) => void | Promise<void>;
  onError?: (err: unknown, what: string) => void;
}

/** How many tries when another task takes the main task's new number at the same moment. */
const KEY_ATTEMPTS = 5;
const TX = { timeout: 60_000, maxWait: 15_000 } as const;
const TASK_ENTITIES = ['task', 'TASK'];

/** The refusal of one task (or the whole merge), with the preview's short words. */
class MergeRefusal extends HttpError {
  constructor(message: string, code: string, status = 409, details?: unknown) {
    super(message, code, status, details);
  }
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const unique = <T>(xs: T[]) => [...new Set(xs)];

/** The fields of the main task the merge may change, as stored (dates as ISO text) — Undo compares them. */
const UNDO_FIELDS = [
  'title', 'description', 'columnId', 'priority', 'startDate', 'dueDate', 'isMilestone', 'clientVisible', 'clientShowDescription', 'recurrenceRule',
  'inspectionFormId', 'inspectionPlace', 'meetingId', 'needsApproval', 'completedAt', 'progress', 'approvalRequestedAt', 'approvalRequestedById',
  'approvedAt', 'approvedById', 'clientAcceptedAt', 'clientAcceptedById',
] as const;
type UndoField = (typeof UNDO_FIELDS)[number];
const DATE_FIELDS = new Set<UndoField>(['startDate', 'dueDate', 'completedAt', 'approvalRequestedAt', 'approvedAt', 'clientAcceptedAt']);

type StoredFields = Record<UndoField, unknown>;
function storedFields(t: Record<string, unknown>): StoredFields {
  const out = {} as StoredFields;
  for (const f of UNDO_FIELDS) {
    const v = t[f];
    out[f] = DATE_FIELDS.has(f) ? iso(v as Date | null) : (v ?? null);
  }
  return out;
}
/** A stored value back as the column takes it. */
function columnValue(field: UndoField, v: unknown): unknown {
  if (DATE_FIELDS.has(field)) return v ? new Date(v as string) : null;
  if (field === 'recurrenceRule') return v === null ? Prisma.DbNull : (v as Prisma.InputJsonValue);
  return v;
}

/** Everything a merge reads about the rows around its tasks, once. */
interface RowsAround {
  checklist: { id: string; taskId: string; text: string; done: boolean; position: number }[];
  files: { id: string; taskId: string; filename: string; sizeBytes: number; storageKey: string }[];
  contacts: ({ id: string; taskId: string; position: number } & ContactValues)[];
  assignees: { taskId: string; userId: string; name: string }[];
  watchers: { taskId: string; userId: string }[];
  tags: { taskId: string; tagId: string }[];
  edges: DependencyEdge[];
  graph: DependencyEdge[];
  followUps: { id: string; taskId: string }[];
}

async function rowsAround(db: Db, ids: string[]): Promise<RowsAround> {
  const [checklist, files, contacts, assignees, watchers, tags, edges, followUps] = await Promise.all([
    db.checklistItem.findMany({ where: { taskId: { in: ids } }, select: { id: true, taskId: true, text: true, done: true, position: true }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] }),
    db.attachment.findMany({ where: { taskId: { in: ids } }, select: { id: true, taskId: true, filename: true, sizeBytes: true, storageKey: true }, orderBy: { createdAt: 'asc' } }),
    db.taskExternalContact.findMany({
      where: { taskId: { in: ids } },
      select: { id: true, taskId: true, position: true, name: true, company: true, designation: true, email: true, phone: true, remarks: true },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    }),
    db.taskAssignee.findMany({ where: { taskId: { in: ids } }, select: { taskId: true, userId: true, user: { select: { username: true, firstName: true, lastName: true } } }, orderBy: { assignedAt: 'asc' } }),
    db.taskWatcher.findMany({ where: { taskId: { in: ids } }, select: { taskId: true, userId: true } }),
    db.taskTag.findMany({ where: { taskId: { in: ids } }, select: { taskId: true, tagId: true } }),
    // Live links only: a deleted task no longer blocks anything (dependency repository).
    db.taskDependency.findMany({
      where: { OR: [{ taskId: { in: ids } }, { dependsOnTaskId: { in: ids } }], task: { deletedAt: null }, dependsOn: { deletedAt: null } },
      select: { id: true, taskId: true, dependsOnTaskId: true },
    }),
    db.inspectionFollowUp.findMany({ where: { taskId: { in: ids } }, select: { id: true, taskId: true } }),
  ]);
  // The links around them, for loops: every live link (blocker links are few).
  const graph = await db.taskDependency.findMany({ where: { task: { deletedAt: null }, dependsOn: { deletedAt: null } }, select: { id: true, taskId: true, dependsOnTaskId: true } });
  return {
    checklist,
    files,
    contacts,
    assignees: assignees.map((a) => ({ taskId: a.taskId, userId: a.userId, name: displayName({ username: a.user.username, firstName: a.user.firstName, lastName: a.user.lastName }) })),
    watchers,
    tags,
    edges,
    graph,
    followUps: followUps.filter((f): f is { id: string; taskId: string } => f.taskId !== null),
  };
}

/** What the merge does with the rows around its tasks: what moves, what is kept once, what is left off. */
interface RowPlan {
  checklist: { id: string; fromTaskId: string; position: number; newPosition: number }[];
  checklistDupes: { id: string; fromTaskId: string }[];
  files: { id: string; fromTaskId: string }[];
  fileDupes: { id: string; fromTaskId: string }[];
  contacts: { id: string; fromTaskId: string; position: number; newPosition: number }[];
  contactDupes: { id: string; fromTaskId: string }[];
  fills: { contactId: string; fromTaskId: string; fill: Partial<ContactValues> }[];
  assignees: { userId: string; fromTaskId: string }[];
  assigneeDupes: number;
  watchers: { userId: string; fromTaskId: string }[];
  watcherDupes: number;
  watchersLeftOff: number;
  tags: { tagId: string; fromTaskId: string }[];
  tagDupes: number;
  links: ReturnType<typeof dependencyPlan>;
  followUps: { id: string; fromTaskId: string }[];
  /** People assigned who aren't on the target project's team (and the tasks they are on). */
  outsiders: Map<string, { name: string; keys: string[]; onMain: boolean }>;
}

/**
 * The merge's choices of what moves. Duplicates (kept once) are found against the main task and the
 * tasks before it in the order chosen; two copies within one task aren't duplicates of each other.
 */
async function planRows(
  rows: RowsAround,
  main: MergeTask,
  others: MergeTask[],
  target: { projectId: string; team: Set<string> },
  people: Record<string, PersonChoice>,
  hashOf: (storageKey: string) => Promise<string | null>,
): Promise<RowPlan> {
  const plan: RowPlan = {
    checklist: [], checklistDupes: [], files: [], fileDupes: [], contacts: [], contactDupes: [], fills: [], assignees: [], assigneeDupes: 0,
    watchers: [], watcherDupes: 0, watchersLeftOff: 0, tags: [], tagDupes: 0, links: { move: [], dropped: [] }, followUps: [], outsiders: new Map(),
  };
  const ofTask = <T extends { taskId: string }>(list: T[], id: string) => list.filter((r) => r.taskId === id);

  // Checklist: after the main task's items, each task's in its own order.
  const keys = new Set(ofTask(rows.checklist, main.id).map(checklistKey));
  let nextPos = Math.max(-1, ...ofTask(rows.checklist, main.id).map((c) => c.position)) + 1;
  for (const t of others) {
    const mine = ofTask(rows.checklist, t.id);
    for (const c of mine) {
      if (keys.has(checklistKey(c))) plan.checklistDupes.push({ id: c.id, fromTaskId: t.id });
      else plan.checklist.push({ id: c.id, fromTaskId: t.id, position: c.position, newPosition: nextPos++ });
    }
    for (const c of mine) keys.add(checklistKey(c));
  }

  // Files: the same name and size, then the same content.
  const kept = ofTask(rows.files, main.id).slice();
  for (const t of others) {
    const mine = ofTask(rows.files, t.id);
    for (const f of mine) {
      let dup = false;
      for (const k of kept.filter((x) => fileKey(x) === fileKey(f))) {
        const [a, b] = await Promise.all([hashOf(k.storageKey), hashOf(f.storageKey)]);
        if (a && b && a === b) {
          dup = true;
          break;
        }
      }
      if (dup) plan.fileDupes.push({ id: f.id, fromTaskId: t.id });
      else plan.files.push({ id: f.id, fromTaskId: t.id });
    }
    kept.push(...mine.filter((f) => !plan.fileDupes.some((d) => d.id === f.id)));
  }

  // External contacts: the same email or phone is one person — the kept copy gets the missing fields.
  const keptContacts: (RowsAround['contacts'][number] & { filled: Partial<ContactValues> })[] = ofTask(rows.contacts, main.id).map((c) => ({ ...c, filled: {} }));
  let nextContact = Math.max(-1, ...ofTask(rows.contacts, main.id).map((c) => c.position)) + 1;
  for (const t of others) {
    const mine = ofTask(rows.contacts, t.id);
    const keptBefore = keptContacts.slice();
    for (const c of mine) {
      const match = keptBefore.find((k) => sameContact(k, c));
      if (!match) {
        plan.contacts.push({ id: c.id, fromTaskId: t.id, position: c.position, newPosition: nextContact++ });
        keptContacts.push({ ...c, filled: {} });
        continue;
      }
      plan.contactDupes.push({ id: c.id, fromTaskId: t.id });
      const values = { ...match, ...match.filled };
      const fill = contactFill(values, c);
      if (Object.keys(fill).length > 0) {
        Object.assign(match.filled, fill);
        plan.fills.push({ contactId: match.id, fromTaskId: t.id, fill });
      }
    }
  }

  // People: once each; someone not on the target team is a question (added to it, or left off).
  const assigned = new Set(ofTask(rows.assignees, main.id).map((a) => a.userId));
  const projectChanges = target.projectId !== main.projectId;
  if (projectChanges) {
    for (const a of ofTask(rows.assignees, main.id)) {
      if (!target.team.has(a.userId)) plan.outsiders.set(a.userId, { name: a.name, keys: [main.key], onMain: true });
    }
  }
  for (const t of others) {
    for (const a of ofTask(rows.assignees, t.id)) {
      if (assigned.has(a.userId)) {
        plan.assigneeDupes++;
        continue;
      }
      if (!target.team.has(a.userId)) {
        const o = plan.outsiders.get(a.userId) ?? { name: a.name, keys: [], onMain: false };
        o.keys.push(t.key);
        plan.outsiders.set(a.userId, o);
        if (people[a.userId] !== 'ADD_TO_TEAM') continue; // left off (or not answered yet): it stays on its own task
      }
      assigned.add(a.userId);
      plan.assignees.push({ userId: a.userId, fromTaskId: t.id });
    }
  }
  const joining = new Set(Object.entries(people).filter(([, c]) => c === 'ADD_TO_TEAM').map(([id]) => id));
  const watching = new Set(ofTask(rows.watchers, main.id).map((w) => w.userId));
  for (const t of others) {
    for (const w of ofTask(rows.watchers, t.id)) {
      if (watching.has(w.userId)) plan.watcherDupes++;
      else if (!target.team.has(w.userId) && !joining.has(w.userId)) plan.watchersLeftOff++;
      else {
        watching.add(w.userId);
        plan.watchers.push({ userId: w.userId, fromTaskId: t.id });
      }
    }
  }
  const tagged = new Set(ofTask(rows.tags, main.id).map((t) => t.tagId));
  for (const t of others) {
    for (const tag of ofTask(rows.tags, t.id)) {
      if (tagged.has(tag.tagId)) plan.tagDupes++;
      else {
        tagged.add(tag.tagId);
        plan.tags.push({ tagId: tag.tagId, fromTaskId: t.id });
      }
    }
  }

  plan.links = dependencyPlan(rows.edges, main.id, others.map((t) => t.id), rows.graph);
  // The follow-up of a failed inspection item: one per task, so the main task takes the first it lacks.
  let mainFollows = rows.followUps.some((f) => f.taskId === main.id);
  for (const t of others) {
    for (const f of rows.followUps.filter((x) => x.taskId === t.id)) {
      if (mainFollows) continue;
      mainFollows = true;
      plan.followUps.push({ id: f.id, fromTaskId: t.id });
    }
  }
  return plan;
}

/**
 * Merge tasks (1.23.1): two or more tasks combined into one main task in one transaction — nothing is
 * deleted. Comments, files, checklist items, history, inspections, action items and notices move to the
 * main task keeping their authors and times; people, watchers, tags, contacts and blocker links are
 * combined (each once); descriptions are joined under headings. The other tasks become read-only merged
 * records, hidden everywhere, their numbers aliases of the main task. Undo gives it all back.
 *
 * Who: administrators, and the manager/owner of every project involved (managedVisibleWhere). Not in the
 * trash, not already merged, not in an archived or completed project; a task holding merged tasks may
 * only be the main task (no chains).
 */
export function createTaskMergeService(deps: MergeServiceDeps) {
  const { prisma, now = () => new Date(), timeZone = defaultCompanyTimeZone() } = deps;
  const isAdmin = (a: MergeActor) => (a.roles ?? []).includes('ADMIN');

  /** The projects the actor manages, or null for an administrator (every one). */
  async function managedBy(actor: MergeActor, db: Db = prisma): Promise<Set<string> | null> {
    if (isAdmin(actor)) return null;
    const rows = await db.project.findMany({ where: { deletedAt: null, ...managedVisibleWhere(actor.id) }, select: { id: true } });
    return new Set(rows.map((r) => r.id));
  }
  const manages = (scope: Set<string> | null, projectId: string) => scope === null || scope.has(projectId);

  /** The tasks among `ids` that hold merged tasks (an active merge into them). */
  async function holders(db: Db, ids: string[]): Promise<Set<string>> {
    const rows = await db.taskMerge.findMany({ where: { mainTaskId: { in: ids }, undoneAt: null }, select: { mainTaskId: true } });
    return new Set(rows.map((r) => r.mainTaskId));
  }

  /** Why this task can't be in a merge (as the main task when `asMain`), or null. */
  async function refusalOf(db: Db, t: MergeTask, scope: Set<string> | null, holding: Set<string>, asMain: boolean): Promise<string | null> {
    if (t.mergedIntoId) {
      const into = await db.task.findUnique({ where: { id: t.mergedIntoId }, select: { key: true } });
      return `Already merged into ${into?.key ?? 'another task'}.`;
    }
    if (t.deletedAt || t.projectDeleted) return 'It was deleted.';
    if (t.projectArchived) return `${t.projectName} is archived.`;
    if (t.projectStatus === 'COMPLETED') return `${t.projectName} is completed.`;
    if (!manages(scope, t.projectId)) return `You need to manage ${t.projectName} to merge its tasks.`;
    if (!asMain && holding.has(t.id)) return `Tasks were merged into ${t.key}: it can only be the main task.`;
    return null;
  }

  const hasher = () => {
    const seen = new Map<string, Promise<string | null>>();
    return (storageKey: string) => {
      let h = seen.get(storageKey);
      if (!h) {
        h = (deps.readFile ? deps.readFile(storageKey) : Promise.resolve(null))
          .then((b) => (b ? createHash('sha256').update(b).digest('hex') : null))
          .catch(() => null);
        seen.set(storageKey, h);
      }
      return h;
    };
  };

  /** The facts the dialog shows for a linked meeting: its title only to someone who may see it. */
  async function withMeetingTitles(actor: MergeActor, tasks: MergeTask[]): Promise<MergeTask[]> {
    if (!deps.canViewMeeting) return tasks;
    return Promise.all(tasks.map(async (t) => (t.meetingId && !(await deps.canViewMeeting!(actor.id, actor.roles ?? [], t.meetingId)) ? { ...t, meetingTitle: null } : t)));
  }

  function check(taskIds: string[]): string[] {
    const ids = unique(taskIds);
    if (ids.length > MAX_MERGE_TASKS) throw new ValidationError(`Merge at most ${MAX_MERGE_TASKS} tasks at a time.`);
    return ids;
  }

  async function preview(actor: MergeActor, input: { taskIds: string[]; mainTaskId?: string; choices?: MergeChoices; people?: Record<string, PersonChoice> }): Promise<MergePreview> {
    const ids = check(input.taskIds);
    const scope = await managedBy(actor);
    const found = await withMeetingTitles(actor, await loadMergeTasks(prisma, ids));
    const holding = await holders(prisma, found.map((t) => t.id));
    const counts = await loadCounts(prisma, found.map((t) => t.id));
    const byId = new Map(found.map((t) => [t.id, t]));
    const askedMain = input.mainTaskId && byId.has(input.mainTaskId) ? input.mainTaskId : null;
    const tasks: MergePreviewTask[] = [];
    for (const id of ids) {
      const t = byId.get(id);
      if (!t) {
        tasks.push(hiddenTask(id));
        continue;
      }
      const reason = await refusalOf(prisma, t, scope, holding, id === askedMain);
      tasks.push({
        id: t.id, key: t.key, title: t.title, projectId: t.projectId, projectName: t.projectName, status: { name: t.columnName, category: t.columnCategory },
        createdAt: t.createdAt, createdByName: t.createdByName, version: t.version, canMerge: reason === null, reason, counts: counts.get(t.id) ?? emptyCounts(),
      });
    }
    const mergeable = found.filter((t) => tasks.find((p) => p.id === t.id)?.canMerge);
    // The main task: the one asked for when it can be merged — otherwise the oldest one that can
    // (a task holding merged tasks may only be the main task).
    let mainId = askedMain && mergeable.some((t) => t.id === askedMain) ? askedMain : null;
    if (!mainId) {
      const holdingOnes = found.filter((t) => holding.has(t.id) && tasks.find((p) => p.id === t.id)?.reason?.startsWith('Tasks were merged'));
      mainId = holdingOnes.length === 1 ? holdingOnes[0]!.id : defaultMainId(mergeable);
      if (mainId && holdingOnes.length === 1) {
        // That task can be the main task: say so on its row.
        const row = tasks.find((p) => p.id === mainId)!;
        if (row.reason?.startsWith('Tasks were merged')) Object.assign(row, { canMerge: true, reason: null });
        if (!mergeable.some((t) => t.id === mainId)) mergeable.push(byId.get(mainId)!);
      }
    }
    // Two tasks that each hold merged tasks can't both be the main task.
    for (const row of tasks) if (row.id !== mainId && holding.has(row.id) && row.canMerge) Object.assign(row, { canMerge: false, reason: `Tasks were merged into ${row.key}: it can only be the main task.` });
    const usable = mergeable.filter((t) => tasks.find((p) => p.id === t.id)?.canMerge);
    const empty: MergePreview = {
      tasks, mainTaskId: mainId, canMerge: false, reason: null, differences: [], project: null,
      duplicates: { checklist: 0, files: 0, contacts: 0, assignees: 0, watchers: 0, tags: 0, blockers: 0 }, duplicatesText: null, droppedLinks: [], outsiders: [], watchersLeftOff: 0, descriptionTooLong: false,
    };
    if (!mainId || usable.length < MIN_MERGE_TASKS) return { ...empty, reason: 'Choose at least 2 tasks you can merge.' };
    const main = byId.get(mainId)!;
    const others = mainFirst(usable, mainId).slice(1);
    const resolved = resolveChoices(usable, mainId, input.choices);
    if (!resolved.ok) throw new ValidationError(`That choice for ${resolved.field} isn’t one of the tasks being merged.`);
    const targetTask = byId.get(resolved.sources.project)!;
    const projectChanges = targetTask.projectId !== main.projectId;
    const rows = await rowsAround(prisma, usable.map((t) => t.id));
    const allPeople = unique(rows.assignees.map((a) => a.userId).concat(rows.watchers.map((w) => w.userId)));
    const team = await teamOf(prisma, targetTask.projectId, allPeople);
    const plan = await planRows(rows, main, others, { projectId: targetTask.projectId, team }, input.people ?? {}, hasher());
    const joinable = await joinableOf(prisma, targetTask.projectId, [...plan.outsiders.keys()]);
    const newKey = projectChanges ? `${targetTask.projectCode}-${(await highestKeyNumber(prisma, targetTask.projectId)) + 1}` : null;
    const duplicates: MergeDuplicates = {
      checklist: plan.checklistDupes.length,
      files: plan.fileDupes.length,
      contacts: plan.contactDupes.length,
      assignees: plan.assigneeDupes,
      watchers: plan.watcherDupes,
      tags: plan.tagDupes,
      blockers: plan.links.dropped.filter((d) => d.reason === 'duplicate').length,
    };
    const keyOf = (id: string) => byId.get(id)?.key;
    const otherEnds = unique(plan.links.dropped.map((d) => (d.edge.taskId === d.fromTaskId ? d.edge.dependsOnTaskId : d.edge.taskId)));
    const ends = new Map((await prisma.task.findMany({ where: { id: { in: otherEnds } }, select: { id: true, key: true, title: true } })).map((t) => [t.id, t]));
    const droppedLinks: DroppedLink[] = plan.links.dropped
      .filter((d) => d.reason !== 'duplicate')
      .map((d) => {
        const other = d.edge.taskId === d.fromTaskId ? d.edge.dependsOnTaskId : d.edge.taskId;
        return { key: keyOf(d.fromTaskId) ?? '', otherKey: ends.get(other)?.key ?? keyOf(other) ?? '', otherTitle: ends.get(other)?.title ?? '', reason: d.reason as 'between' | 'loop' };
      });
    const combined = combineDescriptions(main, others);
    const tooLong = utf8Bytes(combined.text) > DESCRIPTION_MAX_BYTES;
    return {
      tasks,
      mainTaskId: mainId,
      canMerge: !tooLong,
      reason: tooLong ? 'The descriptions together are too long for one task. Shorten one of them first.' : null,
      differences: differences(usable, mainId, timeZone),
      project: { id: targetTask.projectId, name: targetTask.projectName, code: targetTask.projectCode, changes: projectChanges, newKey },
      duplicates,
      duplicatesText: duplicatesText(duplicates),
      droppedLinks,
      outsiders: [...plan.outsiders.entries()].map(([id, o]) => ({ id, name: o.name, canJoin: joinable.has(id), keys: o.keys })),
      watchersLeftOff: plan.watchersLeftOff,
      descriptionTooLong: tooLong,
    };
  }

  async function merge(actor: MergeActor, input: MergeInput): Promise<MergeResult> {
    const ids = check(input.taskIds);
    if (ids.length < MIN_MERGE_TASKS) throw new ValidationError('Choose at least 2 tasks to merge.');
    if (!ids.includes(input.mainTaskId)) throw new ValidationError('The main task must be one of the tasks being merged.');
    let result: MergeResult | null = null;
    for (let attempt = 0; !result; attempt++) {
      try {
        result = await prisma.$transaction((tx) => mergeIn(tx, actor, ids, input), TX);
      } catch (err) {
        if (!isTaskKeyConflict(err)) throw err;
        if (attempt >= KEY_ATTEMPTS - 1) throw new ConflictError('Another task took that number at the same moment. Please try again.', 'TASK_KEY_CONFLICT');
      }
    }
    try {
      await deps.onMerged?.({ ...result, actorId: actor.id });
    } catch (err) {
      deps.onError?.(err, 'after a merge');
    }
    return result;
  }

  /** The merge itself, in one transaction: any failure rolls every change back. */
  async function mergeIn(tx: Prisma.TransactionClient, actor: MergeActor, ids: string[], input: MergeInput): Promise<MergeResult> {
    const at = now();
    // Hold the tasks: nothing else changes them (or adds to them) until the merge is saved.
    await tx.$queryRaw`SELECT id FROM tasks WHERE id IN (${Prisma.join(ids)}) FOR UPDATE`;
    const scope = await managedBy(actor, tx);
    const tasks = await loadMergeTasks(tx, ids);
    if (tasks.length !== ids.length) throw new NotFoundError('Task not found.');
    const holding = await holders(tx, ids);
    for (const t of tasks) {
      const reason = await refusalOf(tx, t, scope, holding, t.id === input.mainTaskId);
      if (reason) throw reason.startsWith('You need to manage') ? new ForbiddenError(reason) : new MergeRefusal(`${t.key}: ${reason}`, 'CANT_MERGE');
      const shown = input.versions?.[t.id];
      if (shown !== undefined && shown !== t.version) throw new ConflictError(`${t.key} changed while you were merging. Look again and try once more.`, 'VERSION_CONFLICT');
    }
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const main = byId.get(input.mainTaskId)!;
    const others = mainFirst(tasks, main.id).slice(1);
    const resolved = resolveChoices(tasks, main.id, input.choices);
    if (!resolved.ok) throw new ValidationError(`That choice for ${resolved.field} isn’t one of the tasks being merged.`);
    const src = (f: MergeField) => byId.get(resolved.sources[f]) ?? null;
    const targetTask = src('project')!;
    const projectId = targetTask.projectId;
    const projectChanges = projectId !== main.projectId;

    const rows = await rowsAround(tx, ids);
    const people = input.people ?? {};
    const allPeople = unique(rows.assignees.map((a) => a.userId).concat(rows.watchers.map((w) => w.userId)));
    const team = await teamOf(tx, projectId, allPeople);
    const plan = await planRows(rows, main, others, { projectId, team }, people, hasher());
    // Everyone assigned who isn't on the team needs an answer; someone from another company can only be left off.
    const unanswered = [...plan.outsiders.entries()].filter(([id]) => !people[id]).map(([id, o]) => ({ id, name: o.name }));
    if (unanswered.length > 0) {
      throw new MergeRefusal(`${listWords(unanswered.map((p) => p.name))} ${unanswered.length === 1 ? 'isn’t' : 'aren’t'} on the ${targetTask.projectName} team. Choose whether to add them to the team or leave them off.`, 'ASSIGNEES_NOT_ON_TEAM', 409, { people: unanswered });
    }
    const joinable = await joinableOf(tx, projectId, [...plan.outsiders.keys()]);
    const cannot = [...plan.outsiders.entries()].filter(([id]) => people[id] === 'ADD_TO_TEAM' && !joinable.has(id)).map(([id, o]) => ({ id, name: o.name }));
    if (cannot.length > 0) {
      throw new MergeRefusal(`${listWords(cannot.map((p) => p.name))} can’t join the ${targetTask.projectName} team: they aren’t in any of its companies. Leave them off instead.`, 'CANT_JOIN_TEAM', 409, { people: cannot });
    }
    const addedToTeam = [...plan.outsiders.entries()].filter(([id]) => people[id] === 'ADD_TO_TEAM').map(([id, o]) => ({ id, name: o.name }));
    const leftOff = [...plan.outsiders.entries()].filter(([id]) => people[id] === 'LEAVE_OFF').map(([id, o]) => ({ id, name: o.name }));
    // The main task's own people left off when its project changes are taken off it (as a move does).
    const mainLeftOff = [...plan.outsiders.entries()].filter(([id, o]) => o.onMain && people[id] === 'LEAVE_OFF').map(([id]) => id);

    // ---- The main task's fields -------------------------------------------------------------
    const combined = combineDescriptions(main, others);
    if (utf8Bytes(combined.text) > DESCRIPTION_MAX_BYTES) throw new MergeRefusal('The descriptions together are too long for one task. Shorten one of them first.', 'DESCRIPTION_TOO_LONG');
    const columns = await tx.kanbanColumn.findMany({ where: { projectId }, select: { id: true, name: true, category: true, position: true, enabled: true } });
    const statusTask = src('status')!;
    const column = statusTask.projectId === projectId ? columns.find((c) => c.id === statusTask.columnId) : matchingColumn(columns, statusTask.columnCategory);
    if (!column) throw new MergeRefusal(`${targetTask.projectName} has no columns to put the task in.`, 'NO_COLUMNS', 400);
    const repeat = resolved.sources.repeat === 'none' ? null : src('repeat');
    const form = src('inspectionForm')!;
    const client = src('clientVisible')!;
    const approval = src('needsApproval')!;
    const needsApproval = approval.needsApproval;
    const before = storedFields(main as unknown as Record<string, unknown>);
    const after: StoredFields = { ...before };
    const set = <F extends UndoField>(f: F, v: unknown) => {
      after[f] = DATE_FIELDS.has(f) ? iso(v as Date | null) : (v ?? null);
    };
    set('title', src('title')!.title);
    set('description', combined.text);
    set('priority', src('priority')!.priority);
    set('startDate', src('startDate')!.startDate);
    set('dueDate', src('dueDate')!.dueDate);
    set('isMilestone', src('milestone')!.isMilestone);
    set('clientVisible', client.clientVisible);
    set('clientShowDescription', client.clientVisible && client.clientShowDescription);
    set('recurrenceRule', repeat ? repeat.recurrenceRule : null);
    set('inspectionFormId', form.inspectionFormId);
    set('inspectionPlace', form.inspectionPlace);
    set('meetingId', src('meeting')!.meetingId);
    set('needsApproval', needsApproval);
    // The status: the chosen task's column (or the same kind of column in the main task's project), and
    // its completion and approval with it — completion always follows the column.
    let boardDate: Date | undefined;
    if (column.id !== main.columnId) {
      set('columnId', column.id);
      const done = column.category === 'DONE';
      const statusSame = statusTask.id === main.id;
      if (done) {
        set('completedAt', statusTask.completedAt ?? (main.completedAt ?? at));
        set('progress', 100);
        if (!main.completedAt && !statusTask.completedAt) boardDate = boardDateFromKey(boardDateKey(at, timeZone));
      } else {
        set('completedAt', null);
        if (main.completedAt) set('progress', deps.checklistPercent ? await deps.checklistPercent(main.id, tx) : 0);
      }
      const waits = !statusSame && statusTask.approvalRequestedAt && needsApproval;
      set('approvalRequestedAt', waits ? statusTask.approvalRequestedAt : null);
      set('approvalRequestedById', waits ? statusTask.approvalRequestedById : null);
      if (done) {
        // Into Done: approved by the person merging (they run every project involved) when it needs approval.
        set('approvedAt', statusTask.approvedAt ?? (needsApproval && !main.approvedAt ? at : main.approvedAt));
        set('approvedById', statusTask.approvedAt ? statusTask.approvedById : needsApproval && !main.approvedAt ? actor.id : main.approvedById);
      } else {
        set('approvedAt', null);
        set('approvedById', null);
      }
      // A client's sign-off is of a finish: it stays only with a Done column (from the task it came with).
      set('clientAcceptedAt', done ? (statusTask.clientAcceptedAt ?? null) : null);
      set('clientAcceptedById', done ? (statusTask.clientAcceptedById ?? null) : null);
    }
    if (!needsApproval && main.approvalRequestedAt && after.approvalRequestedAt) {
      set('approvalRequestedAt', null);
      set('approvalRequestedById', null);
    }
    const changes: Record<string, FieldChange> = {};
    for (const f of UNDO_FIELDS) if (JSON.stringify(before[f]) !== JSON.stringify(after[f])) changes[f] = { before: before[f], after: after[f] };

    // ---- The merge's own row --------------------------------------------------------------------
    let mainKey = main.key;
    if (projectChanges) mainKey = await firstFreeKey(tx, targetTask.projectCode, (await highestKeyNumber(tx, projectId)) + 1);
    const summary = {
      duplicates: { checklist: plan.checklistDupes.length, files: plan.fileDupes.length, contacts: plan.contactDupes.length, assignees: plan.assigneeDupes, watchers: plan.watcherDupes, tags: plan.tagDupes },
      droppedLinks: plan.links.dropped.map((d) => ({ id: d.edge.id, reason: d.reason, fromTaskId: d.fromTaskId })),
      addedToTeam,
      leftOff,
      mainLeftOff,
      descriptionParts: combined.parts,
      choices: resolved.sources,
    };
    const record = await tx.taskMerge.create({
      data: {
        mainTaskId: main.id,
        mainKeyBefore: main.key,
        mainKeyAfter: mainKey,
        mainProjectBefore: main.projectId,
        mainProjectAfter: projectId,
        taskIds: others.map((t) => ({ id: t.id, key: t.key })) as unknown as Prisma.InputJsonValue,
        changes: changes as unknown as Prisma.InputJsonValue,
        summary: summary as unknown as Prisma.InputJsonValue,
        mergedById: actor.id,
        mergedAt: at,
      },
    });
    const mergeId = record.id;
    const items: Prisma.TaskMergeItemCreateManyInput[] = [];
    const item = (kind: string, rowId: string, fromTaskId: string, data?: unknown) =>
      items.push({ mergeId, kind, rowId, fromTaskId, ...(data !== undefined ? { data: data as Prisma.InputJsonValue } : {}) });

    // ---- The main task ---------------------------------------------------------------------------
    const patch: Prisma.TaskUncheckedUpdateManyInput = { version: { increment: 1 } };
    for (const f of Object.keys(changes) as UndoField[]) (patch as Record<string, unknown>)[f] = columnValue(f, after[f]);
    if (boardDate) patch.boardDate = boardDate;
    if (projectChanges) {
      const last = await tx.task.aggregate({ where: { columnId: column.id, deletedAt: null }, _max: { position: true } });
      Object.assign(patch, { key: mainKey, projectId, position: (last._max.position ?? -1) + 1 });
    }
    const { count } = await tx.task.updateMany({ where: { id: main.id, version: main.version, deletedAt: null }, data: patch });
    if (count === 0) throw new ConflictError(`${main.key} changed while you were merging. Look again and try once more.`, 'VERSION_CONFLICT');
    if (projectChanges) {
      // Its old number keeps finding it, and its history is filed under its new project (as a move does).
      const kept = await tx.taskKeyAlias.findUnique({ where: { key: main.key }, select: { taskId: true } });
      if (!kept) await tx.taskKeyAlias.create({ data: { key: main.key, taskId: main.id, projectId: main.projectId } });
      await tx.activity.updateMany({ where: { taskId: main.id }, data: { projectId } });
      if (mainLeftOff.length > 0) await tx.taskAssignee.deleteMany({ where: { taskId: main.id, userId: { in: mainLeftOff } } });
    }
    if (addedToTeam.length > 0) await tx.projectMember.createMany({ data: addedToTeam.map((p) => ({ projectId, userId: p.id })), skipDuplicates: true });

    // ---- The merged tasks: read-only records, hidden, their numbers the main task's -------------------
    for (const t of others) {
      const done = await tx.task.updateMany({
        where: { id: t.id, version: t.version, deletedAt: null, mergedIntoId: null },
        data: { mergedIntoId: main.id, mergedAt: at, mergedById: actor.id, mergeId, deletedAt: at, version: { increment: 1 } },
      });
      if (done.count === 0) throw new ConflictError(`${t.key} changed while you were merging. Look again and try once more.`, 'VERSION_CONFLICT');
      const alias = await tx.taskKeyAlias.create({ data: { key: t.key, taskId: main.id, projectId: t.projectId } });
      item('aliasNew', alias.id, t.id);
      for (const a of await tx.taskKeyAlias.findMany({ where: { taskId: t.id }, select: { id: true } })) item('alias', a.id, t.id);
    }
    const otherIds = others.map((t) => t.id);
    await tx.taskKeyAlias.updateMany({ where: { taskId: { in: otherIds } }, data: { taskId: main.id } });

    // ---- What moves to the main task --------------------------------------------------------------
    const moveAll = async (kind: string, find: () => Promise<{ id: string; from: string; data?: unknown }[]>, write: (ids: string[]) => Promise<unknown>) => {
      const found = await find();
      for (const r of found) item(kind, r.id, r.from, r.data);
      if (found.length) await write(found.map((r) => r.id));
    };
    await moveAll(
      'comment',
      async () => (await tx.comment.findMany({ where: { taskId: { in: otherIds } }, select: { id: true, taskId: true } })).map((c) => ({ id: c.id, from: c.taskId })),
      (rowIds) => tx.comment.updateMany({ where: { id: { in: rowIds } }, data: { taskId: main.id } }),
    );
    await moveAll(
      'activity',
      async () => (await tx.activity.findMany({ where: { taskId: { in: otherIds } }, select: { id: true, taskId: true, projectId: true } })).map((a) => ({ id: a.id, from: a.taskId!, data: { projectId: a.projectId } })),
      (rowIds) => tx.activity.updateMany({ where: { id: { in: rowIds } }, data: { taskId: main.id, projectId } }),
    );
    await moveAll(
      'inspection',
      async () => (await tx.inspection.findMany({ where: { taskId: { in: otherIds } }, select: { id: true, taskId: true } })).map((i) => ({ id: i.id, from: i.taskId! })),
      (rowIds) => tx.inspection.updateMany({ where: { id: { in: rowIds } }, data: { taskId: main.id } }),
    );
    await moveAll(
      'actionItem',
      async () => (await tx.actionItem.findMany({ where: { taskId: { in: otherIds } }, select: { id: true, taskId: true } })).map((a) => ({ id: a.id, from: a.taskId! })),
      (rowIds) => tx.actionItem.updateMany({ where: { id: { in: rowIds } }, data: { taskId: main.id } }),
    );
    await moveAll(
      'meetingNote',
      async () => (await tx.meetingNote.findMany({ where: { taskId: { in: otherIds } }, select: { id: true, taskId: true } })).map((n) => ({ id: n.id, from: n.taskId! })),
      (rowIds) => tx.meetingNote.updateMany({ where: { id: { in: rowIds } }, data: { taskId: main.id } }),
    );
    await moveAll(
      'notification',
      async () =>
        (await tx.notification.findMany({ where: { entityType: { in: TASK_ENTITIES }, entityId: { in: otherIds } }, select: { id: true, entityId: true, projectId: true } })).map((n) => ({
          id: n.id,
          from: n.entityId!,
          data: { projectId: n.projectId },
        })),
      (rowIds) => tx.notification.updateMany({ where: { id: { in: rowIds } }, data: { entityId: main.id, projectId } }),
    );
    for (const f of plan.files) item('attachment', f.id, f.fromTaskId);
    if (plan.files.length) await tx.attachment.updateMany({ where: { id: { in: plan.files.map((f) => f.id) } }, data: { taskId: main.id } });
    for (const c of plan.checklist) {
      item('checklist', c.id, c.fromTaskId, { position: c.position });
      await tx.checklistItem.update({ where: { id: c.id }, data: { taskId: main.id, position: c.newPosition } });
    }
    for (const c of plan.contacts) {
      item('contact', c.id, c.fromTaskId, { position: c.position });
      await tx.taskExternalContact.update({ where: { id: c.id }, data: { taskId: main.id, position: c.newPosition } });
    }
    for (const f of plan.fills) {
      item('contactFill', f.contactId, f.fromTaskId, { fill: f.fill });
      await tx.taskExternalContact.update({ where: { id: f.contactId }, data: f.fill as Prisma.TaskExternalContactUncheckedUpdateInput });
    }
    for (const a of plan.assignees) {
      item('assignee', a.userId, a.fromTaskId);
      await tx.taskAssignee.update({ where: { taskId_userId: { taskId: a.fromTaskId, userId: a.userId } }, data: { taskId: main.id } });
    }
    for (const w of plan.watchers) {
      item('watcher', w.userId, w.fromTaskId);
      await tx.taskWatcher.update({ where: { taskId_userId: { taskId: w.fromTaskId, userId: w.userId } }, data: { taskId: main.id } });
    }
    for (const t of plan.tags) {
      item('tag', t.tagId, t.fromTaskId);
      await tx.taskTag.update({ where: { taskId_tagId: { taskId: t.fromTaskId, tagId: t.tagId } }, data: { taskId: main.id } });
    }
    for (const m of plan.links.move) {
      item('dependency', m.edge.id, m.fromTaskId, { side: m.side });
      await tx.taskDependency.update({ where: { id: m.edge.id }, data: m.side === 'blocked' ? { taskId: main.id } : { dependsOnTaskId: main.id } });
    }
    for (const f of plan.followUps) {
      item('followUp', f.id, f.fromTaskId);
      await tx.inspectionFollowUp.update({ where: { id: f.id }, data: { taskId: main.id } });
    }

    // ---- History ---------------------------------------------------------------------------------
    const mergedKeys = others.map((t) => t.key);
    const chosen = Object.entries(resolved.sources)
      .filter(([, source]) => source !== main.id)
      .map(([field, source]) => ({ field, fromKey: source === 'none' ? null : (byId.get(source)?.key ?? null) }));
    const meta = {
      mergeId,
      keys: mergedKeys,
      titles: others.map((t) => t.title),
      mainKey,
      ...(projectChanges ? { fromKey: main.key, toProject: targetTask.projectName } : {}),
      chosen,
      ...(addedToTeam.length ? { addedToTeam: addedToTeam.map((p) => p.name) } : {}),
      ...(leftOff.length ? { leftOff: leftOff.map((p) => p.name) } : {}),
    };
    let tick = 0;
    const stamp = () => new Date(at.getTime() + tick++);
    if (projectChanges) {
      await tx.activity.create({
        data: { taskId: null, projectId: main.projectId, userId: actor.id, action: 'PROJECT_MOVED_OUT', meta: { key: main.key, title: main.title, fromProjectId: main.projectId, fromProject: main.projectName, toProjectId: projectId, toProject: targetTask.projectName, toKey: mainKey }, createdAt: stamp() },
      });
    }
    await tx.activity.create({ data: { taskId: main.id, projectId, userId: actor.id, action: 'TASKS_MERGED', meta: meta as unknown as Prisma.InputJsonValue, createdAt: stamp() } });
    for (const t of others) {
      await tx.activity.create({ data: { taskId: t.id, projectId: t.projectId, userId: actor.id, action: 'MERGED_INTO', meta: { mergeId, key: t.key, title: t.title, intoKey: mainKey, intoId: main.id }, createdAt: stamp() } });
    }
    if (items.length) {
      for (let i = 0; i < items.length; i += 500) await tx.taskMergeItem.createMany({ data: items.slice(i, i + 500) });
    }
    return {
      mergeId,
      mainTaskId: main.id,
      mainKey,
      mainProjectId: projectId,
      mainProjectBefore: main.projectId,
      merged: others.map((t) => ({ id: t.id, key: t.key, projectId: t.projectId })),
      addedToTeam,
      leftOff,
      text: mergedText(mergedKeys, mainKey),
    };
  }

  // ---- The main task's "Merged from" panel, a merged record, redirects -----------------------------

  async function mergedFrom(viewer: MergeActor, mainTaskId: string): Promise<MergedFromPanel> {
    const merges = await prisma.taskMerge.findMany({ where: { mainTaskId, undoneAt: null }, orderBy: { mergedAt: 'asc' }, select: { id: true, mergedAt: true, mergedById: true } });
    const panel: MergedFromPanel = { merges: [], labels: { comments: {}, checklist: {}, activity: {}, files: {} } };
    if (merges.length === 0) return panel;
    const scope = await managedBy(viewer);
    const mergedTasks = await prisma.task.findMany({
      where: { mergeId: { in: merges.map((m) => m.id) }, mergedIntoId: mainTaskId },
      select: { id: true, key: true, title: true, projectId: true, createdAt: true, mergeId: true, project: { select: { name: true } }, createdBy: { select: { username: true, firstName: true, lastName: true } } },
      orderBy: { key: 'asc' },
    });
    const mergers = await prisma.user.findMany({ where: { id: { in: unique(merges.map((m) => m.mergedById)) } }, select: { id: true, username: true, firstName: true, lastName: true } });
    const mainProject = (await prisma.task.findUnique({ where: { id: mainTaskId }, select: { projectId: true } }))?.projectId ?? '';
    for (const m of merges) {
      const tasks = mergedTasks.filter((t) => t.mergeId === m.id);
      const by = mergers.find((u) => u.id === m.mergedById);
      panel.merges.push({
        mergeId: m.id,
        mergedAt: m.mergedAt,
        mergedByName: by ? displayName(by) : null,
        tasks: tasks.map((t) => ({ id: t.id, key: t.key, title: t.title, projectId: t.projectId, projectName: t.project.name, createdByName: displayName(t.createdBy), createdAt: t.createdAt })),
        canUndo: manages(scope, mainProject) && tasks.every((t) => manages(scope, t.projectId)),
      });
    }
    const keys = new Map(mergedTasks.map((t) => [t.id, t.key]));
    const labelled = await prisma.taskMergeItem.findMany({ where: { mergeId: { in: merges.map((m) => m.id) }, kind: { in: ['comment', 'checklist', 'activity', 'attachment'] } }, select: { kind: true, rowId: true, fromTaskId: true } });
    for (const it of labelled) {
      const key = keys.get(it.fromTaskId);
      if (!key) continue;
      const bucket = it.kind === 'comment' ? panel.labels.comments : it.kind === 'checklist' ? panel.labels.checklist : it.kind === 'activity' ? panel.labels.activity : panel.labels.files;
      bucket[it.rowId] = key;
    }
    return panel;
  }

  /** A merged task's own record (read-only), as it was merged — the main task's viewers may read it. */
  async function mergedRecord(mergeId: string, taskId: string): Promise<MergedRecord> {
    const t = await prisma.task.findFirst({
      where: { id: taskId, mergeId },
      select: {
        id: true, key: true, title: true, description: true, priority: true, startDate: true, dueDate: true, isMilestone: true, createdAt: true, mergedAt: true, mergedById: true, mergedIntoId: true,
        project: { select: { id: true, name: true } }, column: { select: { name: true, category: true } }, createdBy: { select: { username: true, firstName: true, lastName: true } },
      },
    });
    const merge = await prisma.taskMerge.findUnique({ where: { id: mergeId }, select: { mainTaskId: true, undoneAt: true } });
    if (!t || !merge || merge.undoneAt || t.mergedIntoId !== merge.mainTaskId) throw new NotFoundError('Merged task not found.');
    const [main, by, kept] = await Promise.all([
      prisma.task.findUnique({ where: { id: merge.mainTaskId }, select: { id: true, key: true } }),
      t.mergedById ? prisma.user.findUnique({ where: { id: t.mergedById }, select: { username: true, firstName: true, lastName: true } }) : null,
      Promise.all([prisma.checklistItem.count({ where: { taskId } }), prisma.attachment.count({ where: { taskId } }), prisma.taskExternalContact.count({ where: { taskId } })]),
    ]);
    return {
      id: t.id, key: t.key, title: t.title, description: t.description, project: t.project, status: { name: t.column.name, category: t.column.category }, priority: t.priority,
      startDate: t.startDate, dueDate: t.dueDate, isMilestone: t.isMilestone, createdByName: displayName(t.createdBy), createdAt: t.createdAt, mergedAt: t.mergedAt,
      mergedByName: by ? displayName(by) : null, main: { id: main?.id ?? merge.mainTaskId, key: main?.key ?? '' }, keptOnce: { checklist: kept[0], files: kept[1], contacts: kept[2] },
    };
  }

  /** The main task a merged task's id stands for (an old link, a notice, the app): null when it isn't merged. */
  async function resolveMerged(taskId: string): Promise<{ mainTaskId: string; key: string; mergedAt: Date | null; mergedByName: string | null } | null> {
    let id = taskId;
    let first: { key: string; mergedAt: Date | null; mergedById: string | null } | null = null;
    for (let hop = 0; hop < 3; hop++) {
      const t = await prisma.task.findUnique({ where: { id }, select: { key: true, mergedIntoId: true, mergedAt: true, mergedById: true } });
      if (!t?.mergedIntoId) break;
      first ??= t;
      id = t.mergedIntoId;
    }
    if (!first) return null;
    const by = first.mergedById ? await prisma.user.findUnique({ where: { id: first.mergedById }, select: { username: true, firstName: true, lastName: true } }) : null;
    return { mainTaskId: id, key: first.key, mergedAt: first.mergedAt, mergedByName: by ? displayName(by) : null };
  }

  // ---- Undo ---------------------------------------------------------------------------------------

  type MergeRow = NonNullable<Awaited<ReturnType<typeof loadMerge>>>;
  async function loadMerge(db: Db, mergeId: string) {
    return db.taskMerge.findUnique({ where: { id: mergeId }, include: { items: true } });
  }

  /** Why this merge can't be undone (null when it can), checked against what is there now. */
  async function undoRefusal(db: Db, actor: MergeActor, m: MergeRow): Promise<{ reason: string | null; status: number; code: string; main: MergeTask | null; tasks: MergeTask[] }> {
    const ids = (m.taskIds as unknown as { id: string; key: string }[]).map((t) => t.id);
    const [main] = await loadMergeTasks(db, [m.mainTaskId]);
    const tasks = await loadMergeTasks(db, ids);
    const scope = await managedBy(actor, db);
    if (m.undoneAt) return { reason: 'This merge was already undone.', status: 409, code: 'MERGE_UNDONE', main: main ?? null, tasks };
    if (!main) return { reason: 'The main task was deleted for good, so the merge can’t be undone.', status: 409, code: 'CANT_UNDO', main: null, tasks };
    const allProjects = unique([main.projectId, ...tasks.map((t) => t.projectId)]);
    const names = new Map([main, ...tasks].map((t) => [t.projectId, t.projectName]));
    const notManaged = allProjects.filter((p) => !manages(scope, p));
    if (notManaged.length) return { reason: `You need to manage ${listWords(notManaged.map((p) => names.get(p) ?? 'its project'))} to undo this merge.`, status: 403, code: 'FORBIDDEN', main, tasks };
    if (main.deletedAt || main.projectDeleted) return { reason: `${main.key} was deleted, so the merge can’t be undone.`, status: 409, code: 'CANT_UNDO', main, tasks };
    const gone = ids.filter((id) => !tasks.some((t) => t.id === id));
    if (gone.length) return { reason: 'A merged task was deleted for good, so the merge can’t be undone.', status: 409, code: 'CANT_UNDO', main, tasks };
    for (const t of [main, ...tasks]) {
      if (t.projectArchived) return { reason: `${t.projectName} is archived now — reopen it first.`, status: 409, code: 'PROJECT_ARCHIVED', main, tasks };
      if (t.projectDeleted) return { reason: `${t.projectName} was deleted, so the merge can’t be undone.`, status: 409, code: 'CANT_UNDO', main, tasks };
    }
    for (const t of tasks) if (t.mergedIntoId !== m.mainTaskId) return { reason: `${t.key} is no longer merged into ${main.key}.`, status: 409, code: 'CANT_UNDO', main, tasks };
    return { reason: null, status: 200, code: '', main, tasks };
  }

  /** What was deleted since the merge, per task ("1 file and 2 checklist items from MICO-14 were deleted after the merge."). */
  async function deletedSince(db: Db, m: MergeRow): Promise<string[]> {
    const keys = new Map((m.taskIds as unknown as { id: string; key: string }[]).map((t) => [t.id, t.key]));
    const kinds: { kind: string; one: string; many?: string; exists: (ids: string[]) => Promise<string[]> }[] = [
      { kind: 'attachment', one: 'file', exists: async (ids) => (await db.attachment.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((r) => r.id) },
      { kind: 'checklist', one: 'checklist item', exists: async (ids) => (await db.checklistItem.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((r) => r.id) },
      { kind: 'contact', one: 'external contact', exists: async (ids) => (await db.taskExternalContact.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((r) => r.id) },
      { kind: 'dependency', one: 'blocker link', exists: async (ids) => (await db.taskDependency.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((r) => r.id) },
      { kind: 'actionItem', one: 'action item', exists: async (ids) => (await db.actionItem.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((r) => r.id) },
    ];
    const perTask = new Map<string, string[]>();
    for (const k of kinds) {
      const of = m.items.filter((i) => i.kind === k.kind);
      if (!of.length) continue;
      const there = new Set(await k.exists(of.map((i) => i.rowId)));
      const missing = new Map<string, number>();
      for (const i of of) if (!there.has(i.rowId)) missing.set(i.fromTaskId, (missing.get(i.fromTaskId) ?? 0) + 1);
      for (const [taskId, n] of missing) perTask.set(taskId, [...(perTask.get(taskId) ?? []), countWords(n, k.one, k.many)]);
    }
    return [...perTask.entries()].map(([taskId, words]) => `${capital(listWords(words))} from ${keys.get(taskId) ?? 'a merged task'} ${words.length === 1 && words[0]!.startsWith('1 ') ? 'was' : 'were'} deleted after the merge.`);
  }

  async function undoPreview(actor: MergeActor, mergeId: string): Promise<UndoPreview> {
    const m = await loadMerge(prisma, mergeId);
    if (!m) throw new NotFoundError('Merge not found.');
    const r = await undoRefusal(prisma, actor, m);
    const listed = m.taskIds as unknown as { id: string; key: string }[];
    const projects = await prisma.project.findMany({ where: { id: { in: [m.mainProjectBefore, m.mainProjectAfter] } }, select: { id: true, name: true } });
    const nameOf = (id: string) => projects.find((p) => p.id === id)?.name ?? '';
    return {
      mergeId,
      mainTaskId: m.mainTaskId,
      mainKey: r.main?.key ?? m.mainKeyAfter,
      tasks: listed.map((t) => ({ id: t.id, key: t.key, title: r.tasks.find((x) => x.id === t.id)?.title ?? '' })),
      canUndo: r.reason === null,
      reason: r.reason,
      deletedSince: await deletedSince(prisma, m),
      mainMoved: m.mainProjectBefore !== m.mainProjectAfter ? { fromProject: nameOf(m.mainProjectBefore), toProject: nameOf(m.mainProjectAfter) } : null,
    };
  }

  async function undo(actor: MergeActor, mergeId: string): Promise<UndoResult> {
    const result = await prisma.$transaction((tx) => undoIn(tx, actor, mergeId), TX);
    try {
      await deps.onUndone?.({ ...result, actorId: actor.id });
    } catch (err) {
      deps.onError?.(err, 'after an undo');
    }
    return result;
  }

  async function undoIn(tx: Prisma.TransactionClient, actor: MergeActor, mergeId: string): Promise<UndoResult> {
    const at = now();
    const head = await tx.taskMerge.findUnique({ where: { id: mergeId }, select: { mainTaskId: true, taskIds: true } });
    if (!head) throw new NotFoundError('Merge not found.');
    const listed = head.taskIds as unknown as { id: string; key: string }[];
    await tx.$queryRaw`SELECT id FROM tasks WHERE id IN (${Prisma.join([head.mainTaskId, ...listed.map((t) => t.id)])}) FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM task_merges WHERE id = ${mergeId} FOR UPDATE`;
    const m = (await loadMerge(tx, mergeId))!;
    const r = await undoRefusal(tx, actor, m);
    if (r.reason) throw r.status === 403 ? new ForbiddenError(r.reason) : new MergeRefusal(r.reason, r.code, r.status);
    const main = r.main!;
    const tasks = r.tasks;
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const of = (kind: string) => m.items.filter((i) => i.kind === kind);
    const ids = (kind: string) => of(kind).map((i) => i.rowId);
    const backTo = async (kind: string, write: (fromTaskId: string, rowIds: string[]) => Promise<unknown>) => {
      const groups = new Map<string, string[]>();
      for (const i of of(kind)) groups.set(i.fromTaskId, [...(groups.get(i.fromTaskId) ?? []), i.rowId]);
      for (const [from, rowIds] of groups) await write(from, rowIds);
    };

    // Rows: each back to its own task, as it is now — only those still on the main task.
    await backTo('comment', (from, rowIds) => tx.comment.updateMany({ where: { id: { in: rowIds }, taskId: main.id }, data: { taskId: from } }));
    await backTo('attachment', (from, rowIds) => tx.attachment.updateMany({ where: { id: { in: rowIds }, taskId: main.id }, data: { taskId: from } }));
    await backTo('inspection', (from, rowIds) => tx.inspection.updateMany({ where: { id: { in: rowIds }, taskId: main.id }, data: { taskId: from } }));
    await backTo('actionItem', (from, rowIds) => tx.actionItem.updateMany({ where: { id: { in: rowIds }, taskId: main.id }, data: { taskId: from } }));
    await backTo('meetingNote', (from, rowIds) => tx.meetingNote.updateMany({ where: { id: { in: rowIds }, taskId: main.id }, data: { taskId: from } }));
    await backTo('followUp', (from, rowIds) => tx.inspectionFollowUp.updateMany({ where: { id: { in: rowIds }, taskId: main.id }, data: { taskId: from } }));
    for (const i of of('activity')) {
      const projectId = (i.data as { projectId?: string | null } | null)?.projectId ?? byId.get(i.fromTaskId)?.projectId ?? null;
      await tx.activity.updateMany({ where: { id: i.rowId, taskId: main.id }, data: { taskId: i.fromTaskId, projectId } });
    }
    for (const i of of('notification')) {
      const projectId = (i.data as { projectId?: string | null } | null)?.projectId ?? null;
      await tx.notification.updateMany({ where: { id: i.rowId, entityId: main.id }, data: { entityId: i.fromTaskId, projectId } });
    }
    for (const i of of('checklist')) {
      const position = (i.data as { position?: number } | null)?.position ?? 0;
      await tx.checklistItem.updateMany({ where: { id: i.rowId, taskId: main.id }, data: { taskId: i.fromTaskId, position } });
    }
    // A contact the merge filled in loses what it was given — unless that was changed since.
    for (const i of of('contactFill')) {
      const fill = ((i.data as { fill?: Partial<ContactValues> } | null)?.fill ?? {}) as Partial<ContactValues>;
      const c = await tx.taskExternalContact.findUnique({ where: { id: i.rowId } });
      if (!c) continue;
      const clear: Partial<ContactValues> = {};
      for (const [f, v] of Object.entries(fill) as [keyof ContactValues, string | null][]) if (f !== 'name' && c[f] === v) clear[f] = null;
      if (Object.keys(clear).length) await tx.taskExternalContact.update({ where: { id: i.rowId }, data: clear as Prisma.TaskExternalContactUncheckedUpdateInput });
    }
    for (const i of of('contact')) {
      const position = (i.data as { position?: number } | null)?.position ?? 0;
      await tx.taskExternalContact.updateMany({ where: { id: i.rowId, taskId: main.id }, data: { taskId: i.fromTaskId, position } });
    }
    for (const i of of('dependency')) {
      const side = (i.data as { side?: string } | null)?.side;
      const edge = await tx.taskDependency.findUnique({ where: { id: i.rowId } });
      if (!edge) continue;
      const data = side === 'blocked' ? (edge.taskId === main.id ? { taskId: i.fromTaskId } : null) : edge.dependsOnTaskId === main.id ? { dependsOnTaskId: i.fromTaskId } : null;
      if (!data) continue;
      const next = { taskId: data.taskId ?? edge.taskId, dependsOnTaskId: data.dependsOnTaskId ?? edge.dependsOnTaskId };
      const clash = await tx.taskDependency.findUnique({ where: { taskId_dependsOnTaskId: next } });
      if (!clash) await tx.taskDependency.update({ where: { id: i.rowId }, data });
    }
    // Links: each task gets exactly the people, watchers and tags it had at the merge.
    const links = async (kind: 'assignee' | 'watcher' | 'tag') => {
      for (const i of of(kind)) {
        if (kind === 'assignee') {
          const onMain = await tx.taskAssignee.findUnique({ where: { taskId_userId: { taskId: main.id, userId: i.rowId } } });
          if (onMain) await tx.taskAssignee.update({ where: { taskId_userId: { taskId: main.id, userId: i.rowId } }, data: { taskId: i.fromTaskId } });
          else if (await tx.user.findUnique({ where: { id: i.rowId }, select: { id: true } })) await tx.taskAssignee.createMany({ data: [{ taskId: i.fromTaskId, userId: i.rowId }], skipDuplicates: true });
        } else if (kind === 'watcher') {
          const onMain = await tx.taskWatcher.findUnique({ where: { taskId_userId: { taskId: main.id, userId: i.rowId } } });
          if (onMain) await tx.taskWatcher.update({ where: { taskId_userId: { taskId: main.id, userId: i.rowId } }, data: { taskId: i.fromTaskId } });
          else if (await tx.user.findUnique({ where: { id: i.rowId }, select: { id: true } })) await tx.taskWatcher.createMany({ data: [{ taskId: i.fromTaskId, userId: i.rowId }], skipDuplicates: true });
        } else {
          const onMain = await tx.taskTag.findUnique({ where: { taskId_tagId: { taskId: main.id, tagId: i.rowId } } });
          if (onMain) await tx.taskTag.update({ where: { taskId_tagId: { taskId: main.id, tagId: i.rowId } }, data: { taskId: i.fromTaskId } });
          else if (await tx.tag.findUnique({ where: { id: i.rowId }, select: { id: true } })) await tx.taskTag.createMany({ data: [{ taskId: i.fromTaskId, tagId: i.rowId }], skipDuplicates: true });
        }
      }
    };
    await links('assignee');
    await links('watcher');
    await links('tag');
    // Numbers: the merged tasks' own numbers are theirs again (and the old ones they had).
    await backTo('alias', (from, rowIds) => tx.taskKeyAlias.updateMany({ where: { id: { in: rowIds } }, data: { taskId: from } }));
    if (ids('aliasNew').length) await tx.taskKeyAlias.deleteMany({ where: { id: { in: ids('aliasNew') } } });

    // The merged tasks: back as they were at the merge (their own fields never changed).
    for (const t of tasks) {
      await tx.task.updateMany({ where: { id: t.id, mergeId }, data: { mergedIntoId: null, mergedAt: null, mergedById: null, mergeId: null, deletedAt: null, version: { increment: 1 } } });
    }

    // The main task: each field the merge changed and nobody changed since goes back (call 2). It stays in
    // its project; a column of its earlier project isn't one it can go back to.
    const changes = m.changes as unknown as Record<string, FieldChange>;
    const current = storedFields(main as unknown as Record<string, unknown>);
    const summary = m.summary as unknown as { descriptionParts?: string[] };
    const patch: Record<string, unknown> = {};
    for (const [field, change] of Object.entries(changes) as [UndoField, FieldChange][]) {
      if (field === 'description') {
        const text = undoDescription((current.description as string | null) ?? null, (change.after as string | null) ?? null, (change.before as string | null) ?? null, summary.descriptionParts ?? []);
        if (text !== current.description) patch.description = text;
        continue;
      }
      if (field === 'columnId' && m.mainProjectBefore !== main.projectId) continue;
      const u = undoValue(change, current[field]);
      if (u.restore) patch[field] = columnValue(field, u.value);
    }
    if (Object.keys(patch).length) await tx.task.update({ where: { id: main.id }, data: { ...patch, version: { increment: 1 } } as Prisma.TaskUncheckedUpdateInput });

    await tx.taskMerge.update({ where: { id: mergeId }, data: { undoneAt: at, undoneById: actor.id } });
    const keys = tasks.map((t) => t.key);
    let tick = 0;
    const stamp = () => new Date(at.getTime() + tick++);
    await tx.activity.create({ data: { taskId: main.id, projectId: main.projectId, userId: actor.id, action: 'MERGE_UNDONE', meta: { mergeId, keys, mainKey: main.key }, createdAt: stamp() } });
    for (const t of tasks) await tx.activity.create({ data: { taskId: t.id, projectId: t.projectId, userId: actor.id, action: 'MERGE_UNDONE', meta: { mergeId, keys: [t.key], mainKey: main.key, fromMain: true }, createdAt: stamp() } });
    return {
      mergeId,
      mainTaskId: main.id,
      mainKey: main.key,
      mainProjectId: main.projectId,
      restored: tasks.map((t) => ({ id: t.id, key: t.key, projectId: t.projectId })),
      text: `Undid the merge: ${listWords(keys)} ${keys.length === 1 ? 'is a separate task' : 'are separate tasks'} again`,
    };
  }

  /** A merge's main task (whoever may open it may read the merge), or null when there is no such merge. */
  async function mergeMain(mergeId: string): Promise<{ mainTaskId: string } | null> {
    const m = await prisma.taskMerge.findUnique({ where: { id: mergeId }, select: { mainTaskId: true } });
    return m ? { mainTaskId: m.mainTaskId } : null;
  }

  /** The tasks merged into this one (active merges), for its payload ("Merged from"). */
  async function mergedInto(mainTaskId: string): Promise<{ id: string; key: string; mergeId: string }[]> {
    const rows = await prisma.task.findMany({ where: { mergedIntoId: mainTaskId, mergeId: { not: null } }, select: { id: true, key: true, mergeId: true }, orderBy: { mergedAt: 'asc' } });
    return rows.map((r) => ({ id: r.id, key: r.key, mergeId: r.mergeId! }));
  }

  return { preview, merge, mergedFrom, mergedRecord, resolveMerged, undoPreview, undo, mergeMain, mergedInto };
}

export type TaskMergeService = ReturnType<typeof createTaskMergeService>;

const capital = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const emptyCounts = (): MergeCounts => ({ comments: 0, checklist: 0, files: 0, assignees: 0, watchers: 0, contacts: 0, tags: 0, blockers: 0, actionItems: 0, inspections: 0, activity: 0 });
const hiddenTask = (id: string): MergePreviewTask => ({
  id, key: '', title: '', projectId: '', projectName: '', status: { name: '', category: '' }, createdAt: new Date(0), createdByName: '', version: 0, canMerge: false, reason: 'Task not found.', counts: emptyCounts(),
});

/** "2 checklist items, 1 file and 1 contact appear in more than one task — kept once." */
export function duplicatesText(d: MergeDuplicates): string | null {
  const words = [
    d.checklist ? countWords(d.checklist, 'checklist item') : null,
    d.files ? countWords(d.files, 'file') : null,
    d.contacts ? countWords(d.contacts, 'contact') : null,
    d.assignees ? countWords(d.assignees, 'person', 'people') : null,
    d.watchers ? countWords(d.watchers, 'watcher') : null,
    d.tags ? countWords(d.tags, 'tag') : null,
    d.blockers ? countWords(d.blockers, 'blocker link') : null,
  ].filter((w): w is string => w !== null);
  if (words.length === 0) return null;
  const total = d.checklist + d.files + d.contacts + d.assignees + d.watchers + d.tags + d.blockers;
  return `${listWords(words)} ${total === 1 ? 'appears' : 'appear'} in more than one task — kept once.`;
}
