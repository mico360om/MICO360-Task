import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { dailyEmailsApi, type DailyEmailLogRow, type DailyEmailStatus } from '../../api/daily-emails';
import { todayKey } from '../../lib/due-date';
import { useCompanyTimeZone } from '../../lib/useCompanyTimeZone';
import { Badge, type BadgeTone } from '../ui/Badge';
import { LoadError } from '../ui/LoadError';

const STATUS: Record<DailyEmailStatus, { label: string; tone: BadgeTone }> = {
  SENT: { label: 'Sent', tone: 'success' },
  SKIPPED: { label: 'Skipped — nothing to send', tone: 'neutral' },
  RETRY: { label: 'Retrying', tone: 'warning' },
  FAILED: { label: 'Failed', tone: 'danger' },
  SENDING: { label: 'Sending', tone: 'info' },
};
const KIND: Record<DailyEmailLogRow['kind'], string> = { PENDING: 'Pending tasks', COMPLETED: 'Completed yesterday' };

/**
 * System Settings → Daily task emails: every morning email for a day — who it was for, which one, how
 * it went (sent, skipped because it had nothing in it, retrying, failed), how many tasks, attempts and
 * the last problem. Days are each person's own calendar day.
 */
export function DailyEmailLog() {
  const timeZone = useCompanyTimeZone();
  const [day, setDay] = useState(() => todayKey(timeZone));
  const [status, setStatus] = useState<DailyEmailStatus | ''>('');
  const q = useQuery({
    queryKey: ['daily-email-log', day, status],
    queryFn: () => dailyEmailsApi(apiClient).log({ day: day || undefined, status: status || undefined }),
  });
  const rows = Array.isArray(q.data?.data) ? q.data.data : [];
  // A status or email this page doesn't know yet (a newer server) is shown as it is.
  const statusOf = (s: string) => STATUS[s as DailyEmailStatus] ?? { label: s, tone: 'neutral' as BadgeTone };
  const clock = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }).format(new Date(iso)) : '—';

  return (
    <section className="card p-5 lg:col-span-2" aria-labelledby="daily-email-log-heading">
      <h2 id="daily-email-log-heading" className="eyebrow mb-1">Daily task emails</h2>
      <p className="mb-4 text-sm text-ink-2">
        The morning emails each person gets (pending tasks; tasks completed yesterday). A failed send is tried again after 5, 15 and 45
        minutes before it counts as failed.
      </p>
      {q.data?.meta?.emailEnabled === false ? (
        <p className="mb-4 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
          Email isn’t set up on this server, so no daily emails are being sent. Add the email (Mailjet) keys to the server’s settings to start them.
        </p>
      ) : null}
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
          Day
          <input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink outline-none focus:border-brand" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value as DailyEmailStatus | '')} className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink outline-none focus:border-brand">
            <option value="">All</option>
            <option value="SENT">Sent</option>
            <option value="SKIPPED">Skipped</option>
            <option value="RETRY">Retrying</option>
            <option value="FAILED">Failed</option>
            <option value="SENDING">Sending</option>
          </select>
        </label>
      </div>
      {q.isLoading ? (
        <p className="text-ink-2">Loading…</p>
      ) : q.isError ? (
        <LoadError what="the daily email log" onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        <p className="text-sm text-ink-2">No daily emails for this day{status ? ' with this status' : ''}.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table aria-label="Daily task emails" className="w-full min-w-[44rem] text-left text-sm">
            <thead className="bg-ground text-xs uppercase tracking-wide text-ink-2">
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold">Person</th>
                <th scope="col" className="px-3 py-2 font-semibold">Email</th>
                <th scope="col" className="px-3 py-2 font-semibold">Status</th>
                <th scope="col" className="px-3 py-2 font-semibold">Tasks</th>
                <th scope="col" className="px-3 py-2 font-semibold">Attempts</th>
                <th scope="col" className="px-3 py-2 font-semibold">Sent / next try</th>
                <th scope="col" className="px-3 py-2 font-semibold">Problem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="px-3 py-2">
                    <span dir="auto" className="block font-medium text-ink">{r.userName}</span>
                    <span className="block text-xs text-ink-3">{r.email}</span>
                  </td>
                  <td className="px-3 py-2 text-ink">{KIND[r.kind] ?? r.kind}</td>
                  <td className="px-3 py-2"><Badge tone={statusOf(r.status).tone}>{statusOf(r.status).label}</Badge></td>
                  <td className="px-3 py-2 tabular-nums text-ink">{r.taskCount}</td>
                  <td className="px-3 py-2 text-ink">{r.attempts === 1 ? '1 attempt' : `${r.attempts} attempts`}</td>
                  <td className="px-3 py-2 text-ink-2">{r.status === 'RETRY' ? `Next ${clock(r.nextAttemptAt)}` : clock(r.sentAt)}</td>
                  <td dir="auto" className="max-w-[16rem] break-words px-3 py-2 text-xs text-danger">{r.lastError ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
