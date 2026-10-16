import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { meetingsApi, seriesIdOf, MEETING_STATUS_LABELS, type Meeting, type MeetingStatus } from '../api/meetings';
import { projectsApi } from '../api/projects';
import { usersApi } from '../api/users';
import { apiClient } from '../api/client';
import { MeetingFormModal } from '../components/MeetingFormModal';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { fieldClass } from '../components/ui/Field';
import { ActionMenu, type ActionMenuItem } from '../components/meeting/ActionMenu';
import { Icon } from '../components/meeting/kit';
import { CancelMeetingDialog, DeleteMeetingDialog, exportMinutes, meetingFailure, useDuplicateMeeting } from '../components/meeting/meeting-actions';
import { meetingStatusTone, formatMeetingDay, formatMeetingTimes } from '../lib/meetingFormat';
import { filterMeetings, groupMeetings, hasActiveFilters, type DateRange, type GroupKey, type MeetingFilters, type MeetingSort } from '../lib/meeting-list';
import { useCompanyTimeZone } from '../lib/useCompanyTimeZone';
import { ProjectAvatar, type ProjectLook } from '../components/ProjectAvatar';

type Scope = 'all' | 'mine';
const STATUSES: MeetingStatus[] = ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'DRAFT', 'CANCELLED'];
const RANGES: { value: DateRange; label: string }[] = [
  { value: 'any', label: 'Any date' },
  { value: 'today', label: 'Today' },
  { value: 'next7', label: 'Next 7 days' },
  { value: 'last7', label: 'Last 7 days' },
  { value: 'month', label: 'This month' },
  { value: 'last30', label: 'Last 30 days' },
  { value: 'custom', label: 'Custom range…' },
];
const SORTS: { value: MeetingSort; label: string }[] = [
  { value: 'date', label: 'Date' },
  { value: 'title', label: 'Title (A–Z)' },
  { value: 'updated', label: 'Recently updated' },
];
/** How many of each group show before "Show more" (Today always shows in full). */
const PAGE: Record<GroupKey, number> = { today: Infinity, upcoming: 10, drafts: 10, past: 10 };

/** Filters live in the address, so a refresh, a shared link or Back keeps them. */
function useListState() {
  const [params, setParams] = useSearchParams();
  const filters: MeetingFilters = {
    q: params.get('q') ?? '',
    projectId: params.get('project') ?? '',
    status: (params.get('status') as MeetingStatus | null) ?? 'ALL',
    range: (params.get('date') as DateRange | null) ?? 'any',
    from: params.get('from') ?? undefined,
    to: params.get('to') ?? undefined,
  };
  const scope: Scope = params.get('scope') === 'mine' ? 'mine' : 'all';
  const sort = (params.get('sort') as MeetingSort | null) ?? 'date';
  const set = (changes: Record<string, string | undefined>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(changes)) {
          if (v === undefined || v === '' || v === 'ALL' || (k === 'date' && v === 'any') || (k === 'sort' && v === 'date') || (k === 'scope' && v === 'all')) next.delete(k);
          else next.set(k, v);
        }
        return next;
      },
      { replace: true },
    );
  return { filters, scope, sort, set };
}

