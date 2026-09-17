import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { meetingsApi, MEETING_STATUS_LABELS, type Meeting, type MeetingStatus } from '../api/meetings';
import { projectsApi } from '../api/projects';
import { apiClient } from '../api/client';
import { MeetingFormModal } from '../components/MeetingFormModal';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { meetingStatusTone, formatMeetingRange } from '../lib/meetingFormat';

type ScopeFilter = 'all' | 'mine';
const STATUS_FILTERS: (MeetingStatus | 'ALL')[] = ['ALL', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'DRAFT', 'CANCELLED'];

export function MeetingsPage() {
  const navigate = useNavigate();
  const [showNew, setShowNew] = useState(false);
  const [scope, setScope] = useState<ScopeFilter>('all');
  const [statusFilter, setStatusFilter] = useState<MeetingStatus | 'ALL'>('ALL');

  const meetingsQ = useQuery({
    queryKey: ['meetings', scope],
    queryFn: () => meetingsApi(apiClient).list({ mine: scope === 'mine' }),
  });
  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi(apiClient).list() });

  const projectName = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of Array.isArray(projectsQ.data) ? projectsQ.data : []) map.set(p.id, p.name);
    return map;
  }, [projectsQ.data]);

  const meetings = useMemo(() => {
    const all = Array.isArray(meetingsQ.data) ? meetingsQ.data : [];
    return statusFilter === 'ALL' ? all : all.filter((m) => m.status === statusFilter);
  }, [meetingsQ.data, statusFilter]);

  return (
    <div>
      <PageHeader
        eyebrow="Workspace"
        title="Meetings"
        subtitle="Schedule meetings, capture notes, and track action items — for a project or on their own."
        actions={<Button onClick={() => setShowNew(true)}>+ New meeting</Button>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
          {(['all', 'mine'] as ScopeFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setScope(s)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${scope === s ? 'bg-brand-gradient text-white shadow-sm' : 'text-ink-2 hover:text-ink'}`}
            >
              {s === 'all' ? 'All meetings' : 'Organized by me'}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${statusFilter === s ? 'bg-brand-gradient text-white shadow-sm' : 'border border-line text-ink-2 hover:bg-ground'}`}
            >
              {s === 'ALL' ? 'All' : MEETING_STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      {meetingsQ.isLoading ? (
        <div className="grid gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card h-24 p-5">
              <div className="skeleton h-4 w-24" />
              <div className="skeleton mt-3 h-5 w-64" />
              <div className="skeleton mt-2 h-3 w-40" />
            </div>
          ))}
        </div>
      ) : meetingsQ.isError ? (
        <p role="alert" className="text-danger">Couldn’t load meetings. Is the API running?</p>
      ) : meetings.length === 0 ? (
        <EmptyState
          title="No meetings yet"
          description={statusFilter === 'ALL' ? 'Schedule your first meeting to start capturing notes and action items.' : 'No meetings match this filter.'}
          action={statusFilter === 'ALL' ? <Button onClick={() => setShowNew(true)}>+ New meeting</Button> : undefined}
        />
      ) : (
        <ul className="grid gap-3">
          {meetings.map((m) => (
            <li key={m.id}>
              <MeetingRow meeting={m} projectName={m.projectId ? projectName.get(m.projectId) ?? null : null} onOpen={() => navigate(`/meetings/${m.id}`)} />
            </li>
          ))}
        </ul>
      )}

      {showNew ? <MeetingFormModal onClose={() => setShowNew(false)} onSaved={(id) => navigate(`/meetings/${id}`)} /> : null}
    </div>
  );
}

function MeetingRow({ meeting, projectName, onOpen }: { meeting: Meeting; projectName: string | null; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="card w-full p-5 text-left transition-all hover:-translate-y-0.5 hover:shadow-lift"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Badge tone={meetingStatusTone(meeting.status)}>{MEETING_STATUS_LABELS[meeting.status]}</Badge>
            <Badge tone={projectName ? 'brand' : 'neutral'}>{projectName ?? 'Standalone'}</Badge>
          </div>
          <h3 className="mt-2 truncate font-display text-lg font-semibold text-ink">{meeting.title}</h3>
          <p className="mt-1 text-sm text-ink-2">{formatMeetingRange(meeting.startAt, meeting.endAt)}</p>
        </div>
        <div className="shrink-0 text-right text-xs text-ink-3">
          {meeting.location ? <div className="truncate">📍 {meeting.location}</div> : null}
          {meeting.onlineLink ? <div className="truncate">🔗 Online</div> : null}
        </div>
      </div>
    </button>
  );
}
