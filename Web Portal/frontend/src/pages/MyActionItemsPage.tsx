import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { meetingsApi, ACTION_STATUS_LABELS, type ActionItem, type ActionItemStatus } from '../api/meetings';
import { apiClient } from '../api/client';
import { PageHeader } from '../components/ui/PageHeader';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { fieldClass } from '../components/ui/Field';
import { actionStatusTone, formatDueDate } from '../lib/meetingFormat';

const ACTION_STATUSES: ActionItemStatus[] = ['OPEN', 'IN_PROGRESS', 'PENDING', 'COMPLETED', 'CANCELLED'];
type Scope = 'open' | 'all';

export function MyActionItemsPage() {
  const qc = useQueryClient();
  const [scope, setScope] = useState<Scope>('open');

  const itemsQ = useQuery({
    queryKey: ['my-action-items', scope],
    queryFn: () => meetingsApi(apiClient).listMyActionItems({ openOnly: scope === 'open' }),
  });
  const meetingsQ = useQuery({ queryKey: ['meetings', 'all'], queryFn: () => meetingsApi(apiClient).list() });

  const meetingTitle = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of Array.isArray(meetingsQ.data) ? meetingsQ.data : []) map.set(m.id, m.title);
    return map;
  }, [meetingsQ.data]);

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: ActionItemStatus }) => meetingsApi(apiClient).updateActionItem(id, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-action-items'] }),
  });

  const items = Array.isArray(itemsQ.data) ? itemsQ.data : [];
  const overdue = items.filter((i) => i.overdue).length;

  return (
    <div>
      <PageHeader
        eyebrow="Workspace"
        title="My Action Items"
        subtitle="Everything assigned to you across meetings — with due dates and status in one place."
        actions={
          <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
            {(['open', 'all'] as Scope[]).map((s) => (
              <button key={s} onClick={() => setScope(s)} className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${scope === s ? 'bg-brand-gradient text-white shadow-sm' : 'text-ink-2 hover:text-ink'}`}>
                {s === 'open' ? 'Open' : 'All'}
              </button>
            ))}
          </div>
        }
      />

      {overdue > 0 ? (
        <div className="mb-4 rounded-lg bg-danger-soft px-3 py-2 text-sm font-medium text-danger">
          {overdue} action item{overdue === 1 ? '' : 's'} overdue.
        </div>
      ) : null}

      {itemsQ.isLoading ? (
        <div className="grid gap-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="card h-16 p-4"><div className="skeleton h-4 w-64" /></div>)}</div>
      ) : items.length === 0 ? (
        <EmptyState title="Nothing on your plate" description={scope === 'open' ? 'You have no open action items. Nice.' : 'No action items are assigned to you.'} />
      ) : (
        <ul className="grid gap-2">
          {items.map((item) => (
            <li key={item.id}>
              <ActionRow item={item} meetingName={item.meetingId ? meetingTitle.get(item.meetingId) ?? null : null} onStatus={(status) => statusMut.mutate({ id: item.id, status })} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ActionRow({ item, meetingName, onStatus }: { item: ActionItem; meetingName: string | null; onStatus: (s: ActionItemStatus) => void }) {
  const done = item.status === 'COMPLETED' || item.status === 'CANCELLED';
  return (
    <div className="card flex items-center gap-3 p-4">
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-medium ${done ? 'text-ink-3 line-through' : 'text-ink'}`}>{item.description}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
          <Badge tone={actionStatusTone(item.status)}>{ACTION_STATUS_LABELS[item.status]}</Badge>
          {item.dueDate ? <span className={item.overdue ? 'font-medium text-danger' : 'text-ink-3'}>due {formatDueDate(item.dueDate)}{item.overdue ? ' · overdue' : ''}</span> : null}
          {item.meetingId ? (
            <Link to={`/meetings/${item.meetingId}`} className="text-ink-3 hover:text-brand">↗ {meetingName ?? 'meeting'}</Link>
          ) : null}
        </div>
      </div>
      <select
        aria-label={`Status for ${item.description}`}
        value={item.status}
        onChange={(e) => onStatus(e.target.value as ActionItemStatus)}
        className={`${fieldClass(false)} !py-1.5 text-sm`}
      >
        {ACTION_STATUSES.map((s) => <option key={s} value={s}>{ACTION_STATUS_LABELS[s]}</option>)}
      </select>
    </div>
  );
}
