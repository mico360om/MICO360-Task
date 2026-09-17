import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../components/ui/PageHeader';
import { Badge, type BadgeTone } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { apiClient } from '../api/client';
import { auditApi } from '../api/audit';

/** Colour an audit action by its verb: create=green, update=blue, delete=red. */
function actionTone(action: string): BadgeTone {
  const verb = action.split('.').pop() ?? action;
  if (/create|add|grant|login|activate/.test(verb)) return 'success';
  if (/delete|remove|revoke|deactivate|lock/.test(verb)) return 'danger';
  if (/update|change|edit|move|assign/.test(verb)) return 'info';
  return 'neutral';
}

export function AuditPage() {
  const q = useQuery({ queryKey: ['audit'], queryFn: () => auditApi(apiClient).list() });
  const rows = q.data ?? [];

  return (
    <div>
      <PageHeader eyebrow="Admin" title="Audit Logs" subtitle="Security-relevant events across the workspace." />
      <div className="card overflow-x-auto">
        {q.isLoading ? (
          <p className="p-4 text-ink-2">Loading…</p>
        ) : q.isError ? (
          <p role="alert" className="p-4 text-danger">Couldn’t load audit logs (admin only).</p>
        ) : rows.length === 0 ? (
          <EmptyState
            bare
            title="No audit entries yet"
            description="Security-relevant actions across the workspace will be logged here."
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-2">
                <th className="p-3">Action</th>
                <th className="p-3">Module</th>
                <th className="p-3">Entity</th>
                <th className="p-3">When</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="border-b border-line last:border-0">
                  <td className="p-3"><Badge tone={actionTone(a.action)} dot>{a.action}</Badge></td>
                  <td className="p-3 text-ink-2">{a.module}</td>
                  <td className="p-3 font-mono text-xs text-ink-2">{a.entityId ?? '—'}</td>
                  <td className="p-3 text-ink-2">{a.createdAt ? new Date(a.createdAt).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
