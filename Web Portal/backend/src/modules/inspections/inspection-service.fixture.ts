import { blankPng } from '../../lib/test-images';
import { createMemoryInspectionStore, type MemoryInspectionStore } from './inspection-store';
import { createInspectionService, type InspectionPorts, type InspectionService } from './inspection-service';

/**
 * A service over the in-memory store with a small made-up company: project P1 (owner Olivia, a
 * MANAGER member Mona, members Ivan the inspector and Sam), project P2 (owned by someone else,
 * nobody here on it), and an administrator Ada. Everything it writes elsewhere is recorded.
 */
export const PEOPLE = { admin: 'u-ada', owner: 'u-olivia', manager: 'u-mona', inspector: 'u-ivan', member: 'u-sam', outsider: 'u-out' } as const;
export const NAMES: Record<string, string> = { 'u-ada': 'Ada Admin', 'u-olivia': 'Olivia Owner', 'u-mona': 'Mona Manager', 'u-ivan': 'Ivan Inspector', 'u-sam': 'Sam Member', 'u-out': 'Otto Outsider' };

export interface FakeTask {
  id: string;
  key: string;
  title: string;
  projectId: string;
  description: string | null;
  assigneeIds: string[];
  createdById: string;
  done: boolean;
  deleted: boolean;
}

export interface Fixture {
  service: InspectionService;
  store: MemoryInspectionStore;
  tasks: Map<string, FakeTask>;
  activity: Array<{ taskId: string; userId: string; action: string; meta?: Record<string, unknown> }>;
  audit: Array<{ userId: string | null; action: string; module: string; entityId?: string | null; newValue?: unknown }>;
  projects: Map<string, { status: string; ownerId: string | null; name: string; deleted: boolean }>;
  now: { at: Date };
  /** Makes createTask wait for this before it answers (to send two requests at once). */
  gate: { wait: Promise<void> | null };
  failNextTask: { yes: boolean };
  /** Makes the n-th task made from now fail (1: the next one; 0: none). */
  failTaskNumber: { n: number };
  /** How many signatures were cleaned (drawn ones go through the picture library). */
  cleaned: { count: number };
  addTask(projectId: string, title?: string): FakeTask;
}

export const as = (id: string) => ({ id, roles: id === PEOPLE.admin ? ['ADMIN'] : ['EMPLOYEE'] });

