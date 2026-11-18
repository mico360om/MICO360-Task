import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { appreciationsApi } from '../api/appreciations';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { LoadError } from '../components/ui/LoadError';
import { AppreciationIconSvg } from '../components/appreciation/AppreciationArt';
import { dayWords, STATUS_TONE, STATUS_WORDS, themeGradient } from '../lib/appreciation';
import { useCompanyTimeZone } from '../lib/company-clock';

const api = appreciationsApi(apiClient);

/** "18 Nov 2026, 09:14" in the company time zone. */
export function acceptedWords(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString('en-GB', { timeZone, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/**
 * Employee Appreciation (1.24.0): My appreciations (account menu) — every appreciation whose day has come, newest
 * first, with its message, day and when it was accepted.
 */
export function MyAppreciationsPage() {
  const timeZone = useCompanyTimeZone();
  const q = useQuery({ queryKey: ['appreciations', 'mine'], queryFn: () => api.history() });
  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="Account" title="My appreciations" subtitle="Thank-yous from your company, newest first." />
      {q.isError ? (
        <LoadError what="your appreciations" onRetry={() => void q.refetch()} />
      ) : q.isPending ? (
        <div role="status" aria-label="Loading your appreciations" className="flex flex-col gap-3">
          {[0, 1].map((i) => (
            <div key={i} className="skeleton h-28 rounded-2xl" />
          ))}
        </div>
      ) : q.data.length === 0 ? (
        <EmptyState titleAs="h2" title="No appreciations yet" description="When your company appreciates your work, it will be listed here." />
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Your appreciations">
          {q.data.map((a) => (
            <li key={a.id} className="card flex gap-4 p-4" data-my-appreciation={a.id}>
              <span className="grid h-11 w-11 flex-none place-items-center rounded-xl text-white" style={{ backgroundImage: themeGradient(a.theme) }}>
                <AppreciationIconSvg icon={a.icon} size={22} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <h2 dir="auto" className="font-display text-base font-semibold text-ink">{a.title}</h2>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[a.status]}`}>{STATUS_WORDS[a.status]}</span>
                </div>
                <p dir="auto" className="mt-1 whitespace-pre-line text-sm text-ink">{a.message}</p>
                <p className="mt-1.5 text-xs text-ink-2">
                  {dayWords(a.day)} · from <bdi className="font-medium text-ink">{a.sender.name}</bdi> · <bdi>{a.company.name}</bdi>
                  {a.acceptedAt ? <> · Accepted {acceptedWords(a.acceptedAt, timeZone)}</> : null}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
