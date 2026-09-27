import type { AuditListQuery, AuditRecord, AuditRepository, CreateAuditData } from './audit-repository';

export interface AuditServiceDeps {
  audit: AuditRepository;
}

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

export function createAuditService({ audit }: AuditServiceDeps) {
  /** Record an entry; secrets are masked before they are stored. */
  async function record(data: CreateAuditData): Promise<AuditRecord> {
    return audit.create({ ...data, oldValue: redactSecrets(data.oldValue), newValue: redactSecrets(data.newValue) });
  }

  /** Newest-first page of entries; secrets are masked again on the way out (covers entries written before masking). */
  async function list(query: AuditListQuery = {}): Promise<AuditRecord[]> {
    const rows = await audit.list(query);
    return rows.map((r) => ({ ...r, oldValue: redactSecrets(r.oldValue), newValue: redactSecrets(r.newValue) }));
  }

  return { record, list };
}

export type AuditService = ReturnType<typeof createAuditService>;