export function makeFixture(): Fixture {
  const now = { at: new Date('2026-10-27T08:00:00Z') };
  const store = createMemoryInspectionStore({ now: () => now.at });
  const projects = new Map([
    ['P1', { status: 'ACTIVE', ownerId: PEOPLE.owner, name: 'Rig 3 overhaul', deleted: false }],
    ['P2', { status: 'ACTIVE', ownerId: 'u-elsewhere', name: 'Other project', deleted: false }],
  ]);
  const team: Record<string, Array<{ userId: string; role: 'MEMBER' | 'MANAGER' }>> = {
    P1: [
      { userId: PEOPLE.owner, role: 'MEMBER' },
      { userId: PEOPLE.manager, role: 'MANAGER' },
      { userId: PEOPLE.inspector, role: 'MEMBER' },
      { userId: PEOPLE.member, role: 'MEMBER' },
    ],
    P2: [],
  };
  const tasks = new Map<string, FakeTask>();
  const activity: Fixture['activity'] = [];
  const audit: Fixture['audit'] = [];
  const gate: Fixture['gate'] = { wait: null };
  const failNextTask = { yes: false };
  const failTaskNumber = { n: 0 };
  const cleaned = { count: 0 };
  let n = 0;
  const addTask = (projectId: string, title = 'Inspect rig 3'): FakeTask => {
    const t: FakeTask = { id: `t${++n}`, key: `RIG-${n}`, title, projectId, description: null, assigneeIds: [], createdById: PEOPLE.owner, done: false, deleted: false };
    tasks.set(t.id, t);
    return t;
  };
  const isAdmin = (roles: string[]) => roles.includes('ADMIN');
  const runs = (userId: string, projectId: string) => projects.get(projectId)?.ownerId === userId || (team[projectId] ?? []).some((m) => m.userId === userId && m.role === 'MANAGER');
  const onTeam = (userId: string, projectId: string) => runs(userId, projectId) || (team[projectId] ?? []).some((m) => m.userId === userId);

  const ports: InspectionPorts = {
    canViewProject: async (userId, roles, projectId) => projects.has(projectId) && !projects.get(projectId)!.deleted && (isAdmin(roles) || onTeam(userId, projectId)),
    canManageProject: async (userId, roles, projectId) => isAdmin(roles) || runs(userId, projectId),
    runsAnyProject: async (userId) => [...projects.keys()].some((p) => runs(userId, p)),
    project: async (projectId) => {
      const p = projects.get(projectId);
      return p && !p.deleted ? { name: p.name, code: 'RIG', number: 'C-77', clientName: 'Oman Drilling Co.', color: '#8B1E1E', icon: null, imageUrl: null, status: p.status, ownerId: p.ownerId } : null;
    },
    task: async (taskId) => {
      const t = tasks.get(taskId);
      return t && !t.deleted ? { id: t.id, key: t.key, title: t.title, projectId: t.projectId, done: t.done } : null;
    },
    taskSummaries: async (ids) =>
      new Map(ids.flatMap((id) => (tasks.has(id) ? [[id, { key: tasks.get(id)!.key, title: tasks.get(id)!.title, projectId: tasks.get(id)!.projectId, deleted: tasks.get(id)!.deleted, done: tasks.get(id)!.done }] as const] : []))),
    canViewTask: async (userId, roles, taskId) => {
      const t = tasks.get(taskId);
      return !!t && !t.deleted && (isAdmin(roles) || onTeam(userId, t.projectId));
    },
    doneColumnOf: async (projectId) => (projects.has(projectId) ? `${projectId}-done` : null),
    defaultAssignees: async (projectId) => {
      const owner = projects.get(projectId)?.ownerId;
      return owner && onTeam(owner, projectId) ? [owner] : [];
    },
    assertAssignable: async (projectId, ids) => {
      for (const id of ids) if (!onTeam(id, projectId)) throw Object.assign(new Error('Only active members of the project can be assigned.'), { status: 400 });
      return ids;
    },
    createTask: async (input) => {
      if (gate.wait) await gate.wait;
      if (failNextTask.yes) {
        failNextTask.yes = false;
        throw new Error('database down');
      }
      if (failTaskNumber.n > 0 && --failTaskNumber.n === 0) throw new Error('database down');
      const t = addTask(input.projectId, input.title);
      t.description = input.description;
      t.assigneeIds = input.assigneeIds;
      t.createdById = input.createdById;
      return { id: t.id, key: t.key, title: t.title, projectId: t.projectId };
    },
    userNames: async (ids) => new Map(ids.filter((id) => NAMES[id]).map((id) => [id, NAMES[id]!])),
    peopleNames: async () => ['Olivia Owner', 'Olivia', 'Mona Manager', 'Mona', 'Ivan Inspector', 'Ivan', 'Sam Member', 'Sam'],
    recordActivity: async (e) => void activity.push({ taskId: e.taskId, userId: e.userId, action: e.action, meta: e.meta }),
    audit: { record: async (e) => void audit.push({ userId: e.userId ?? null, action: e.action, module: e.module, entityId: e.entityId, newValue: e.newValue }) },
    cleanSignature: async (png) => {
      cleaned.count += 1;
      return png;
    },
  };
  const service = createInspectionService({ store, ports, now: () => now.at, newId: (() => { let k = 0; return () => `id${++k}`; })() });
  return { service, store, tasks, activity, audit, projects, now, gate, failNextTask, failTaskNumber, cleaned, addTask };
}

/** A form body: a reading with limits and two checks over two sections. */
export const FORM_BODY = {
  title: 'Rig daily check',
  description: 'Before the first shift.',
  clientSignature: 'OPTIONAL',
  supervisorSignature: 'NONE',
  sections: [
    { title: 'Well head', items: [{ kind: 'READING', label: 'Pressure', unit: 'psi', min: 0, max: 150 }, { kind: 'CHECK', label: 'Valves closed' }] },
    { title: 'Deck', items: [{ kind: 'CHECK', label: 'Guard rails fitted' }] },
  ],
};

/** A small real PNG as a data URL (a drawn signature). */
export const pngDataUrl = async (width = 40, height = 20) => `data:image/png;base64,${(await blankPng(width, height)).toString('base64')}`;
