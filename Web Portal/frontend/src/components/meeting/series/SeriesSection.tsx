import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../api/client';
import { MEETING_STATUS_LABELS, meetingsApi, type ActionItemStatus } from '../../../api/meetings';
import { meetingSeriesApi, type CarriedItem, type MeetingSeriesContext, type SeriesMeeting, type SeriesPrefill } from '../../../api/meeting-series';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { MeetingFormModal } from '../../MeetingFormModal';
import { meetingStatusTone } from '../../../lib/meetingFormat';
import { seriesDay, seriesHref, splitByNow } from '../../../lib/meeting-series';
import { TOUCH_TALL } from '../../../lib/touch';
import { DENSE_TEXT } from '../../../lib/density-tokens';
import { Section, SectionError } from '../kit';
import { meetingFailure } from '../meeting-actions';
import { CarriedItems } from './CarriedItems';

/** How many earlier and upcoming meetings show around this one before "Show all". */
const AROUND = 3;

/** One meeting of the series in a list: its day, title, status and "Minutes final" — this one marked, the others links. */
export function SeriesMeetingRow({ m, timeZone, now, current = false, actions }: { m: SeriesMeeting; timeZone: string; now: Date; current?: boolean; actions?: ReactNode }) {
  const body = (
    <>
      <span className={`w-[4.75rem] flex-none text-sm tabular-nums text-ink-2 ${DENSE_TEXT}`}>{seriesDay(m.startAt, timeZone, now)}</span>
      {/* The title and its badges share what's left: in a narrow panel (the meeting page's 22rem side
          column) the badges go under the title instead of squeezing it to a letter a line. */}
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
        <span className={`min-w-[min(10rem,100%)] flex-1 text-sm [overflow-wrap:break-word] ${DENSE_TEXT} ${m.status === 'CANCELLED' ? 'text-ink-3 line-through' : current ? 'font-semibold text-ink' : 'text-ink'}`}>
          <bdi>{m.title}</bdi>
        </span>
        <span className="flex flex-none flex-wrap items-center gap-1 empty:hidden">
          {current ? <Badge tone="brand">This meeting</Badge> : null}
          {m.status !== 'SCHEDULED' ? <Badge tone={meetingStatusTone(m.status)}>{MEETING_STATUS_LABELS[m.status]}</Badge> : null}
          {m.minutesFinal ? <Badge tone="success">Minutes final</Badge> : null}
        </span>
      </span>
    </>
  );
  return (
    <li className="flex items-center gap-1">
      {current ? (
        // Compact rows (1.23.0, lib/density): shorter rows with a mouse (phones and touch keep 44px).
        <div aria-current="page" className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg bg-brand/[0.06] px-2 py-1.5 compact:min-h-8 compact:py-1">{body}</div>
      ) : (
        <Link to={`/meetings/${encodeURIComponent(m.id)}`} className={`flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 compact:min-h-8 compact:py-1 transition-colors hover:bg-ground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${TOUCH_TALL}`}>
          {body}
        </Link>
      )}
      {actions}
    </li>
  );
}

/** Opens the new-meeting form pre-filled from the series' latest meeting ("New meeting in this series"). */
export function useNewMeetingInSeries(seriesId: string | null) {
  const [prefill, setPrefill] = useState<SeriesPrefill | null>(null);
  const load = useMutation({ mutationFn: () => meetingSeriesApi(apiClient).prefill(seriesId!), onSuccess: setPrefill });
  return {
    open: () => load.mutate(),
    busy: load.isPending,
    error: load.isError ? meetingFailure(load.error, 'Couldn’t start a new meeting in this series.') : null,
    clearError: () => load.reset(),
    prefill,
    close: () => setPrefill(null),
  };
}

/**
 * The pre-filled form, once "New meeting in this series" has its starting values. After a meeting whose
 * link Teams made, the link isn't copied: "Create a Teams link" starts ticked (it counts only for someone
 * who can make one — the form's rule), so the new meeting gets its own Teams meeting.
 */
export function NewMeetingInSeriesForm({ prefill, onClose }: { prefill: SeriesPrefill; onClose: () => void }) {
  const navigate = useNavigate();
  return <MeetingFormModal prefill={prefill} defaultTeamsLink={prefill.teamsLink === true} onClose={onClose} onSaved={(id) => navigate(`/meetings/${encodeURIComponent(id)}`)} />;
}

/**
 * The meeting page's Series section: the series' meetings this person may open, in date order —
 * earlier ones above, those to come below, this one marked — and the way to the Series page.
 */
