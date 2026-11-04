import type { AuditListQuery, AuditRecord, AuditRepository, CreateAuditData } from './audit-repository';

export interface AuditServiceDeps {
  audit: AuditRepository;
  /**
   * 1.22.3: the tasks among a page's entity ids — each one's current number and title (a task in the
   * trash too; one deleted for good is left out). The Audit page names a task's entries by them.
   */
  tasks?: (ids: readonly string[]) => Promise<Array<{ id: string; key: string; title: string }>>;
}

/** An entry as the Audit page reads it: 1.22.3 adds the task it is about (its number now, and title), or null. */
export type AuditEntry = AuditRecord & { task: { key: string; title: string } | null };

export const REDACTED = '[redacted]';

// Field names that hold credentials. `modelKey` and similar identifiers are deliberately not matched.
const SECRET_FIELD = /password|passwd|token|secret|api[-_]?key|private[-_]?key|authorization|cookie|^key$/i;

/** Deep copy of a before/after snapshot with secret-looking fields masked. */
export function redactSecrets(value: unknown, depth = 0): unknown {
  if (depth > 20 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_FIELD.test(k) && v !== null && v !== undefined && v !== '' ? REDACTED : redactSecrets(v, depth + 1);
  }
  return out;
}

export function createAuditService({ audit, tasks }: AuditServiceDeps) {
  /** Record an entry; secrets are masked before they are stored. */
  async function record(data: CreateAuditData): Promise<AuditRecord> {
    return audit.create({ ...data, oldValue: redactSecrets(data.oldValue), newValue: redactSecrets(data.newValue) });
  }

  /**
   * Newest-first page of entries; secrets are masked again on the way out (covers entries written
   * before masking). 1.22.3: an entry about a task names it (`task`: its current number and title).
   */
  async function list(query: AuditListQuery = {}): Promise<AuditEntry[]> {
    const rows = await audit.list(query);
    const ids = [...new Set(rows.map((r) => r.entityId).filter((id): id is string => !!id))];
    const found = new Map((tasks && ids.length ? await tasks(ids) : []).map((t) => [t.id, { key: t.key, title: t.title }]));
    return rows.map((r) => ({ ...r, oldValue: redactSecrets(r.oldValue), newValue: redactSecrets(r.newValue), task: (r.entityId && found.get(r.entityId)) || null }));
  }

  /** Every module the log holds, A–Z. */
  async function modules(): Promise<string[]> {
    return audit.modules();
  }

  return { record, list, modules };
}

export type AuditService = ReturnType<typeof createAuditService>;
