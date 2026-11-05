import { Link } from 'react-router-dom';
import type { PortalMeetingItem } from '../../api/portal';
import { usePortalMeetings } from '../../components/portal/portal-queries';
import { Chip, LoadFailed, Loading, RESPONSE_TONE, RESPONSE_WORDS, Section, StatusBadge } from '../../components/portal/portal-ui';
import { clockText, dayText } from '../../lib/day-words';
import { NeedsModule, usePortalProjectContext } from './PortalProjectLayout';

/** 1.23 The "Meetings & minutes" tab: meetings the client was invited to, and meetings whose approved minutes are shared. */
export function PortalMeetingsTab() {
  return (
    <NeedsModule module="meetings">
      <Meetings />
    </NeedsModule>
  );
}

/** "Fri 30 Oct 2026 · 09:00–10:00", in the meeting's own time zone. */
export function meetingWhen(m: Pick<PortalMeetingItem, 'date' | 'startAt' | 'endAt' | 'timeZone'>): string {
  const start = clockText(m.startAt, m.timeZone);
  const end = m.endAt ? clockText(m.endAt, m.timeZone) : '';
  return `${dayText(m.date, { weekday: 'short' })} · ${end ? `${start}–${end}` : start}`;
}

function Meetings() {
  const { projectId } = usePortalProjectContext();
  const q = usePortalMeetings(projectId);
  return (
    <Section title="Meetings">
      {q.isPending ? (
        <Loading what="the meetings" />
      ) : q.isError ? (
        <LoadFailed what="the meetings" onRetry={() => void q.refetch()} />
      ) : q.data.length === 0 ? (
        <p className="text-sm text-ink-2">No meetings are shared with you yet. When you are invited to one, or its minutes are shared, it appears here.</p>
      ) : (
        <ul className="-mx-2 divide-y divide-line">
          {q.data.map((m) => (
            <li key={m.id}>
              <Link
                to={`/portal/projects/${encodeURIComponent(projectId)}/meetings/${encodeURIComponent(m.id)}`}
                className="flex min-h-11 items-start gap-3 rounded-xl px-2 py-3 outline-none transition-colors hover:bg-ground focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-sm font-semibold text-ink"><bdi>{m.title}</bdi></span>
                  <span className="mt-0.5 block text-xs text-ink-2">{meetingWhen(m)}</span>
                  <span className="mt-1.5 flex flex-wrap gap-1.5">
                    {m.invited && m.response ? <Chip tone={RESPONSE_TONE[m.response]}>{RESPONSE_WORDS[m.response]}</Chip> : null}
                    {m.hasMinutes ? <Chip tone="info">Minutes</Chip> : null}
                  </span>
                </span>
                <StatusBadge label={m.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
