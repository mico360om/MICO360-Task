import { useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import { meetingsApi, type MinutesSend, type MinutesSentAddress } from '../../api/meetings';
import { apiClient } from '../../api/client';
import { dateTimeText } from '../../lib/day-words';
import { TOUCH_TALL } from '../../lib/touch';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { LoadError } from './kit';
import { notSentReason } from './InviteDialog';
import type { MinutesPrefill } from './MinutesEmailDialog';

/** The query key of a meeting's "Sent" log (sending the minutes asks for it again). */
export const minutesSendsKey = (meetingId: string) => ['meeting', meetingId, 'minutes-sends'] as const;

const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;

/**
 * The minutes' "Sent" log, at the foot of the meeting's minutes card, for the people who may send:
 * each send newest first — who sent the draft or the final minutes, to how many people and when, its
 * To and Cc lines with each address's result, and Send again (the dialog with the same To and Cc).
 * Stays out of the way until the meeting has ended or something was sent.
 */
export function MinutesSentLog({
  meetingId,
  timeZone,
  ended,
  canSend,
  onSendAgain,
}: {
  meetingId: string;
  timeZone: string;
  /** The meeting is over: an empty log then says so. */
  ended: boolean;
  /** The minutes may be emailed now (not for a cancelled meeting): Send again is offered. */
  canSend: boolean;
  onSendAgain: (prefill: MinutesPrefill) => void;
}) {
  const headingId = useId();
  const q = useQuery({ queryKey: minutesSendsKey(meetingId), queryFn: () => meetingsApi(apiClient).listMinutesSends(meetingId) });
  const sends = Array.isArray(q.data) ? q.data : [];
  if (q.isLoading || (q.isSuccess && sends.length === 0 && !ended)) return null;

  return (
    <div className="mt-5 border-t border-line pt-4">
      <h3 id={headingId} className="mb-2 text-sm font-semibold text-ink">Sent</h3>
      {q.isError ? (
        <LoadError what="the sent minutes" onRetry={() => void q.refetch()} />
      ) : sends.length === 0 ? (
        <p className="text-sm text-ink-3">The minutes haven’t been emailed yet.</p>
      ) : (
        <ol aria-labelledby={headingId} className="flex flex-col gap-2.5">
          {sends.map((s) => (
            <SentEntry key={s.id} send={s} timeZone={timeZone} canSend={canSend} onSendAgain={onSendAgain} />
          ))}
        </ol>
      )}
    </div>
  );
}

function SentEntry({ send, timeZone, canSend, onSendAgain }: { send: MinutesSend; timeZone: string; canSend: boolean; onSendAgain: (prefill: MinutesPrefill) => void }) {
  const lineId = useId();
  const everyone = [...send.to, ...send.cc];
  // 1.23.7: a client left out on purpose (their minutes are off) is neither sent to nor failed.
  const held = everyone.filter((a) => a.notSent).length;
  const total = everyone.length - held;
  const failed = everyone.filter((a) => !a.ok && !a.notSent).length;
  return (
    <li aria-labelledby={lineId} className="rounded-xl border border-line p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p id={lineId} className="text-sm text-ink">
            <bdi className="font-semibold">{send.sentBy?.name ?? 'Someone'}</bdi> sent the {send.final ? 'final' : 'draft'} minutes to {people(total)}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
            <time dateTime={send.sentAt}>{dateTimeText(send.sentAt, timeZone)}</time>
            <Badge tone={send.final ? 'success' : 'neutral'}>{send.final ? 'Final' : 'Draft'}</Badge>
            {failed ? <span className="font-medium text-danger">{failed} failed</span> : null}
            {held ? <span className="font-medium text-ink-2">{held} not sent</span> : null}
          </p>
        </div>
        {canSend ? (
          <Button type="button" size="sm" variant="secondary" className={TOUCH_TALL} onClick={() => onSendAgain({ to: send.to, cc: send.cc })}>
            Send again
          </Button>
        ) : null}
      </div>
      <dl className="mt-2 grid grid-cols-1 gap-x-3 gap-y-1 text-sm sm:grid-cols-[2.5rem_minmax(0,1fr)]">
        <dt className="text-xs font-semibold uppercase tracking-wide text-ink-3 sm:pt-1">To</dt>
        <dd className="min-w-0">
          <Addresses label="To" list={send.to} />
        </dd>
        {send.cc.length ? (
          <>
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink-3 sm:pt-1">Cc</dt>
            <dd className="min-w-0">
              <Addresses label="Cc" list={send.cc} />
            </dd>
          </>
        ) : null}
      </dl>
    </li>
  );
}

/** "the client turned these off" → "The client turned these off". */
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** One line's addresses, each with how it went ("Sent" / "Failed" / "Not sent", and why). */
function Addresses({ label, list }: { label: string; list: MinutesSentAddress[] }) {
  return (
    <ul aria-label={label} className="flex flex-col divide-y divide-line">
      {list.map((a) => {
        const why = a.notSent ? notSentReason(a.error) : '';
        return (
          <li key={a.email} className="flex items-start justify-between gap-3 py-1">
            <span className="min-w-0">
              {a.name ? <bdi className="block truncate text-ink">{a.name}</bdi> : null}
              <span title={a.email} className={`block truncate ${a.name ? 'text-xs text-ink-3' : 'text-ink'}`} dir="ltr">
                {a.email}
              </span>
              {/* Nothing went to someone held back, so no "own email" either. */}
              {a.copy === 'own' && !a.notSent ? <span className="block text-xs text-ink-2">Their own email (another company)</span> : null}
              {a.notSent ? (
                why ? <span className="block text-xs text-ink-2">{sentence(why)}</span> : null
              ) : !a.ok && a.error ? (
                <span className="block text-xs text-danger">{a.error}</span>
              ) : null}
            </span>
            <span className={`flex-none text-xs font-semibold ${a.ok ? 'text-success' : a.notSent ? 'text-ink-2' : 'text-danger'}`}>{a.ok ? 'Sent' : a.notSent ? 'Not sent' : 'Failed'}</span>
          </li>
        );
      })}
    </ul>
  );
}