export function SeriesSection({ context, meetingId, timeZone, canAddNew, now = new Date() }: { context: MeetingSeriesContext; meetingId: string; timeZone: string; canAddNew: boolean; now?: Date }) {
  const [all, setAll] = useState(false);
  const newMeeting = useNewMeetingInSeries(context.series.id);
  const list = context.meetings;
  const at = list.findIndex((m) => m.id === meetingId);
  const shown = all || list.length <= AROUND * 2 + 1 ? list : list.slice(Math.max(0, at - AROUND), at + AROUND + 1);
  // Date order throughout (the list comes in it): the held ones under Earlier, the rest under Coming up —
  // this meeting in its place among them, marked.
  const { earlier, upcoming } = splitByNow(shown, now);
  const group = (label: string, items: SeriesMeeting[]) =>
    items.length ? (
      <div>
        <h3 className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-ink-3">{label}</h3>
        <ul className="flex flex-col">{items.map((m) => <SeriesMeetingRow key={m.id} m={m} timeZone={timeZone} now={now} current={m.id === meetingId} />)}</ul>
      </div>
    ) : null;
  return (
    <Section
      id="series"
      title="Series"
      count={list.length > 1 ? `${list.length} meetings` : undefined}
      aside={
        <Link to={seriesHref(context.series.id)} className={`tap rounded text-sm font-medium text-brand hover:underline ${TOUCH_TALL}`}>
          Open series
        </Link>
      }
    >
      <p className="mb-2 text-sm font-semibold text-ink">
        <bdi>{context.series.name}</bdi>
      </p>
      <SectionError message={newMeeting.error} onDismiss={newMeeting.clearError} />
      <div className="flex flex-col gap-2">
        {group('Earlier', earlier)}
        {group('Coming up', upcoming)}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
        {shown.length < list.length || all ? (
          <Button variant="ghost" size="sm" onClick={() => setAll((v) => !v)} aria-expanded={all}>
            {all ? 'Show fewer' : `Show all ${list.length} meetings`}
          </Button>
        ) : null}
        {canAddNew ? (
          <Button variant="secondary" size="sm" loading={newMeeting.busy} onClick={newMeeting.open} className="ms-auto">
            + New meeting in this series
          </Button>
        ) : null}
      </div>
      {newMeeting.prefill ? <NewMeetingInSeriesForm prefill={newMeeting.prefill} onClose={newMeeting.close} /> : null}
    </Section>
  );
}

/** Change an action item's status (the same item everywhere), then read the series and the item's meeting again. */
export function useCarriedStatus(refreshKeys: ReadonlyArray<readonly unknown[]>) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const mut = useMutation({
    mutationFn: ({ item, status }: { item: CarriedItem; status: ActionItemStatus }) => meetingsApi(apiClient).updateActionItem(item.id, { status }),
    onSuccess: (_saved, { item }) => {
      setError(null);
      for (const key of refreshKeys) void qc.invalidateQueries({ queryKey: [...key] });
      void qc.invalidateQueries({ queryKey: ['meeting', item.meeting.id, 'action-items'] });
      void qc.invalidateQueries({ queryKey: ['my-action-items'] });
      void qc.invalidateQueries({ queryKey: ['meetings'] });
    },
    onError: (err) => setError(meetingFailure(err, 'Couldn’t change the action item.')),
  });
  return { change: (item: CarriedItem, status: ActionItemStatus) => mut.mutate({ item, status }), busy: mut.isPending, error, clearError: () => setError(null) };
}

/**
 * "Open from earlier meetings": the action items still open from this series' earlier meetings —
 * the same items, so a status changed here changes everywhere. Read-only for an invitee.
 */
export function CarryOverSection({ context, meetingId, timeZone, editable, now = new Date() }: { context: MeetingSeriesContext; meetingId: string; timeZone: string; editable: boolean; now?: Date }) {
  const status = useCarriedStatus([['meeting', meetingId, 'series']]);
  const items = context.openFromEarlier;
  const meetingStart = context.meetings.find((m) => m.id === meetingId)?.startAt;
  const hasEarlier = !!meetingStart && context.meetings.some((m) => Date.parse(m.startAt) < Date.parse(meetingStart));
  if (!hasEarlier && items.length === 0) return null;
  if (items.length === 0) {
    return (
      <Section id="carry-over" title="Open from earlier meetings" compact aside={<p className="text-sm text-ink-3">Nothing open from the series’ earlier meetings</p>}>
        {null}
      </Section>
    );
  }
  return (
    <Section id="carry-over" title="Open from earlier meetings" count={`${items.length} open`}>
      <SectionError message={status.error} onDismiss={status.clearError} />
      <CarriedItems items={items} timeZone={timeZone} now={now} busy={status.busy} onStatus={editable ? status.change : undefined} />
    </Section>
  );
}
