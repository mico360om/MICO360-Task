import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { configApi } from '../../api/config';
import { notificationsApi, type DailyEmailPrefs, type DailyEmailTestResult, type NotificationPreferences } from '../../api/notifications';
import { ApiError } from '../../lib/api-client';
import { Toggle } from '../ui/Toggle';

const DEFAULTS: DailyEmailPrefs = { pending: true, completed: true, time: '06:00' };
const PREFS_KEY = ['notification-prefs'];

const BLOCKED = 'Not sent: your email address is blocked after a bounce or spam complaint. Ask an administrator to check it.';

/** What a test sent, in words: an email with nothing in it isn't sent. */
function testSummary(r: DailyEmailTestResult): string {
  const sent = [r.pending === 'sent' ? 'pending tasks' : null, r.completed === 'sent' ? 'completed tasks' : null].filter(Boolean);
  const parts: string[] = [];
  if (sent.length === 2) parts.push('Sent both emails: pending tasks and completed tasks.');
  else if (sent.length === 1) parts.push(`Sent the ${sent[0]} email.`);
  if (r.pending === 'empty') parts.push('You have no pending tasks, so there was no pending tasks email to send.');
  if (r.completed === 'empty') parts.push('Nothing was completed yesterday, so there was no completed tasks email to send.');
  return parts.join(' ');
}

/**
 * Settings → Daily task emails: the two morning emails (pending tasks; tasks completed yesterday),
 * each on or off, and the time they go (in the person's own time zone). "Send me a test now" sends
 * them at once. Only these settings are saved here; the server keeps the rest as they are.
 */
export function DailyEmailSettings() {
  const qc = useQueryClient();
  const prefsQ = useQuery({ queryKey: PREFS_KEY, queryFn: () => notificationsApi(apiClient).getPreferences() });
  const configQ = useQuery({ queryKey: ['app-config'], queryFn: () => configApi(apiClient).get(), staleTime: Infinity, refetchOnWindowFocus: false });
  const daily = prefsQ.data?.dailyEmails ?? DEFAULTS;
  const emailEnabled = configQ.data?.emailEnabled !== false;
  const [time, setTime] = useState(daily.time);
  const [problem, setProblem] = useState<string | null>(null);
  const [testNote, setTestNote] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => setTime(daily.time), [daily.time]);

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
    // A blocked address gets neither email, so it is a problem, not a "sent".
    onSuccess: (r) => setTestNote(r.pending === 'blocked' || r.completed === 'blocked' ? { ok: false, text: BLOCKED } : { ok: true, text: testSummary(r) }),
    onError: (e) => setTestNote({ ok: false, text: e instanceof ApiError && e.message ? e.message : 'Couldn’t send the test. Check your connection and try again.' }),
  });

  const saveTime = () => {
    if (time === daily.time) return;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      setTime(daily.time);
      setProblem('Choose a time, for example 06:00.');
      return;
    }
    save.mutate({ ...daily, time });
  };

  return (
    <section className="card p-5 lg:col-span-2" aria-labelledby="daily-emails-heading">
      <h2 id="daily-emails-heading" className="eyebrow mb-1">Daily task emails</h2>
      <p className="mb-4 text-sm text-ink-2">
        Two emails each morning: the tasks assigned to you that aren’t done yet, and your tasks completed the day before. An email with
        nothing in it isn’t sent.
      </p>
      {!emailEnabled ? (
        <p className="mb-4 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
          Email isn’t set up on this server yet, so these emails can’t be sent. You can still choose them; they start once an administrator
          sets up email.
        </p>
      ) : null}
      {problem ? <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{problem}</p> : null}
      <ul className="flex flex-col divide-y divide-line">
        <li className="flex items-center justify-between gap-4 py-3 first:pt-0">
          <div className="min-w-0">
            <div className="text-sm font-medium text-ink">Pending tasks</div>
            <div className="text-xs text-ink-2">Overdue, due today, upcoming and undated — with priority, status and a link to each.</div>
          </div>
          <Toggle on={daily.pending} onChange={() => save.mutate({ ...daily, pending: !daily.pending })} label="Pending tasks email" disabled={prefsQ.isLoading} />
        </li>
        <li className="flex items-center justify-between gap-4 py-3">
          <div className="min-w-0">
            <div className="text-sm font-medium text-ink">Completed yesterday</div>
            <div className="text-xs text-ink-2">Your tasks that were completed the day before, and whether they were on time.</div>
          </div>
          <Toggle on={daily.completed} onChange={() => save.mutate({ ...daily, completed: !daily.completed })} label="Completed yesterday email" disabled={prefsQ.isLoading} />
        </li>
        <li className="flex flex-wrap items-center justify-between gap-3 py-3 last:pb-0">
          <div className="min-w-0">
            <label htmlFor="daily-email-time" className="text-sm font-medium text-ink">Send them at</label>
            <div className="text-xs text-ink-2">In your time zone (see Calendar &amp; dates below).</div>
          </div>
          <input
            id="daily-email-time"
            type="time"
            step={60}
            value={time}
            disabled={prefsQ.isLoading}
            onChange={(e) => setTime(e.target.value)}
            onBlur={saveTime}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveTime();
            }}
            className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
        </li>
      </ul>
      {emailEnabled ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <button
            type="button"
            onClick={() => test.mutate()}
            disabled={test.isPending}
            className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:border-brand/30 hover:bg-ground disabled:opacity-60"
          >
            {test.isPending ? 'Sending…' : 'Send me a test now'}
          </button>
          {testNote ? (
            <p role={testNote.ok ? 'status' : 'alert'} className={`text-sm ${testNote.ok ? 'text-ink-2' : 'text-danger'}`}>
              {testNote.text}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
