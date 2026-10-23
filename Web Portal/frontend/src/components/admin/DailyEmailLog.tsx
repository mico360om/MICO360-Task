import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import {
  dailyEmailsApi,
  type DailyEmailKind,
  type DailyEmailOverview,
  type DailyEmailOverviewEmail,
  type DailyEmailOverviewPerson,
  type DailyEmailState,
} from '../../api/daily-emails';
import { ApiError } from '../../lib/api-client';
import { todayKey } from '../../lib/due-date';
import { newIdempotencyKey } from '../../lib/offline-queue';
import { useCompanyTimeZone } from '../../lib/useCompanyTimeZone';
import { useDialog } from '../../hooks/useDialog';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { LoadError } from '../ui/LoadError';
import { ModalPortal } from '../ui/ModalPortal';
import { KIND_LABEL, STATE_TONE, dayLabel, nextSendText, sendNowText, sendResultText, stateText, when, type Tone } from './daily-email-words';

const OVERVIEW_KEY = 'daily-email-overview';
/** The section's address on the page: the extension's "Daily email log" link opens it. */
export const DAILY_EMAILS_ANCHOR = 'daily-emails';
const KINDS: DailyEmailKind[] = ['PENDING', 'COMPLETED'];
const emailOf = (p: DailyEmailOverviewPerson, kind: DailyEmailKind) => (kind === 'PENDING' ? p.pending : p.completed);

const STATUS_OPTIONS: { value: '' | DailyEmailState; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'DUE', label: 'Still to come' },
  { value: 'SENDING', label: 'Sending' },
  { value: 'SENT', label: 'Sent' },
  { value: 'SKIPPED', label: 'Skipped' },
  { value: 'RETRY', label: 'Retrying' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'OFF', label: 'Turned off' },
  { value: 'NONE', label: 'No email that day' },
];

