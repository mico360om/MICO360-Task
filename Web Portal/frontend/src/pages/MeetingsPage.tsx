import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { meetingsApi, type Meeting, type MeetingStatus } from '../api/meetings';
import { projectsApi } from '../api/projects';
import { usersApi } from '../api/users';
import { apiClient } from '../api/client';
import { MeetingFormModal } from '../components/MeetingFormModal';
import { PageTitle } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { type ActionMenuItem } from '../components/meeting/ActionMenu';
import { MeetingCard } from '../components/meeting/MeetingCard';
import { UpNextCard } from '../components/meeting/UpNextCard';
import { FilterChips, FiltersButton } from '../components/meeting/MeetingListFilters';
import { CancelMeetingDialog, DeleteMeetingDialog, exportMinutes, meetingFailure, useDuplicateMeeting } from '../components/meeting/meeting-actions';
import { filterChips, filterMeetings, groupMeetings, hasActiveFilters, nextUpMeeting, type DateRange, type FilterChip, type GroupKey, type MeetingFilters, type MeetingSort } from '../lib/meeting-list';
import { useCompanyTimeZone } from '../lib/useCompanyTimeZone';
import { useNow } from '../lib/useNow';
import { useShortcut } from '../components/shortcuts/ShortcutProvider';

/** The cards: one column on a phone, up to four on a wide screen. */
const GRID = 'grid gap-3 sm:grid-cols-2 xl:grid-cols-3 min-[1800px]:grid-cols-4';
type Scope = 'all' | 'mine';
/** How many of each group show before "Show more" (Today always shows in full); rows of 3 or 4 cards. */
const PAGE: Record<GroupKey, number> = { today: Infinity, next7: 12, later: 12, drafts: 12, past: 12 };
/** What removing a chip clears from the address. */
const CHIP_CLEARS: Record<FilterChip['key'], Record<string, undefined>> = {
  project: { project: undefined },
  date: { date: undefined, from: undefined, to: undefined },
  status: { status: undefined },
  sort: { sort: undefined },
};

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
  const now = useNow();
  const { filters, scope, sort, set } = useListState();
  const [showNew, setShowNew] = useState(false);
  useShortcut('new', () => setShowNew(true));
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
  const ctx = { timeZone, now, projectName, organizerName };
  const visible = filterMeetings(all, filters, ctx);
  const groups = groupMeetings(visible, ctx, sort);
  const draftCount = all.filter((m) => m.status === 'DRAFT').length;
  const filtered = hasActiveFilters(filters);
  const chips = filterChips(filters, sort, ctx);
  const filterCount = chips.filter((c) => c.key !== 'sort').length;
  // The next meeting, on top — unless the list is being searched or filtered.
  const upNext = filtered ? null : nextUpMeeting(all, now);
  const update = (changes: Record<string, string | undefined>) => {
    setShown({});
    set(changes);
  };
  const clearFilters = () => update({ q: undefined, project: undefined, status: undefined, date: undefined, from: undefined, to: undefined });
  const clearAll = () => update({ q: undefined, project: undefined, status: undefined, date: undefined, from: undefined, to: undefined, sort: undefined });

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
      {/* One line: the title, the search, the filters, whose meetings and New meeting. */}
      <div className="relative z-20 mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 animate-fade-in-up">
        <PageTitle eyebrow="Workspace" title="Meetings" className="flex-none" />
        <div className="flex min-w-0 flex-[1_1_36rem] flex-wrap items-center gap-2">
          <label className="relative min-w-[11rem] flex-1 sm:max-w-xs">
            <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-ink-2">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            </span>
            <input
              id="ml-search"
              type="search"
              data-page-search
              aria-label="Search meetings"
              dir="auto"
              value={filters.q}
              onChange={(e) => update({ q: e.target.value })}
              placeholder="Search title, place, project, organizer"
              className="h-10 w-full rounded-xl border border-line bg-surface pe-3 ps-9 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </label>
          <FiltersButton filters={filters} sort={sort} count={filterCount} projects={projects} onChange={update} onClearAll={clearAll} />
          {/* Whose meetings: a choice of its own, apart from the filters. */}
          <div role="group" aria-label="Whose meetings" className="inline-flex rounded-xl border border-line bg-surface p-0.5">
            {(['all', 'mine'] as Scope[]).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={scope === s}
                onClick={() => update({ scope: s })}
                className={`min-h-[2.25rem] rounded-lg px-3 text-sm font-medium transition-colors ${scope === s ? 'bg-brand-gradient text-white shadow-sm' : 'text-ink-2 hover:text-ink'}`}
              >
                {/* Shorter words on a phone, so the row fits. */}
                <span className="max-sm:hidden">{s === 'all' ? 'All meetings' : 'Organized by me'}</span>
                <span className="sm:hidden">{s === 'all' ? 'All' : 'Mine'}</span>
              </button>
            ))}
          </div>
          {draftCount > 0 ? (
            <button
              type="button"
              aria-pressed={filters.status === 'DRAFT'}
              onClick={() => update({ status: filters.status === 'DRAFT' ? undefined : 'DRAFT' })}
              className={`h-10 rounded-xl border px-3 text-sm font-medium transition-colors ${filters.status === 'DRAFT' ? 'border-brand/40 bg-brand/10 text-brand' : 'border-line bg-surface text-ink-2 hover:border-brand/30 hover:text-ink'}`}
            >
              Drafts ({draftCount})
            </button>
          ) : null}
          <Button onClick={() => setShowNew(true)} title="New meeting" shortcut="new" className="ms-auto max-sm:px-3.5">
            <span className="max-sm:hidden">+ New meeting</span>
            {/* On a phone only "+" shows; the button is still called "+ New meeting". */}
            <span className="sm:hidden">
              <span className="text-lg leading-none">+</span>
              <span className="sr-only"> New meeting</span>
            </span>
          </Button>
        </div>
      </div>

      {filtered || chips.length ? (
        <FilterChips
          chips={chips}
          summary={meetingsQ.isSuccess ? `${visible.length} ${visible.length === 1 ? 'meeting matches' : 'meetings match'}` : ''}
          onRemove={(key) => update(CHIP_CLEARS[key])}
          onClearAll={clearAll}
        />
      ) : null}

      {notice ? (
        <div role={notice.error ? 'alert' : 'status'} className={`mb-4 flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm ${notice.error ? 'bg-danger-soft text-danger' : 'bg-success-soft text-success'}`}>
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="shrink-0 rounded px-1 opacity-80 hover:opacity-100">✕</button>
        </div>
      ) : null}

      {upNext ? <UpNextCard meeting={upNext} timeZone={timeZone} now={now} project={upNext.projectId ? projectOf(upNext.projectId) : null} /> : null}

      {meetingsQ.isLoading ? (
        <div className={GRID} aria-busy="true" aria-label="Loading meetings">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex gap-3 rounded-xl border border-line bg-surface p-3">
              <div className="skeleton h-16 w-14 flex-none rounded-xl" />
              <div className="flex-1">
                <div className="skeleton h-4 w-48 max-w-full" />
                <div className="skeleton mt-2 h-3 w-32" />
                <div className="skeleton mt-2 h-3 w-24" />
              </div>
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
                <div className={GRID}>
                  {items.map((m) => (
                    <MeetingCard
                      key={m.id}
                      meeting={m}
                      timeZone={timeZone}
                      now={now}
                      project={m.projectId ? projectOf(m.projectId) : null}
                      organizer={organizerName(m.organizerId)}
                      actions={rowActions(m)}
                      statusShown={g.key !== 'drafts'}
                    />
                  ))}
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
