import type { ExternalContactRecord, ExternalContactRepository } from './external-contact-repository';
import { hasWordStarting } from './prisma-external-contact-repository';

/**
 * An in-memory ExternalContactRepository for unit tests, with the database's rules: contacts are
 * added at the end of their task's list, never past the limit; a deleted task's contacts can't be
 * opened; a project's search covers its live tasks only, the most recently saved first.
 */
export function createMemoryExternalContactRepository(opts: {
  /** taskId → its project, for the tasks that are live (not deleted). */
  liveTasks: Map<string, string>;
  now?: () => Date;
}): ExternalContactRepository & { rows: ExternalContactRecord[] } {
  const rows: ExternalContactRecord[] = [];
  let seq = 0;
  let tick = 0;
  // Each save gets a later time than the one before, so "newest first" is never a tie.
  const stamp = () => new Date((opts.now?.() ?? new Date('2026-10-31T06:00:00Z')).getTime() + tick++);
  const ofTask = (taskId: string) => rows.filter((r) => r.taskId === taskId).sort((a, b) => a.position - b.position);
  return {
    rows,
    async list(taskId) {
      return ofTask(taskId).map((r) => ({ ...r }));
    },
    async get(contactId) {
      const row = rows.find((r) => r.id === contactId);
      return row && opts.liveTasks.has(row.taskId) ? { ...row } : null;
    },
    async add(taskId, fields, createdById, max) {
      const mine = ofTask(taskId);
      if (mine.length >= max) return null;
      const at = stamp();
      const row: ExternalContactRecord = {
        id: `xc${++seq}`,
        taskId,
        ...fields,
        position: mine.reduce((top, c) => Math.max(top, c.position + 1), 0),
        createdById,
        createdAt: at,
        updatedAt: at,
      };
      rows.push(row);
      return { ...row };
    },
    async update(contactId, fields) {
      const row = rows.find((r) => r.id === contactId);
      if (!row) return null;
      Object.assign(row, fields, { updatedAt: stamp() });
      return { ...row };
    },
    async remove(contactId) {
      const i = rows.findIndex((r) => r.id === contactId);
      if (i < 0) return false;
      rows.splice(i, 1);
      return true;
    },
    async searchProject(projectId, prefix, limit) {
      const p = prefix.trim();
      if (!p) return [];
      return rows
        .filter((r) => opts.liveTasks.get(r.taskId) === projectId && (hasWordStarting(r.name, p) || hasWordStarting(r.company, p)))
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
        .slice(0, limit)
        .map((r) => ({ ...r }));
    },
  };
}