const TONE_DOT: Record<Tone, string> = { success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger', info: 'bg-info', neutral: 'bg-ink-3' };
const TONE_TEXT: Record<Tone, string> = { success: 'text-ink', warning: 'text-warning', danger: 'text-danger', info: 'text-ink', neutral: 'text-ink-2' };
const fieldClass = 'w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink outline-none focus:border-brand sm:w-auto';

function isOverview(v: unknown): v is DailyEmailOverview {
  const o = v as Partial<DailyEmailOverview> | null | undefined;
  return Boolean(o && typeof o === 'object' && !Array.isArray(o) && Array.isArray(o.people) && o.summary && typeof o.summary === 'object');
}

/** The server's own words for a refusal (too soon, turned off, email not set up); else `fallback`. */
function problemText(e: unknown, fallback: string): string {
  return e instanceof ApiError && e.message && (e.status < 500 || e.code === 'EMAIL_NOT_CONFIGURED') ? e.message : fallback;
}

/**
 * System Settings → Daily task emails: the day at a glance for administrators. Today's numbers, when
 * the server last checked and the next send, and "Send today's emails now"; then everyone with an
 * email address — each email on or off, their send time and time zone, and how that email is doing
 * today — with Send (Resend for one already sent) and Preview. Days are each person's own calendar
 * day; times in a person's row are in their time zone, the rest in the company's.
 */
export function DailyEmailLog() {
  const qc = useQueryClient();
  const timeZone = useCompanyTimeZone();
  const today = todayKey(timeZone);
  const [day, setDay] = useState(''); // '' = today (each person's own)
  const [status, setStatus] = useState<'' | DailyEmailState>('');
  const [search, setSearch] = useState('');
  const isToday = !day || day === today;
  const q = useQuery({
    queryKey: [OVERVIEW_KEY, isToday ? 'today' : day],
    queryFn: () => dailyEmailsApi(apiClient).overview(isToday ? undefined : day),
  });
  // Only an answer with the overview's shape is used: an older server or a proxy page shows "Couldn't load".
  const data = isOverview(q.data) ? q.data : undefined;
  const sectionRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Opened from a link to this section (the extension's "Daily email log"): once it has loaded (so it
  // no longer grows), show it and start Tab here. Once only.
  const jumped = useRef(false);
  const ready = Boolean(data) || q.isError;
  useEffect(() => {
    if (jumped.current || !ready || window.location.hash !== `#${DAILY_EMAILS_ANCHOR}`) return;
    jumped.current = true;
    sectionRef.current?.scrollIntoView?.({ block: 'start' });
    headingRef.current?.focus({ preventScroll: true });
  }, [ready]);

  const term = search.trim().toLowerCase();
  const people = (data?.people ?? []).filter(
    (p) =>
      (!status || p.pending.state === status || p.completed.state === status) &&
      (!term || p.name.toLowerCase().includes(term) || p.email.toLowerCase().includes(term)),
  );
  const refresh = () => qc.invalidateQueries({ queryKey: [OVERVIEW_KEY] });

  return (
    <section ref={sectionRef} id={DAILY_EMAILS_ANCHOR} className="card min-w-0 p-5 lg:col-span-2" aria-labelledby="daily-email-log-heading">
      <h2 ref={headingRef} tabIndex={-1} id="daily-email-log-heading" className="eyebrow mb-1 outline-none">Daily task emails</h2>
      <p className="mb-4 text-sm text-ink-2">
        The morning emails each person gets (pending tasks; tasks completed yesterday). A failed send is tried again after 5, 15 and 45
        minutes before it counts as failed. Days are each person’s own calendar day.
      </p>
      {data?.emailEnabled === false ? (
        <p className="mb-4 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
          Email isn’t set up on this server, so no daily emails are being sent. Add the email (Mailjet) keys to the server’s settings to start them.
        </p>
      ) : null}

      {q.isLoading ? (
        <p className="text-ink-2">Loading…</p>
      ) : q.isError || !data ? (
        <LoadError what="the daily emails" onRetry={() => void q.refetch()} />
      ) : (
        <>
          <Summary data={data} timeZone={timeZone} isToday={isToday} day={day} onSent={refresh} />

          <div className="mb-3 mt-5 flex flex-wrap items-end gap-3">
            <label className="flex w-full flex-col gap-1 text-xs font-medium text-ink-2 sm:w-auto">
              Day
              <input
                type="date"
                value={day || today}
                onChange={(e) => setDay(!e.target.value || e.target.value === today ? '' : e.target.value)}
                className={fieldClass}
              />
            </label>
            <label className="flex w-full flex-col gap-1 text-xs font-medium text-ink-2 sm:w-auto">
              Status
              <select value={status} onChange={(e) => setStatus(e.target.value as '' | DailyEmailState)} className={fieldClass}>
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
            <label className="flex w-full flex-col gap-1 text-xs font-medium text-ink-2 sm:w-64">
              Find a person
              <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or email" className={`${fieldClass} sm:w-full`} />
            </label>
          </div>

          {data.people.length === 0 ? (
            <p className="text-sm text-ink-2">No one has an email address to send to yet.</p>
          ) : people.length === 0 ? (
            <p className="text-sm text-ink-2">No one matches these filters.</p>
          ) : (
            <ul aria-label="Everyone and their daily emails" className="flex flex-col gap-3">
              {people.map((p) => (
                <PersonCard key={p.userId} person={p} emailEnabled={data.emailEnabled !== false} isToday={isToday} onSent={refresh} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/** Today's numbers (or the day's), the server's last check and next send, and "Send today's emails now". */
function Summary({ data, timeZone, isToday, day, onSent }: { data: DailyEmailOverview; timeZone: string; isToday: boolean; day: string; onSent: () => void }) {
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const s = data.summary;
  const enabled = data.emailEnabled !== false;
  const nobody = s.toSend === 0;
  const sendNow = useMutation({
    mutationFn: () => dailyEmailsApi(apiClient).sendNow(newIdempotencyKey()),
    onMutate: () => setNote(null),
    onSuccess: (r) => setNote({ ok: true, text: sendNowText(r) }),
    onError: (e) => setNote({ ok: false, text: problemText(e, 'Couldn’t send today’s emails. Check your connection and try again.') }),
    onSettled: () => {
      setAsking(false);
      onSent();
    },
  });
  const tiles: [string, number][] = [
    ['People', s.people],
    ['Sent', s.sent],
    ['Skipped', s.skipped],
    ['Failed', s.failed],
    ['Retrying', s.retrying],
    ['Still to come', s.upcoming],
    ...(s.sending ? ([['Sending', s.sending]] as [string, number][]) : []),
  ];
  const label = isToday ? 'Today’s summary' : `Summary for ${dayLabel(day)}`;

  return (
    <section aria-label={label} className="rounded-xl border border-line bg-ground/60 p-4">
      <h3 className="mb-3 text-sm font-semibold text-ink">{label}</h3>
      <dl className="grid grid-cols-2 gap-2 min-[420px]:grid-cols-3 md:grid-cols-6">
        {tiles.map(([name, value]) => (
          <div key={name} className="rounded-lg bg-surface px-3 py-2">
            <dt className="text-xs text-ink-2">{name}</dt>
            <dd className="font-display text-lg font-semibold tabular-nums text-ink">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 flex flex-col gap-1 text-sm text-ink-2 sm:flex-row sm:flex-wrap sm:gap-x-6">
        <p>Server last checked: {data.lastCheckedAt ? when(data.lastCheckedAt, timeZone) : 'not since the server started'}</p>
        <p>Next send: {nextSendText(data.nextSendAt, timeZone)}</p>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <Button
          size="sm"
          disabled={!enabled}
          aria-disabled={enabled && nobody ? true : undefined}
          aria-describedby={enabled && nobody ? 'daily-send-now-note' : undefined}
          onClick={() => {
            if (!nobody) setAsking(true);
          }}
        >
          Send today’s emails now
        </Button>
        {enabled && nobody ? <span id="daily-send-now-note" className="text-sm text-ink-2">Everyone has had today’s emails.</span> : null}
        <p role="status" className="min-w-0 text-sm text-ink-2">{note?.ok ? note.text : ''}</p>
        {note && !note.ok ? <p role="alert" className="min-w-0 text-sm text-danger">{note.text}</p> : null}
      </div>
      {asking ? (
        <ConfirmDialog
          title={`Send today’s emails now to ${s.toSend} ${s.toSend === 1 ? 'person' : 'people'}?`}
          confirmLabel="Send now"
          keepLabel="Not now"
          tone="primary"
          busy={sendNow.isPending}
          onConfirm={() => sendNow.mutate()}
          onClose={() => setAsking(false)}
        >
          Anyone who already got today’s won’t get them again.
        </ConfirmDialog>
      ) : null}
    </section>
  );
}

/** One person: their send time and time zone, and each email with Send / Resend and Preview. */
function PersonCard({ person, emailEnabled, isToday, onSent }: { person: DailyEmailOverviewPerson; emailEnabled: boolean; isToday: boolean; onSent: () => void }) {
  const [askResend, setAskResend] = useState<DailyEmailKind | null>(null);
  const [preview, setPreview] = useState<DailyEmailKind | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const send = useMutation({
    mutationFn: (v: { kind: DailyEmailKind; resend: boolean }) => dailyEmailsApi(apiClient).send({ userId: person.userId, ...v }, newIdempotencyKey()),
    onMutate: () => setNote(null),
    onSuccess: (r, v) => setNote(sendResultText(r, v.resend, person.timeZone)),
    onError: (e) => setNote({ ok: false, text: problemText(e, 'Couldn’t send the email. Check your connection and try again.') }),
    onSettled: () => {
      setAskResend(null);
      onSent();
    },
  });
  const zone = person.ownTimeZone ? `their own time zone (${person.timeZone})` : `company time (${person.timeZone})`;
  const resendOf = askResend ? emailOf(person, askResend) : null;

  return (
    <li className="min-w-0 rounded-xl border border-line p-4">
      <div className="mb-3 min-w-0">
        <h3 dir="auto" className="font-medium text-ink">{person.name}</h3>
        <p className="text-xs text-ink-3 [overflow-wrap:anywhere]">{person.email}</p>
        <p className="mt-1 text-xs text-ink-2">Sends at {person.time}, {zone}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {KINDS.map((kind) => (
          <EmailBlock
            key={kind}
            person={person}
            kind={kind}
            email={emailOf(person, kind)}
            emailEnabled={emailEnabled}
            isToday={isToday}
            busy={send.isPending}
            sending={send.isPending && send.variables?.kind === kind}
            onSend={() => {
              if (send.isPending) return;
              if (emailOf(person, kind).state === 'SENT') setAskResend(kind);
              else send.mutate({ kind, resend: false });
            }}
            onPreview={() => setPreview(kind)}
          />
        ))}
      </div>
      <p role="status" className="mt-2 text-sm text-ink-2 empty:hidden">{note?.ok ? note.text : ''}</p>
      {note && !note.ok ? <p role="alert" className="mt-2 text-sm text-danger">{note.text}</p> : null}
      {askResend && resendOf ? (
        <ConfirmDialog
          title={resendOf.sentAt ? `They already got it at ${when(resendOf.sentAt, person.timeZone)}. Send again?` : 'They already got it today. Send again?'}
          confirmLabel="Send again"
          keepLabel="Don’t send"
          tone="primary"
          busy={send.isPending}
          onConfirm={() => send.mutate({ kind: askResend, resend: true })}
          onClose={() => setAskResend(null)}
        >
          {person.name}’s {KIND_LABEL[askResend]} email is built again from their tasks as they are now.
        </ConfirmDialog>
      ) : null}
      {preview ? <PreviewDialog person={person} kind={preview} onClose={() => setPreview(null)} /> : null}
    </li>
  );
}

function EmailBlock(props: {
  person: DailyEmailOverviewPerson;
  kind: DailyEmailKind;
  email: DailyEmailOverviewEmail;
  emailEnabled: boolean;
  isToday: boolean;
  /** One of this person's emails is being sent (this one: `sending`). */
  busy: boolean;
  sending: boolean;
  onSend: () => void;
  onPreview: () => void;
}) {
  const { person, kind, email, emailEnabled, isToday, busy, sending } = props;
  const whyId = useId();
  const label = KIND_LABEL[kind];
  const tone = STATE_TONE[email.state] ?? 'neutral';
  const resend = email.state === 'SENT';
  // Why Send can't be used, said to everyone (a tooltip, and the button's description).
  const why: string | null = !email.on
    ? `${person.name} turned this email off.`
    : !emailEnabled
      ? 'Emails can’t be sent until email is set up on this server.'
      : !isToday
        ? 'Emails can only be sent for today. Choose today to send.'
        : email.state === 'SENDING'
          ? 'It’s being sent right now.'
          : null;
  return (
    <div className="min-w-0 rounded-lg bg-ground/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-ink">{label}</span>
        <OnOff on={email.on} />
      </div>
      <p className={`mt-1 flex items-start gap-1.5 text-sm ${TONE_TEXT[tone]}`}>
        <span className={`mt-1.5 h-1.5 w-1.5 flex-none rounded-full ${TONE_DOT[tone]}`} aria-hidden="true" />
        <span dir="auto" className="min-w-0 [overflow-wrap:anywhere]">{stateText(email, person.timeZone)}</span>
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={Boolean(why)}
          loading={!why && sending}
          aria-disabled={!why && busy ? true : undefined}
          aria-label={`${resend ? 'Resend' : 'Send'} ${person.name}’s ${label} email`}
          aria-describedby={why ? whyId : undefined}
          title={why ?? undefined}
          onClick={props.onSend}
        >
          {resend ? 'Resend' : 'Send'}
        </Button>
        <Button size="sm" variant="ghost" aria-label={`Preview ${person.name}’s ${label} email`} onClick={props.onPreview}>
          Preview
        </Button>
        {why ? <span id={whyId} className="sr-only">{why}</span> : null}
      </div>
    </div>
  );
}

function OnOff({ on }: { on: boolean }) {
  return (
    <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${on ? 'bg-success-soft text-success' : 'bg-ground text-ink-2'}`}>
      {on ? 'On' : 'Off'}
    </span>
  );
}

/** The email as it would be sent now — subject and plain text, shown as text (never as HTML). */
function PreviewDialog({ person, kind, onClose }: { person: DailyEmailOverviewPerson; kind: DailyEmailKind; onClose: () => void }) {
  const dialogRef = useDialog(onClose);
  const titleId = useId();
  const noteId = useId();
  const q = useQuery({
    queryKey: ['daily-email-preview', person.userId, kind],
    queryFn: () => dailyEmailsApi(apiClient).preview(person.userId, kind),
    staleTime: 0,
    gcTime: 0,
  });
  const email = emailOf(person, kind);
  const label = KIND_LABEL[kind];
  const empty: ReactNode =
    kind === 'PENDING'
      ? `Nothing to send right now: ${person.name} has no pending tasks.`
      : `Nothing to send right now: none of ${person.name}’s tasks were completed yesterday.`;
  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 grid place-items-center p-4">
        <div className="absolute inset-0 bg-ink/40 animate-fade-in" onClick={onClose} aria-hidden="true" />
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={noteId}
          className="card relative flex max-h-[calc(var(--visible-height)-2rem)] w-full max-w-2xl animate-scale-in flex-col overflow-hidden"
        >
          <div className="border-b border-line px-5 py-4">
            <h2 id={titleId} dir="auto" className="font-display text-lg font-semibold text-ink">{label} email for {person.name}</h2>
            <p id={noteId} className="mt-1 text-sm text-ink-2">
              {email.state === 'SENT'
                ? `As it would be sent now — not a copy of the one they got${email.sentAt ? ` at ${when(email.sentAt, person.timeZone)}` : ''}. The server keeps no copy of sent emails.`
                : 'As it would be sent now, from their tasks as they are now.'}
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {!email.on ? <p className="mb-3 rounded-lg bg-ground px-3 py-2 text-sm text-ink-2">They’ve turned this email off, so it isn’t sent to them.</p> : null}
            {q.isLoading ? (
              <p className="text-sm text-ink-2">Building the email…</p>
            ) : q.isError || !q.data ? (
              <LoadError what="the preview" onRetry={() => void q.refetch()} />
            ) : q.data.empty || !q.data.text ? (
              <p className="text-sm text-ink-2">{empty}</p>
            ) : (
              <>
                <p className="text-sm text-ink [overflow-wrap:anywhere]">
                  <span className="text-ink-2">To: </span>
                  {q.data.email}
                </p>
                <p className="mt-1 text-sm text-ink">
                  <span className="text-ink-2">Subject: </span>
                  <span dir="auto" className="font-medium">{q.data.subject}</span>
                </p>
                <pre dir="auto" className="mt-3 whitespace-pre-wrap rounded-lg bg-ground p-3 font-mono text-[13px] leading-relaxed text-ink [overflow-wrap:anywhere]">
                  {q.data.text}
                </pre>
              </>
            )}
          </div>
          <div className="flex justify-end border-t border-line px-5 py-3">
            <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
