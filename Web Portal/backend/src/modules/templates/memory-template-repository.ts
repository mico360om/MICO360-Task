import type {
  ProjectSnapshot,
  ProjectTemplateInput,
  ProjectTemplateRecord,
  TaskSnapshot,
  TaskTemplateInput,
  TaskTemplateRecord,
  TemplateRepository,
} from './template-repository';

/**
 * Templates kept in memory (tests, and running without a database). Saves behave as the database's:
 * a template is replaced whole, a role keeps its id when its key is that id, and deleting a template
 * touches nothing else. `projects` and `tasks` are the snapshots "save as template" reads.
 */
export function createMemoryTemplateRepository(seed: { projects?: ProjectSnapshot[]; tasks?: TaskSnapshot[] } = {}): TemplateRepository & {
  projects: Map<string, ProjectSnapshot>;
  tasks: Map<string, TaskSnapshot>;
} {
  const projectTemplates = new Map<string, ProjectTemplateRecord>();
  const taskTemplates = new Map<string, TaskTemplateRecord>();
  const projects = new Map((seed.projects ?? []).map((p) => [p.id, p]));
  const tasks = new Map((seed.tasks ?? []).map((t) => [t.id, t]));
  let seq = 0;
  const id = (prefix: string) => `${prefix}${++seq}`;
  const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);

  function build(templateId: string, input: ProjectTemplateInput, before: ProjectTemplateRecord | null, actorId: string): ProjectTemplateRecord {
    const kept = new Set(before?.roles.map((r) => r.id) ?? []);
    const roleIds = new Map(input.roles.map((r) => [r.key, kept.has(r.key) ? r.key : id('role')]));
    const roles = input.roles.map((r) => ({ id: roleIds.get(r.key)!, name: r.name }));
    const at = new Date();
    return {
      id: templateId,
      name: input.name,
      description: input.description,
      columns: input.columns.map((c) => ({ ...c })),
      roles,
      tasks: input.tasks.map((t) => ({
        id: id('tt'),
        title: t.title,
        description: t.description,
        priority: t.priority,
        dueOffsetDays: t.dueOffsetDays,
        roleId: t.roleKey ? roleIds.get(t.roleKey) ?? null : null,
        checklist: [...t.checklist],
      })),
      columnCount: input.columns.length,
      roleCount: roles.length,
      taskCount: input.tasks.length,
      createdById: before ? before.createdById : actorId,
      createdAt: before?.createdAt ?? at,
      updatedAt: at,
    };
  }
  const copy = (t: ProjectTemplateRecord): ProjectTemplateRecord => structuredClone(t);

  return {
    projects,
    tasks,
    async listProjectTemplates() {
      return [...projectTemplates.values()].sort(byName).map(({ columns: _c, roles: _r, tasks: _t, ...summary }) => ({ ...summary }));
    },
    async findProjectTemplate(templateId) {
      const t = projectTemplates.get(templateId);
      return t ? copy(t) : null;
    },
    async createProjectTemplate(input, actorId) {
      const t = build(id('pt'), input, null, actorId);
      projectTemplates.set(t.id, t);
      return copy(t);
    },
    async updateProjectTemplate(templateId, input, actorId) {
      const before = projectTemplates.get(templateId);
      if (!before) return null;
      const t = build(templateId, input, before, actorId);
      projectTemplates.set(t.id, t);
      return copy(t);
    },
    async deleteProjectTemplate(templateId) {
      return projectTemplates.delete(templateId);
    },
    async listTaskTemplates() {
      return [...taskTemplates.values()].sort(byName).map((t) => ({ ...t, checklist: [...t.checklist] }));
    },
    async findTaskTemplate(templateId) {
      const t = taskTemplates.get(templateId);
      return t ? { ...t, checklist: [...t.checklist] } : null;
    },
    async createTaskTemplate(input: TaskTemplateInput, actorId) {
      const at = new Date();
      const t: TaskTemplateRecord = { id: id('tk'), ...input, checklist: [...input.checklist], createdById: actorId, createdAt: at, updatedAt: at };
      taskTemplates.set(t.id, t);
      return { ...t, checklist: [...t.checklist] };
    },
    async updateTaskTemplate(templateId, input) {
      const before = taskTemplates.get(templateId);
      if (!before) return null;
      const t: TaskTemplateRecord = { ...before, ...input, checklist: [...input.checklist], updatedAt: new Date() };
      taskTemplates.set(t.id, t);
      return { ...t, checklist: [...t.checklist] };
    },
    async deleteTaskTemplate(templateId) {
      return taskTemplates.delete(templateId);
    },
    async projectSnapshot(projectId) {
      const p = projects.get(projectId);
      return p ? structuredClone(p) : null;
    },
    async taskSnapshot(taskId) {
      const t = tasks.get(taskId);
      return t ? structuredClone(t) : null;
    },
  };
}
