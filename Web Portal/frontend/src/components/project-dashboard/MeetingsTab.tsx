import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ACTION_STATUS_LABELS, MEETING_STATUS_LABELS, type MeetingPhase, type ProjectMeeting, type ProjectMeetingsOverview } from '../../api/meetings';
import { Badge } from '../ui/Badge';
import { DateLeaf, MINUTES } from '../meeting/meeting-card-parts';
import { Button } from '../ui/Button';
import { formatMeetingTimes, meetingStatusTone } from '../../lib/meetingFormat';
import { meetingRepeatText } from '../../lib/meeting-repeat';
import { zonedDayKey } from '../../lib/due-date';
import { EmptyNote, RepeatIcon, SectionCard, dayText } from './parts';
import { TOUCH_TALL } from '../../lib/touch';

type Filter = MeetingPhase | 'all';
const FILTERS: Array<{ v: Filter; label: string }> = [
  { v: 'upcoming', label: 'Upcoming' },
  { v: 'ongoing', label: 'Under way' },
  { v: 'completed', label: 'Held' },
  { v: 'cancelled', label: 'Cancelled' },
  { v: 'all', label: 'All' },
];

const ITEMS_SHOWN = 8;
/** Meetings listed before "Show all" (a daily series alone has 26 ahead). */
const MEETINGS_SHOWN = 12;

function MeetingCard({ m, timeZone }: { m: ProjectMeeting; timeZone: string }) {
  const zone = m.timeZone || timeZone;
  const minutes = MINUTES[m.minutes];
  const muted = m.phase === 'cancelled' || m.phase === 'completed';
  const day = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: zone }).format(new Date(m.startAt));
  return (
    <li className="flex gap-3 rounded-xl border border-line bg-surface p-3 transition-colors hover:border-brand/30 sm:p-4" data-meeting={m.id}>
      <DateLeaf iso={m.startAt} timeZone={zone} tone={muted ? 'muted' : 'upcoming'} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link to={`/meetings/${m.id}`} className={`min-w-0 break-words font-semibold hover:text-brand [@media(pointer:coarse)]:inline-flex [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:items-center ${m.phase === 'cancelled' ? 'text-ink-3 line-through' : 'text-ink'}`}>
            <bdi>{m.title}</bdi>
          </Link>
          {m.phase === 'ongoing' ? <Badge tone="brand" dot>Under way</Badge> : m.status !== 'SCHEDULED' ? <Badge tone={meetingStatusTone(m.status)}>{MEETING_STATUS_LABELS[m.status]}</Badge> : null}
          {m.seriesId ? (
            <span className="inline-flex items-center gap-1 text-xs text-ink-3" title="Part of a repeating series"><RepeatIcon /> Repeats</span>
          ) : null}
        </div>
        <p className="mt-0.5 text-sm text-ink-2">
          <span className="sr-only">{day}, </span>
          {formatMeetingTimes(m.startAt, m.endAt, zone)}
          {m.location ? <> · <bdi>{m.location}</bdi></> : m.onlineLink ? ' · Online' : ''}
        </p>
        <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ink-2">
          <li title={m.attendees.join(', ')}>
            {m.attendeeCount === 0 ? 'No attendees yet' : `${m.attendeeCount} ${m.attendeeCount === 1 ? 'person' : 'people'}`}
            {m.attendees.length ? <span className="text-ink-3"> · <bdi>{m.attendees.slice(0, 3).join(', ')}</bdi>{m.attendeeCount > 3 ? ` +${m.attendeeCount - 3}` : ''}</span> : null}
          </li>
          {minutes ? <li><Badge tone={minutes.tone}>{minutes.label}</Badge></li> : null}
          {m.decisionCount ? <li>{m.decisionCount} {m.decisionCount === 1 ? 'decision' : 'decisions'}</li> : null}
          {m.openActionItemCount ? <li className="font-medium text-warning">{m.openActionItemCount} open action {m.openActionItemCount === 1 ? 'item' : 'items'}</li> : null}
        </ul>
      </div>
    </li>
  );
}

/**
 * The project's meetings by where they stand — upcoming, under way, held, cancelled — with their
 * people, minutes, decisions and open action items; and beside them the project's repeating
 * series, its latest decisions and its action items.
 */
