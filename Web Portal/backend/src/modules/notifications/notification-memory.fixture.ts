import type { NotificationListOptions, NotificationProject, NotificationRecord, NotificationRepository, NotificationScope, NotificationTaskKey } from './notification-repository';

/**
 * An in-memory notification repository for tests, with the database's rules: newest first (by time,
 * then id), the companies scope (rows about no project, or about a project in scope), pages before a
 * row, the Unread tab and types. `seed` adds a row as it is, with its own times.
 */
export function createMemoryNotificationRepository({ projects = [], tasks = [] }: { projects?: NotificationProject[]; tasks?: NotificationTaskKey[] } = {}) {
  const rows = new Map<string, NotificationRecord>();
  let seq = 0;
  const inScope = (n: NotificationRecord, scope?: NotificationScope) => !scope || !n.projectId || scope.includes(n.projectId);
  /** Newest first: later time first, then the larger id (as the database orders them). */
  const newestFirst = (a: NotificationRecord, b: NotificationRecord) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
  const olderThan = (n: NotificationRecord, before: { createdAt: Date; id: string }) =>
    n.createdAt.getTime() < before.createdAt.getTime() || (n.createdAt.getTime() === before.createdAt.getTime() && n.id < before.id);
  const own = (userId: string, ids: readonly string[]) => [...new Set(ids)].map((id) => rows.get(id)).filter((n): n is NotificationRecord => !!n && n.userId === userId);

  function seed(row: Partial<NotificationRecord> & Pick<NotificationRecord, 'userId' | 'type' | 'title'>): NotificationRecord {
    const n: NotificationRecord = { id: `n${seq++}`, body: null, entityType: null, entityId: null, projectId: null, readAt: null, createdAt: new Date(), ...row };
    rows.set(n.id, n);
    return n;
  }

  const repo: NotificationRepository & { seed: typeof seed } = {
    seed,
    async create(data) {
      return seed({ userId: data.userId, type: data.type, title: data.title, body: data.body ?? null, entityType: data.entityType ?? null, entityId: data.entityId ?? null, projectId: data.projectId ?? null });
    },
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async list(userId, scope, opts: NotificationListOptions = {}) {
      return [...rows.values()]
        .filter((n) => n.userId === userId && inScope(n, scope))
        .filter((n) => (opts.unreadOnly ? !n.readAt : true))
        .filter((n) => (opts.types ? opts.types.includes(n.type) : true))
        .filter((n) => (opts.before ? olderThan(n, opts.before) : true))
        .sort(newestFirst)
        .slice(0, opts.limit ?? 100);
    },
    async markRead(id) {
      const n = { ...rows.get(id)!, readAt: new Date() };
      rows.set(id, n);
      return n;
    },
    async markAllRead(userId, upTo, scope, types) {
      for (const n of rows.values()) {
        if (n.userId !== userId || n.readAt || !inScope(n, scope)) continue;
        if (upTo && n.createdAt > upTo) continue;
        if (types && !types.includes(n.type)) continue;
        n.readAt = new Date();
      }
    },
    async unreadCount(userId, scope) {
      return [...rows.values()].filter((n) => n.userId === userId && !n.readAt && inScope(n, scope)).length;
    },
    async findUnread(userId, type, entityType, entityId) {
      return [...rows.values()].reverse().find((n) => n.userId === userId && n.type === type && n.entityType === entityType && n.entityId === entityId && !n.readAt) ?? null;
    },
    async refresh(id, data) {
      const n = { ...rows.get(id)!, title: data.title, body: data.body ?? null, createdAt: new Date() };
      rows.set(id, n);
      return n;
    },
    async markEntityRead(userId, entityType, entityId) {
      let count = 0;
      for (const n of rows.values()) {
        if (n.userId === userId && n.entityType === entityType && n.entityId === entityId && !n.readAt) {
          n.readAt = new Date();
          count += 1;
        }
      }
      return count;
    },
    async unreadByType(userId, scope) {
      const out: Record<string, number> = {};
      for (const n of rows.values()) if (n.userId === userId && !n.readAt && inScope(n, scope)) out[n.type] = (out[n.type] ?? 0) + 1;
      return out;
    },
    async markUnread(id) {
      const n = { ...rows.get(id)!, readAt: null };
      rows.set(id, n);
      return n;
    },
    async remove(id) {
      rows.delete(id);
    },
    async bulk(userId, ids, action) {
      const mine = own(userId, ids);
      if (action === 'remove') {
        for (const n of mine) rows.delete(n.id);
        return mine.length;
      }
      const changing = mine.filter((n) => (action === 'read' ? !n.readAt : !!n.readAt));
      for (const n of changing) rows.set(n.id, { ...n, readAt: action === 'read' ? new Date() : null });
      return changing.length;
    },
    async projectLooks(ids) {
      return projects.filter((p) => ids.includes(p.id));
    },
    async taskKeys(ids) {
      return tasks.filter((t) => ids.includes(t.id));
    },
  };
  return repo;
}
