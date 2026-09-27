export interface AuditRecord {
  id: string;
  userId: string | null;
  action: string;
  module: string;
  entityId: string | null;
  oldValue: unknown;
  newValue: unknown;
  ip: string | null;
  createdAt: Date;
}

export interface CreateAuditData {
  userId?: string | null;
  action: string;
  module: string;
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  ip?: string | null;
}

/** A newest-first page of audit entries. */
export interface AuditListQuery {
  /** Page size. Default 100. */
  limit?: number;
  /** Cursor: only entries created strictly before this instant. */
  before?: Date;
  module?: string;
  userId?: string;
  /** Only entries created at or after this instant. */
  from?: Date;
  /** Only entries created strictly before this instant. */
  to?: Date;
}

export interface AuditRepository {
  create(data: CreateAuditData): Promise<AuditRecord>;
  list(query?: AuditListQuery): Promise<AuditRecord[]>;
}

/** In-memory implementation with the same filtering and ordering as the Prisma one (tests / dev). */
export function createMemoryAuditRepository(now: () => Date = () => new Date()): AuditRepository & { rows: AuditRecord[] } {
  const rows: AuditRecord[] = [];
  let seq = 0;
  return {
    rows,
    async create(data) {
      const a: AuditRecord = {
        id: `au${String(seq++).padStart(6, '0')}`,
        userId: data.userId ?? null,
        action: data.action,
        module: data.module,
        entityId: data.entityId ?? null,
        oldValue: data.oldValue ?? null,
        newValue: data.newValue ?? null,
        ip: data.ip ?? null,
        createdAt: now(),
      };
      rows.push(a);
      return a;
    },
    async list(q = {}) {
      return rows
        .filter(
          (r) =>
            (!q.module || r.module === q.module) &&
            (!q.userId || r.userId === q.userId) &&
            (!q.before || r.createdAt < q.before) &&
            (!q.from || r.createdAt >= q.from) &&
            (!q.to || r.createdAt < q.to),
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1))
        .slice(0, q.limit ?? 100);
    },
  };
}
