import { useMemo, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { PageHeader } from '../components/ui/PageHeader';
import { Badge, type BadgeTone } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { SearchableSelect } from '../components/ui/SearchableSelect';
import { apiClient } from '../api/client';
import { auditApi, type ApiAuditLog, type AuditQuery } from '../api/audit';
import { usersApi } from '../api/users';
import { zonedDayKey } from '../lib/due-date';
import { useCompanyTimeZone } from '../lib/useCompanyTimeZone';

/** Entries per page ("Load older entries" fetches the next page before the oldest one shown). */
export const AUDIT_PAGE_SIZE = 100;

/** Colour an audit action by its verb: create=green, update=blue, delete=red. */
function actionTone(action: string): BadgeTone {
  const verb = action.split('.').pop() ?? action;
  if (/create|add|grant|login|activate/i.test(verb)) return 'success';
  if (/delete|remove|revoke|deactivate|lock/i.test(verb)) return 'danger';
  if (/update|change|edit|move|assign/i.test(verb)) return 'info';
  return 'neutral';
}

/** Field names whose values are never shown, even in an admin log. */
const SENSITIVE_FIELD = /password|hash|secret|token|api[-_]?key|otp|credential/i;
const MAX_CHANGE_LINES = 4;

function short(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'string') return v.length > 40 ? `${v.slice(0, 39)}…` : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.every((x) => typeof x === 'string' || typeof x === 'number') && v.length <= 4 ? v.join(', ') || '—' : `${v.length} items`;
  return '{…}';
}
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A short, human summary of what an entry changed: "status: ACTIVE → SUSPENDED". Secrets are masked. */
export function summarizeChange(oldValue: unknown, newValue: unknown): string[] {
  const lines: string[] = [];
  const show = (key: string, v: unknown) => (SENSITIVE_FIELD.test(key) ? '••••' : short(v));
  if (isRecord(oldValue) || isRecord(newValue)) {
    const before = isRecord(oldValue) ? oldValue : {};
    const after = isRecord(newValue) ? newValue : {};
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
    for (const k of keys) {
      if (same(before[k], after[k])) continue;
      if (!isRecord(oldValue)) lines.push(`${k}: ${show(k, after[k])}`);
      else if (!isRecord(newValue)) lines.push(`${k} was ${show(k, before[k])}`);
      else lines.push(`${k}: ${show(k, before[k])} → ${show(k, after[k])}`);
    }
  } else if (!same(oldValue, newValue) && (oldValue !== undefined || newValue !== undefined)) {
    if (oldValue === undefined || oldValue === null) lines.push(short(newValue));
    else lines.push(`${short(oldValue)} → ${short(newValue)}`);
  }
  if (lines.length > MAX_CHANGE_LINES) {
    const extra = lines.length - (MAX_CHANGE_LINES - 1);
    return [...lines.slice(0, MAX_CHANGE_LINES - 1), `+${extra} more`];
  }
  return lines;
}

interface Filters {
  module: string;
  userId: string;
  from: string;
  to: string;
}
const NO_FILTERS: Filters = { module: '', userId: '', from: '', to: '' };