export function MeetingsTab({
  data,
  loading,
  failed,
  onRetry,
  timeZone,
  onNew,
}: {
  data: ProjectMeetingsOverview | null;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  timeZone: string;
  /** Schedule a meeting in this project (absent when the project takes no new work). */
  onNew?: () => void;
}) {
  const [filter, setFilter] = useState<Filter>('upcoming');
  const [allItems, setAllItems] = useState(false);
  const [allMeetings, setAllMeetings] = useState(false);
  const meetings = data?.meetings ?? [];
  const counts: Record<Filter, number> = {
    upcoming: data?.stats.upcoming ?? 0,
    ongoing: data?.stats.ongoing ?? 0,
    completed: data?.stats.completed ?? 0,
    cancelled: data?.stats.cancelled ?? 0,
    all: meetings.length,
  };
  const shown = useMemo(() => {
    const list = filter === 'all' ? meetings : meetings.filter((m) => m.phase === filter);
    // Coming meetings soonest first; past ones latest first.
    const latestFirst = filter === 'completed' || filter === 'cancelled';
    return [...list].sort((a, b) => (latestFirst ? -1 : 1) * (Date.parse(a.startAt) - Date.parse(b.startAt)));
  }, [meetings, filter]);

  if (failed && !data) {
    return (
      <p role="alert" className="card p-5 text-sm text-danger">
        Couldn’t load the project’s meetings. <button type="button" className="font-semibold underline" onClick={onRetry}>Retry</button>
      </p>
    );
  }
  if (loading && !data) return <div className="skeleton h-48 rounded-xl" aria-label="Loading meetings" />;

  const items = data?.actionItems ?? [];
  const openItems = items.filter((x) => x.status !== 'COMPLETED' && x.status !== 'CANCELLED');
  const itemsShown = allItems ? items : openItems.slice(0, ITEMS_SHOWN);

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="min-w-0 space-y-3 lg:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div role="group" aria-label="Show meetings" className="flex max-w-full gap-1 overflow-x-auto rounded-xl bg-ground p-1">
            {FILTERS.map((f) => (
              <button
                key={f.v}
                type="button"
                aria-pressed={filter === f.v}
                onClick={() => {
                  setFilter(f.v);
                  setAllMeetings(false);
                }}
                className={`whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${TOUCH_TALL} ${filter === f.v ? 'bg-surface text-ink shadow-soft' : 'text-ink-2 hover:text-ink'}`}
              >
                {f.label} <span className="tabular-nums text-ink-3">{counts[f.v]}</span>
              </button>
            ))}
          </div>
          {onNew ? <Button size="sm" onClick={onNew}>+ New meeting</Button> : null}
        </div>
        {shown.length === 0 ? (
          <EmptyNote>
            {meetings.length === 0
              ? 'No meetings in this project yet. Schedule one — it can repeat daily, weekly or monthly.'
              : `No ${FILTERS.find((f) => f.v === filter)!.label.toLowerCase()} meetings.`}
          </EmptyNote>
        ) : (
          <>
            <ul aria-label="Meetings" className="flex flex-col gap-2">
              {(allMeetings ? shown : shown.slice(0, MEETINGS_SHOWN)).map((m) => <MeetingCard key={m.id} m={m} timeZone={timeZone} />)}
            </ul>
            {shown.length > MEETINGS_SHOWN ? (
              <button
                type="button"
                onClick={() => setAllMeetings((v) => !v)}
                aria-expanded={allMeetings}
                className="w-full rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-brand transition-colors hover:border-brand"
              >
                {allMeetings ? 'Show fewer' : `Show all ${shown.length} meetings`}
              </button>
            ) : null}
          </>
        )}
      </div>

      <div className="min-w-0 space-y-4">
        <SectionCard id="pd-series" title="Repeating meetings">
          {(data?.series ?? []).length === 0 ? (
            <EmptyNote>No repeating meetings.</EmptyNote>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {data!.series.map((s) => (
                <li key={s.id} className="min-w-0">
                  <Link to={`/meetings/${s.nextMeetingId ?? s.id}`} className="flex items-center gap-1.5 font-medium text-ink hover:text-brand">
                    <span className="text-brand"><RepeatIcon /></span>
                    <bdi className="truncate">{s.title}</bdi>
                  </Link>
                  <p className="text-xs text-ink-2">{meetingRepeatText(s.rule, s.firstStartAt ?? s.nextStartAt ?? new Date().toISOString(), timeZone)}</p>
                  <p className="text-xs text-ink-3">
                    {s.nextStartAt ? `Next: ${dayText(zonedDayKey(new Date(s.nextStartAt), timeZone))}` : 'No upcoming meeting'}
                    {s.upcoming > 1 ? ` · ${s.upcoming} planned` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard id="pd-decisions" title="Decisions">
          {(data?.decisions ?? []).length === 0 ? (
            <EmptyNote>No decisions recorded yet. Notes marked “Decision” in a meeting appear here.</EmptyNote>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {data!.decisions.slice(0, ITEMS_SHOWN).map((d) => (
                <li key={d.id} className="border-s-2 border-success/50 ps-2.5">
                  <p dir="auto" className="text-start text-sm text-ink [overflow-wrap:anywhere]">{d.text}</p>
                  <p className="text-xs text-ink-3">
                    <Link to={`/meetings/${d.meetingId}`} className="hover:text-brand"><bdi>{d.meetingTitle ?? 'Meeting'}</bdi></Link> · {dayText(zonedDayKey(new Date(d.at), timeZone))}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          id="pd-actions"
          title="Action items"
          action={items.length > openItems.slice(0, ITEMS_SHOWN).length ? (
            <button type="button" onClick={() => setAllItems((v) => !v)} aria-expanded={allItems} className="text-xs font-semibold text-brand hover:underline">
              {allItems ? 'Open only' : `Show all ${items.length}`}
            </button>
          ) : null}
        >
          {items.length === 0 ? (
            <EmptyNote>No action items yet.</EmptyNote>
          ) : itemsShown.length === 0 ? (
            <EmptyNote>Every action item is done.</EmptyNote>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {itemsShown.map((x) => {
                const done = x.status === 'COMPLETED' || x.status === 'CANCELLED';
                return (
                  <li key={x.id} className="py-2 first:pt-0 last:pb-0">
                    <p dir="auto" className={`text-start text-sm [overflow-wrap:anywhere] ${done ? 'text-ink-3 line-through' : 'text-ink'}`}>{x.description}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-2">
                      <span>{x.assignee ? <bdi>{x.assignee.name}</bdi> : 'Unassigned'}</span>
                      {x.dueDate ? (
                        <span className={x.overdue ? 'font-semibold text-danger' : ''}>{x.overdue ? 'Overdue · ' : 'Due '}{dayText(x.dueDate.slice(0, 10))}</span>
                      ) : null}
                      {x.status !== 'OPEN' ? <span className="text-ink-3">{ACTION_STATUS_LABELS[x.status]}</span> : null}
                      {x.meetingId ? <Link to={`/meetings/${x.meetingId}`} className="text-ink-3 hover:text-brand">· <bdi>{x.meetingTitle ?? 'Meeting'}</bdi></Link> : null}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