export function MeetingsPage() {
  const navigate = useNavigate();
  const timeZone = useCompanyTimeZone();
  const { filters, scope, sort, set } = useListState();
  const [showNew, setShowNew] = useState(false);
  const [shown, setShown] = useState<Partial<Record<GroupKey, number>>>({});
  const [editing, setEditing] = useState<Meeting | null>(null);
  const [cancelling, setCancelling] = useState<Meeting | null>(null);
  const [deleting, setDeleting] = useState<Meeting | null>(null);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);

  const meetingsQ = useQuery({
    queryKey: ['meetings', scope],
    queryFn: () => meetingsApi(apiClient).list({ mine: scope === 'mine' }),
  });
  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi(apiClient).list() });
  const dirQ = useQuery({ queryKey: ['directory'], queryFn: () => usersApi(apiClient).directory() });
  const duplicate = useDuplicateMeeting(
    (copy) => navigate(`/meetings/${copy.id}`),
    (text) => setNotice({ text, error: true }),
  );

  const projects = useMemo(() => (Array.isArray(projectsQ.data) ? projectsQ.data : []).slice().sort((a, b) => a.name.localeCompare(b.name)), [projectsQ.data]);
  const projectOf = useMemo(() => {
    const map = new Map(projects.map((p) => [p.id, p]));
    return (id: string) => map.get(id) ?? null;
  }, [projects]);
  const projectName = useMemo(() => (id: string) => projectOf(id)?.name ?? null, [projectOf]);
  const organizerName = useMemo(() => {
    const map = new Map((Array.isArray(dirQ.data) ? dirQ.data : []).map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim() || u.username]));
    return (id: string) => map.get(id) ?? null;
  }, [dirQ.data]);

  const all = useMemo(() => (Array.isArray(meetingsQ.data) ? meetingsQ.data : []), [meetingsQ.data]);
  const now = new Date();
  const ctx = { timeZone, now, projectName, organizerName };
  const visible = filterMeetings(all, filters, ctx);
  const groups = groupMeetings(visible, ctx, sort);
  const draftCount = all.filter((m) => m.status === 'DRAFT').length;
  const filtered = hasActiveFilters(filters);
  const update = (changes: Record<string, string | undefined>) => {
    setShown({});
    set(changes);
  };
  const clearFilters = () => update({ q: undefined, project: undefined, status: undefined, date: undefined, from: undefined, to: undefined });

  function rowActions(m: Meeting): ActionMenuItem[] {
    const canEdit = m.canEdit !== false;
    const ended = m.status === 'CANCELLED' || m.status === 'COMPLETED';
    const items: ActionMenuItem[] = [{ label: 'Open', onSelect: () => navigate(`/meetings/${m.id}`) }];
    if (canEdit && m.status !== 'CANCELLED') items.push({ label: 'Edit details', onSelect: () => setEditing(m) });
    items.push({ label: 'Duplicate', onSelect: () => duplicate.mutate(m.id) });
    items.push({
      label: 'Export minutes (PDF)',
      onSelect: () => void exportMinutes(m).catch((err) => setNotice({ text: meetingFailure(err, 'Couldn’t export the minutes.'), error: true })),
    });
    if (canEdit && !ended) items.push({ label: 'Cancel meeting…', danger: true, onSelect: () => setCancelling(m) });
    if (canEdit) items.push({ label: 'Delete meeting…', danger: true, onSelect: () => setDeleting(m) });
    return items;
  }

  return (
    <div>
      <PageHeader
        eyebrow="Workspace"
        title="Meetings"
        subtitle="Plan meetings, capture decisions and follow up on action items."
        actions={<Button onClick={() => setShowNew(true)}>+ New meeting</Button>}
      />

      {/* Whose meetings: a choice of its own, apart from the filters below. */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Whose meetings" className="inline-flex rounded-lg border border-line bg-surface p-0.5">
          {(['all', 'mine'] as Scope[]).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={scope === s}
              onClick={() => update({ scope: s })}
              className={`min-h-9 rounded-md px-3 text-sm font-medium transition-colors ${scope === s ? 'bg-brand-gradient text-white shadow-sm' : 'text-ink-2 hover:text-ink'}`}
            >
              {s === 'all' ? 'All meetings' : 'Organized by me'}
            </button>
          ))}
        </div>
        {draftCount > 0 ? (
          <button
            type="button"
            aria-pressed={filters.status === 'DRAFT'}
            onClick={() => update({ status: filters.status === 'DRAFT' ? undefined : 'DRAFT' })}
            className={`min-h-9 rounded-lg border px-3 text-sm font-medium transition-colors ${filters.status === 'DRAFT' ? 'border-brand/40 bg-brand/10 text-brand' : 'border-line text-ink-2 hover:border-brand/30 hover:text-ink'}`}
          >
            Drafts ({draftCount})
          </button>
        ) : null}
      </div>

      <section aria-label="Find meetings" className="mb-4 grid gap-2 rounded-xl border border-line bg-surface p-3 sm:grid-cols-2 xl:grid-cols-[minmax(12rem,1fr)_repeat(4,minmax(8.5rem,auto))]">
        <div className="flex flex-col gap-1 sm:col-span-2 xl:col-span-1">
          <label htmlFor="ml-search" className="text-xs font-medium text-ink-2">Search</label>
          <input
            id="ml-search"
            type="search"
            aria-label="Search meetings"
            dir="auto"
            value={filters.q}
            onChange={(e) => update({ q: e.target.value })}
            placeholder="Title, place, project or organizer"
            className={fieldClass(false)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="ml-project" className="text-xs font-medium text-ink-2">Project</label>
          <select id="ml-project" value={filters.projectId} onChange={(e) => update({ project: e.target.value })} className={fieldClass(false)}>
            <option value="">All projects</option>
            <option value="none">Standalone only</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="ml-date" className="text-xs font-medium text-ink-2">Date</label>
          <select id="ml-date" value={filters.range} onChange={(e) => update({ date: e.target.value })} className={fieldClass(false)}>
            {RANGES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="ml-status" className="text-xs font-medium text-ink-2">Status</label>
          <select id="ml-status" value={filters.status} onChange={(e) => update({ status: e.target.value })} className={fieldClass(false)}>
            <option value="ALL">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{MEETING_STATUS_LABELS[s]}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="ml-sort" className="text-xs font-medium text-ink-2">Sort by</label>
          <select id="ml-sort" value={sort} onChange={(e) => update({ sort: e.target.value })} className={fieldClass(false)}>
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
        {filters.range === 'custom' ? (
          <div className="grid grid-cols-2 gap-2 sm:col-span-2 lg:col-span-5 lg:max-w-md">
            <div className="flex flex-col gap-1">
              <label htmlFor="ml-from" className="text-xs font-medium text-ink-2">From</label>
              <input id="ml-from" type="date" value={filters.from ?? ''} onChange={(e) => update({ from: e.target.value })} className={fieldClass(false)} />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="ml-to" className="text-xs font-medium text-ink-2">To</label>
              <input id="ml-to" type="date" value={filters.to ?? ''} min={filters.from} onChange={(e) => update({ to: e.target.value })} className={fieldClass(false)} />
            </div>
          </div>
        ) : null}
      </section>

      <div className="mb-3 flex min-h-6 flex-wrap items-center justify-between gap-2 text-sm text-ink-2">
        <p aria-live="polite">
          {meetingsQ.isSuccess ? `${visible.length} ${visible.length === 1 ? 'meeting' : 'meetings'}${filtered ? ' match' : ''}` : ''}
        </p>
        {filtered ? (
          <button type="button" onClick={clearFilters} className="min-h-9 rounded-md px-2 font-medium text-brand hover:underline">
            Clear filters
          </button>
        ) : null}
      </div>

      {notice ? (
        <div role={notice.error ? 'alert' : 'status'} className={`mb-4 flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm ${notice.error ? 'bg-danger-soft text-danger' : 'bg-success-soft text-success'}`}>
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="shrink-0 rounded px-1 opacity-80 hover:opacity-100">✕</button>
        </div>
      ) : null}

      {meetingsQ.isLoading ? (
        <div className="card divide-y divide-line" aria-busy="true" aria-label="Loading meetings">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3">
              <div className="flex-1">
                <div className="skeleton h-4 w-56 max-w-full" />
                <div className="skeleton mt-2 h-3 w-32" />
              </div>
              <div className="skeleton hidden h-4 w-24 md:block" />
              <div className="skeleton hidden h-4 w-20 md:block" />
            </div>
          ))}
        </div>
      ) : meetingsQ.isError ? (
        <div role="alert" className="card flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm text-danger">
          <span>Couldn’t load meetings. Check your connection and try again.</span>
          <Button variant="secondary" size="sm" loading={meetingsQ.isFetching} onClick={() => void meetingsQ.refetch()}>Retry</Button>
        </div>
      ) : visible.length === 0 ? (
        filtered ? (
          <EmptyState
            title="No meetings match these filters"
            description="Try another search or date, or clear the filters to see everything."
            action={<Button variant="secondary" onClick={clearFilters}>Clear filters</Button>}
          />
        ) : (
          <EmptyState
            title={scope === 'mine' ? 'You haven’t organized any meetings yet' : 'No meetings yet'}
            description="Schedule a meeting to plan its agenda, take notes together and follow up on action items."
            action={<Button onClick={() => setShowNew(true)}>+ New meeting</Button>}
          />
        )
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((g) => {
            const limit = shown[g.key] ?? PAGE[g.key];
            const items = g.items.slice(0, limit);
            const more = g.items.length - items.length;
            return (
              <section key={g.key} aria-labelledby={`group-${g.key}`}>
                <h2 id={`group-${g.key}`} className="mb-2 flex items-baseline gap-2 font-display text-sm font-semibold uppercase tracking-wide text-ink-3">
                  {g.label}
                  <span className="text-xs font-medium normal-case tracking-normal text-ink-3">{g.items.length}</span>
                </h2>
                <div className="card overflow-visible">
                  <table className="w-full table-fixed border-collapse text-sm">
                    <caption className="sr-only">{g.label} meetings</caption>
                    <thead className="hidden text-left text-xs font-medium text-ink-3 md:table-header-group">
                      <tr>
                        <th scope="col" className="px-4 py-2 font-medium">Meeting</th>
                        <th scope="col" className="w-28 px-2 py-2 font-medium">Status</th>
                        <th scope="col" className="w-36 px-2 py-2 font-medium">When</th>
                        <th scope="col" className="hidden w-40 px-2 py-2 font-medium lg:table-cell">Organizer</th>
                        <th scope="col" className="w-16 px-2 py-2 text-right font-medium">People</th>
                        <th scope="col" className="w-28 px-2 py-2 font-medium">Action items</th>
                        <th scope="col" className="w-12 px-2 py-2"><span className="sr-only">Actions</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((m) => (
                        <MeetingRow
                          key={m.id}
                          meeting={m}
                          timeZone={timeZone}
                          project={m.projectId ? projectOf(m.projectId) : null}
                          organizer={organizerName(m.organizerId)}
                          actions={rowActions(m)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
                {more > 0 ? (
                  <div className="mt-2 flex justify-center">
                    <Button variant="ghost" size="sm" onClick={() => setShown((s) => ({ ...s, [g.key]: limit + PAGE[g.key] }))}>
                      Show {Math.min(more, PAGE[g.key])} more
                    </Button>
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      )}

      {showNew ? <MeetingFormModal onClose={() => setShowNew(false)} onSaved={(id) => navigate(`/meetings/${id}`)} /> : null}
      {editing ? <MeetingFormModal meeting={editing} onClose={() => setEditing(null)} /> : null}
      {cancelling ? <CancelMeetingDialog meeting={cancelling} onClose={() => setCancelling(null)} onDone={(scope) => setNotice({ text: scope === 'series' ? 'The upcoming meetings of the series are cancelled.' : 'Meeting cancelled.' })} /> : null}
      {deleting ? <DeleteMeetingDialog meeting={deleting} onClose={() => setDeleting(null)} onDone={(scope) => setNotice({ text: scope === 'series' ? 'The upcoming meetings of the series are deleted.' : 'Meeting deleted.' })} /> : null}
    </div>
  );
}

function MeetingRow({
  meeting: m,
  timeZone,
  project: p,
  organizer,
  actions,
}: {
  meeting: Meeting;
  timeZone: string;
  project: ProjectLook | null;
  organizer: string | null;
  actions: ActionMenuItem[];
}) {
  const cancelled = m.status === 'CANCELLED';
  const day = formatMeetingDay(m.startAt, timeZone);
  const times = formatMeetingTimes(m.startAt, m.endAt, timeZone);
  const people = m.attendeeCount;
  const open = m.openActionItemCount;
  const status = <Badge tone={meetingStatusTone(m.status)} className="shrink-0">{MEETING_STATUS_LABELS[m.status]}</Badge>;
  const project = (
    <span className={`inline-flex min-w-0 max-w-full items-center ${p ? 'gap-1.5 text-ink-2' : 'gap-1 text-ink-3'}`}>
      {p ? <ProjectAvatar project={p} size="xs" /> : <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-line" />}
      <span className="truncate">{p ? <bdi>{p.name}</bdi> : 'Standalone'}</span>
    </span>
  );
  return (
    <tr className={`border-t border-line align-top transition-colors hover:bg-ground/60 ${cancelled ? 'text-ink-3' : ''}`}>
      <td className="max-w-0 px-4 py-3">
        {/* The title is inline (bdi), so an Arabic title stays beside its details instead of jumping to the far side. */}
        <Link
          to={`/meetings/${m.id}`}
          title={m.title}
          className={`block truncate py-0.5 font-medium hover:text-brand focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${cancelled ? 'text-ink-3 line-through' : 'text-ink'}`}
        >
          <bdi>{m.title}</bdi>
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {project}
          {seriesIdOf(m) ? (
            <span className="inline-flex items-center gap-1 text-ink-3" title="Part of a repeating series">
              {Icon.repeat}
              <span>Repeats</span>
            </span>
          ) : null}
          {m.location ? (
            <span className="inline-flex min-w-0 max-w-full items-center gap-1 text-ink-3">
              <span aria-hidden="true">📍</span>
              <span className="truncate"><bdi>{m.location}</bdi></span>
            </span>
          ) : m.onlineLink ? (
            <span className="text-ink-3">Online</span>
          ) : null}
        </div>
        {/* On a phone the other columns are hidden: their facts go here instead. */}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-2 md:hidden">
          {status}
          <span className="whitespace-nowrap">{day} · {times}</span>
        </div>
        <p className="mt-1 text-xs text-ink-3 md:hidden">
          {organizer ? <bdi>{organizer}</bdi> : null}
          {people !== undefined ? <>{organizer ? ' · ' : ''}{people} {people === 1 ? 'person' : 'people'}</> : null}
          {open ? <span className="font-medium text-warning"> · {open} open action {open === 1 ? 'item' : 'items'}</span> : null}
        </p>
      </td>
      <td className="hidden px-2 py-3 md:table-cell">{status}</td>
      <td className="hidden whitespace-nowrap px-2 py-3 md:table-cell">
        <div className="text-ink">{day}</div>
        <div className="text-xs text-ink-3">{times}</div>
      </td>
      <td className="hidden truncate px-2 py-3 text-ink-2 lg:table-cell">{organizer ? <bdi>{organizer}</bdi> : '—'}</td>
      <td className="hidden px-2 py-3 text-right tabular-nums text-ink-2 md:table-cell">{people ?? '—'}</td>
      <td className="hidden px-2 py-3 md:table-cell">
        {open ? <Badge tone="warning">{open} open</Badge> : <span className="text-ink-3">{open === 0 ? 'None open' : '—'}</span>}
      </td>
      <td className="w-12 px-1.5 py-2">
        <ActionMenu label={`More actions for ${m.title}`} items={actions} className="flex justify-end" />
      </td>
    </tr>
  );
}
