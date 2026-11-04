import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { configApi } from '../../api/config';
import { notificationsApi, type DailyEmailPart, type DailyEmailPrefs, type DailyEmailTestResult, type NotificationPreferences } from '../../api/notifications';
import { ApiError } from '../../lib/api-client';
import { useDateSettings } from '../../lib/useDatePrefs';
import { SearchableSelect } from '../ui/SearchableSelect';
import { timeOptions } from '../ui/DateTimeField';
import { Toggle } from '../ui/Toggle';

const DEFAULTS: DailyEmailPrefs = { pending: true, completed: true, time: '06:00', schedule: true, urgent: true, managed: true };
const PREFS_KEY = ['notification-prefs'];
/** The section's address: the email's "Daily email settings" link opens it (/settings#daily-email; the Settings page scrolls to it). */
export const DAILY_EMAIL_ANCHOR = 'daily-email';

/** The parts of the email, in its order, with what each one holds. */
const PARTS: Array<{ key: DailyEmailPart; label: string; hint: string }> = [
  { key: 'schedule', label: 'Today’s schedule', hint: 'Your meetings today, and your tasks due at a time today, by time.' },
  { key: 'urgent', label: 'Overdue & urgent', hint: 'Your overdue tasks (most days overdue first), then your urgent ones.' },
  { key: 'pending', label: 'Your tasks by project', hint: 'Your other open tasks, grouped by project, most urgent first.' },
  { key: 'managed', label: 'In your projects', hint: 'If you run a project: its overdue tasks and those waiting for approval.' },
  { key: 'completed', label: 'Recently completed', hint: 'Your tasks completed since the last email.' },
];
const anyOn = (d: DailyEmailPrefs) => PARTS.some((p) => d[p.key]);
const allParts = (on: boolean) => Object.fromEntries(PARTS.map((p) => [p.key, on])) as Record<DailyEmailPart, boolean>;

const BLOCKED = 'Not sent: your email address is blocked after a bounce or spam complaint. Ask an administrator to check it.';

/** How "Send me a test" went (a server before 1.22 answered for its two emails). */
function testOutcome(r: DailyEmailTestResult): 'sent' | 'empty' | 'blocked' {
  if (r.daily) return r.daily;
  if (r.pending === 'blocked' || r.completed === 'blocked') return 'blocked';
  return r.pending === 'sent' || r.completed === 'sent' ? 'sent' : 'empty';
}

const touch = '[@media(pointer:coarse)]:min-h-11';
const linkClass = `inline-flex items-center font-semibold text-brand hover:underline ${touch}`;

/**
 * Settings → Daily email (1.22: one email each morning, in parts): on or off, the time it goes (in the
 * person's own time zone), each part on or off, and "Send me a test" (the real email, now). Only these
 * settings are saved here; the server keeps the rest as they are.
 */