export function AuditPage() {
  const timeZone = useCompanyTimeZone();
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const filtersActive = Object.values(filters).some(Boolean);

  const q = useInfiniteQuery({
    queryKey: ['audit', filters],
    queryFn: ({ pageParam }) => {
      const query: AuditQuery = { limit: AUDIT_PAGE_SIZE, before: pageParam, ...filters };
      return auditApi(apiClient).list(query);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: ApiAuditLog[], allPages: ApiAuditLog[][]) => {
      if (!Array.isArray(lastPage) || lastPage.length < AUDIT_PAGE_SIZE) return undefined;
      // Stop if the server returned nothing new (e.g. it doesn't support paging yet).
      const seen = new Set(allPages.slice(0, -1).flat().map((r) => r.id));
      if (lastPage.every((r) => seen.has(r.id))) return undefined;
      return lastPage.reduce((oldest, r) => (r.createdAt < oldest ? r.createdAt : oldest), lastPage[0]!.createdAt);
    },
  });
  const dirQ = useQuery({ queryKey: ['directory'], queryFn: () => usersApi(apiClient).directory() });
  const directory = Array.isArray(dirQ.data) ? dirQ.data : [];
  const nameOf = (userId: string | null): string => {
    if (!userId) return 'System';
    const u = directory.find((d) => d.id === userId);
    return u ? `${u.firstName} ${u.lastName}`.trim() || u.username : userId;
  };

  const allRows = useMemo(() => {
    const seen = new Set<string>();
    const out: ApiAuditLog[] = [];
    for (const page of q.data?.pages ?? []) {
      for (const r of Array.isArray(page) ? page : []) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        out.push(r);
      }
    }
    return out;
  }, [q.data]);

  // Also filter what's loaded, so the filters work even before the server applies them.
  const rows = allRows.filter((r) => {
    if (filters.module && r.module !== filters.module) return false;
    if (filters.userId && r.userId !== filters.userId) return false;
    if (filters.from || filters.to) {
      const d = new Date(r.createdAt);
      if (Number.isNaN(d.getTime())) return false;
      const day = zonedDayKey(d, timeZone);
      if (filters.from && day < filters.from) return false;
      if (filters.to && day > filters.to) return false;
    }
    return true;
  });

  const moduleOptions = useMemo(() => {
    const mods = new Set(allRows.map((r) => r.module).filter(Boolean));
    if (filters.module) mods.add(filters.module);
    return [{ value: '', label: 'All modules' }, ...[...mods].sort().map((m) => ({ value: m, label: m }))];
  }, [allRows, filters.module]);
  const userOptions = [
    { value: '', label: 'Anyone' },
    ...directory.map((u) => ({ value: u.id, label: `${u.firstName} ${u.lastName}`.trim() || u.username, hint: `@${u.username}` })),
  ];
  const when = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    try {
      return d.toLocaleString(undefined, { timeZone, dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return d.toLocaleString();
    }
  };
  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));

  return (
    <div>
      <PageHeader eyebrow="Admin" title="Audit Logs" subtitle="Security-relevant events across the workspace — who did what, from where, and what changed." />

      <div className="card mb-4 flex flex-wrap items-end gap-2 p-2.5">
        <span className="self-center px-1 text-xs font-semibold uppercase tracking-wide text-ink-2">Filter</span>
        <div className="w-44 max-w-full"><SearchableSelect ariaLabel="Filter by module" value={filters.module} onChange={(v) => set({ module: v })} options={moduleOptions} /></div>
        <div className="w-48 max-w-full"><SearchableSelect ariaLabel="Filter by user" value={filters.userId} onChange={(v) => set({ userId: v })} options={userOptions} /></div>
        <label className="flex flex-col gap-0.5 text-[11px] text-ink-2">
          From
          <input type="date" aria-label="From date" value={filters.from} max={filters.to || undefined} onChange={(e) => set({ from: e.target.value })} className="rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-ink outline-none focus:border-brand" />
        </label>
        <label className="flex flex-col gap-0.5 text-[11px] text-ink-2">
          To
          <input type="date" aria-label="To date" value={filters.to} min={filters.from || undefined} onChange={(e) => set({ to: e.target.value })} className="rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-ink outline-none focus:border-brand" />
        </label>
        {filtersActive ? (
          <button onClick={() => setFilters(NO_FILTERS)} className="self-center rounded-lg px-2 py-1 text-xs font-medium text-ink-2 transition-colors hover:bg-ground hover:text-ink">Clear</button>
        ) : null}
      </div>

      <div className="card overflow-x-auto">
        {q.isLoading ? (
          <p className="p-4 text-ink-2">Loading…</p>
        ) : q.isError ? (
          <p role="alert" className="p-4 text-danger">
            Couldn’t load audit logs (admin only).{' '}
            <button type="button" onClick={() => void q.refetch()} className="font-semibold underline">Retry</button>
          </p>
        ) : rows.length === 0 ? (
          <EmptyState
            bare
            title={filtersActive ? 'No entries match these filters' : 'No audit entries yet'}
            description={filtersActive ? 'Try a wider date range or clear the filters.' : 'Security-relevant actions across the workspace will be logged here.'}
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-2">
                <th className="p-3">When</th>
                <th className="p-3">Who</th>
                <th className="p-3">Action</th>
                <th className="p-3">Module</th>
                <th className="p-3">Entity</th>
                <th className="p-3">Changes</th>
                <th className="p-3">IP address</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const changes = summarizeChange(a.oldValue, a.newValue);
                return (
                  <tr key={a.id} className="border-b border-line align-top last:border-0">
                    <td className="whitespace-nowrap p-3 text-ink-2">{a.createdAt ? when(a.createdAt) : '—'}</td>
                    <td dir="auto" className="p-3 font-medium text-ink">{nameOf(a.userId)}</td>
                    <td className="p-3"><Badge tone={actionTone(a.action)} dot>{a.action}</Badge></td>
                    <td className="p-3 text-ink-2">{a.module}</td>
                    <td className="p-3 font-mono text-xs text-ink-2">{a.entityId ?? '—'}</td>
                    <td className="p-3 text-xs text-ink-2">
                      {changes.length === 0 ? '—' : (
                        <ul className="flex flex-col gap-0.5">
                          {changes.map((c, i) => <li key={i} dir="auto" className="break-words">{c}</li>)}
                        </ul>
                      )}
                    </td>
                    <td className="whitespace-nowrap p-3 font-mono text-xs text-ink-2">{a.ip || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {!q.isLoading && !q.isError ? (
        <div className="mt-3 flex items-center justify-center gap-3 text-xs text-ink-3">
          <span>{rows.length} entr{rows.length === 1 ? 'y' : 'ies'} shown</span>
          {q.hasNextPage ? (
            <button
              type="button"
              onClick={() => void q.fetchNextPage()}
              disabled={q.isFetchingNextPage}
              className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:border-brand hover:text-brand disabled:opacity-60"
            >
              {q.isFetchingNextPage ? 'Loading…' : 'Load older entries'}
            </button>
          ) : null}
          {q.isFetchNextPageError ? <span role="alert" className="text-danger">Couldn’t load older entries.</span> : null}
        </div>
      ) : null}
    </div>
  );
}