export function DailyEmailSettings() {
  const qc = useQueryClient();
  const prefsQ = useQuery({ queryKey: PREFS_KEY, queryFn: () => notificationsApi(apiClient).getPreferences() });
  const configQ = useQuery({ queryKey: ['app-config'], queryFn: () => configApi(apiClient).get(), staleTime: Infinity, refetchOnWindowFocus: false });
  const { timeZone } = useDateSettings();
  // The server fills in every part; the defaults cover an answer without them.
  const daily: DailyEmailPrefs = { ...DEFAULTS, ...prefsQ.data?.dailyEmails };
  const on = anyOn(daily);
  const emailEnabled = configQ.data?.emailEnabled !== false;
  const [problem, setProblem] = useState<string | null>(null);
  const [testNote, setTestNote] = useState<{ ok: boolean; text: string } | null>(null);

  const save = useMutation({
    mutationFn: (next: DailyEmailPrefs) => notificationsApi(apiClient).setPreferences({ dailyEmails: next }),
    onMutate: async (next) => {
      setProblem(null);
      await qc.cancelQueries({ queryKey: PREFS_KEY });
      const prev = qc.getQueryData<NotificationPreferences>(PREFS_KEY);
      qc.setQueryData<NotificationPreferences>(PREFS_KEY, { muted: [], ...prev, dailyEmails: next });
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(PREFS_KEY, ctx.prev);
      setProblem(e instanceof ApiError && e.status === 400 && e.message ? e.message : 'Couldn’t save that change. Please try again.');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: PREFS_KEY }),
  });

  const test = useMutation({
    mutationFn: () => notificationsApi(apiClient).sendDailyTest(),
    onMutate: () => setTestNote(null),
    onSuccess: (r) => {
      const outcome = testOutcome(r);
      // A blocked address gets nothing, so it is a problem, not a "sent".
      if (outcome === 'blocked') setTestNote({ ok: false, text: BLOCKED });
      else if (outcome === 'sent') setTestNote({ ok: true, text: 'Sent your daily email as it is now. Check your inbox.' });
      else setTestNote({ ok: true, text: 'There’s nothing in your daily email right now, so no test was sent.' });
    },
    onError: (e) => setTestNote({ ok: false, text: e instanceof ApiError && e.message ? e.message : 'Couldn’t send the test. Check your connection and try again.' }),
  });

  return (
    <section id={DAILY_EMAIL_ANCHOR} className="card scroll-mt-20 p-5 lg:col-span-2" aria-labelledby="daily-emails-heading">
      <h2 id="daily-emails-heading" className="eyebrow mb-1">Daily email</h2>
      <p className="mb-4 text-sm text-ink-2">
        One email each morning with your day: the numbers, your schedule, what’s overdue or urgent, your tasks by project and what was
        completed. A part with nothing in it is left out, and with nothing in any part no email is sent.
      </p>
      {!emailEnabled ? (
        <p className="mb-4 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
          Email isn’t set up on this server yet, so this email can’t be sent. You can still choose what’s in it; it starts once an
          administrator sets up email.
        </p>
      ) : null}
      {problem ? <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{problem}</p> : null}
      <ul className="flex flex-col divide-y divide-line">
        <li className="flex items-center justify-between gap-4 py-3 first:pt-0">
          <div className="min-w-0">
            <div className="text-sm font-medium text-ink">Send me the daily email</div>
            <div className="text-xs text-ink-2">{on ? 'Every morning, with the parts turned on below.' : 'You get no daily email. Turn on any part to get it again.'}</div>
          </div>
          <Toggle on={on} onChange={() => save.mutate({ ...daily, ...allParts(!on) })} label="Daily email" disabled={prefsQ.isLoading} />
        </li>
        <li className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div className="min-w-0">
            <label htmlFor="daily-email-time" className="text-sm font-medium text-ink">Send it at</label>
            <div className="text-xs text-ink-2">
              In your time zone, {timeZone}.{' '}
              <a href="#time-zone" className={linkClass}>Change the time zone</a>
            </div>
          </div>
          {/* The site's own 24-hour list ("06:00"), as in the task and meeting forms — not the browser's "06:00 AM". */}
          <SearchableSelect
            id="daily-email-time"
            size="lg"
            className="w-[6.5rem] flex-none"
            ariaLabel={`Send it at: ${daily.time}`}
            options={timeOptions(daily.time)}
            value={daily.time}
            disabled={prefsQ.isLoading}
            onChange={(t) => t !== daily.time && save.mutate({ ...daily, time: t })}
            emptyText="No such time"
          />
        </li>
      </ul>
      <fieldset className="mt-2 border-t border-line pt-3">
        <legend className="sr-only">What’s in the daily email</legend>
        <div aria-hidden="true" className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-2">What’s in it</div>
        <ul className="flex flex-col divide-y divide-line">
          {PARTS.map((p) => (
            <li key={p.key} className="flex items-center justify-between gap-4 py-3 last:pb-0">
              <div className="min-w-0">
                <div className="text-sm font-medium text-ink">{p.label}</div>
                <div className="text-xs text-ink-2">{p.hint}</div>
              </div>
              <Toggle on={daily[p.key]} onChange={() => save.mutate({ ...daily, [p.key]: !daily[p.key] })} label={p.label} disabled={prefsQ.isLoading} />
            </li>
          ))}
        </ul>
      </fieldset>
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
        {emailEnabled ? (
          <button
            type="button"
            onClick={() => test.mutate()}
            disabled={test.isPending}
            className={`rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:border-brand/30 hover:bg-ground disabled:opacity-60 ${touch}`}
          >
            {test.isPending ? 'Sending…' : 'Send me a test'}
          </button>
        ) : null}
        <a href="#notifications" className={`text-sm ${linkClass}`}>Notification settings</a>
        {testNote ? (
          <p role={testNote.ok ? 'status' : 'alert'} className={`w-full text-sm ${testNote.ok ? 'text-ink-2' : 'text-danger'}`}>
            {testNote.text}
          </p>
        ) : null}
      </div>
    </section>
  );
}
