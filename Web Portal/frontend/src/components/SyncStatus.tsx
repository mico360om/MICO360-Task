import { useEffect, useRef, useState } from 'react';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { describeChange, discardChange, failedChanges, flushOfflineQueue, pendingCount, retryChange } from '../lib/offline-replay';
import type { QueuedMutation } from '../lib/offline-queue';
import { invalidateTaskQueries } from '../lib/task-cache';

/** Relative "N ago" label for a timestamp (recomputed on a tick). */
function rel(ms: number | null, nowMs: number): string {
  if (ms == null) return 'not yet';
  const s = Math.round((nowMs - ms) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

/**
 * Header sync indicator (Epic C): shows whether data is refreshing and when it last synced,
 * and offers a manual "Sync now" (refetch everything) — the web equivalent of the extension's
 * connection footer and the mobile Sync status. Freshness is derived from react-query's global
 * fetching state, so it reflects real background refetches and realtime-triggered reloads.
 * Offline changes that could not be synced are listed for the user to retry or discard.
 */
export function SyncStatus() {
  const fetching = useIsFetching();
  const qc = useQueryClient();
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [pending, setPending] = useState(() => pendingCount());
  const [failed, setFailed] = useState<QueuedMutation[]>(() => failedChanges());
  const [reviewOpen, setReviewOpen] = useState(false);
  const wasFetching = useRef(false);

  const refreshCounts = () => {
    setPending(pendingCount());
    setFailed(failedChanges());
  };

  useEffect(() => {
    if (fetching > 0) wasFetching.current = true;
    else if (wasFetching.current) {
      wasFetching.current = false;
      setLastSync(Date.now());
    }
  }, [fetching]);

  useEffect(() => {
    const id = setInterval(() => {
      setNowMs(Date.now());
      refreshCounts();
    }, 5000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (failed.length === 0) setReviewOpen(false);
  }, [failed.length]);

  async function syncNow() {
    const res = await flushOfflineQueue(); // replay anything queued while offline first
    refreshCounts();
    if (res.synced > 0) void invalidateTaskQueries(qc);
    await qc.invalidateQueries();
  }

  async function retry(id: string) {
    retryChange(id);
    await syncNow();
  }
  function discard(id: string) {
    discardChange(id);
    refreshCounts();
  }

  const syncing = fetching > 0;
  const dot = syncing ? 'animate-pulse bg-warning' : pending > 0 ? 'bg-warning' : 'bg-success';
  const label = syncing ? 'Syncing…' : pending > 0 ? `${pending} queued` : `Synced ${rel(lastSync, nowMs)}`;
  return (
    <div className="relative hidden items-center gap-1.5 md:inline-flex">
      <button
        onClick={() => void syncNow()}
        aria-label="Sync now"
        title={
          pending > 0
            ? `${pending} change${pending === 1 ? '' : 's'} waiting to sync — click to sync now`
            : syncing
              ? 'Syncing…'
              : `Last synced ${rel(lastSync, nowMs)} — click to sync now`
        }
        className="inline-flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-2 transition-all hover:-translate-y-0.5 hover:border-brand/30 hover:bg-ground"
      >
        <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden="true" />
        <span>{label}</span>
      </button>

      {failed.length > 0 ? (
        <button
          onClick={() => setReviewOpen((o) => !o)}
          aria-expanded={reviewOpen}
          className="rounded-lg border border-danger/30 bg-danger-soft px-2 py-1.5 text-xs font-semibold text-danger"
        >
          {failed.length} not synced
        </button>
      ) : null}

      {reviewOpen && failed.length > 0 ? (
        <div role="dialog" aria-label="Changes that could not be synced" className="absolute right-0 top-full z-40 mt-2 w-80 rounded-xl border border-line bg-surface p-3 shadow-lift">
          <p className="mb-2 text-xs text-ink-2">These offline changes couldn’t be saved. Retry them, or discard them.</p>
          <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto">
            {failed.map((m) => (
              <li key={m.id} className="rounded-lg border border-line p-2 text-xs">
                <p dir="auto" className="font-medium text-ink">{describeChange(m)}</p>
                {m.lastError ? <p dir="auto" className="mt-0.5 text-danger">{m.lastError}</p> : null}
                <div className="mt-1.5 flex gap-2">
                  <button onClick={() => void retry(m.id)} className="rounded-md border border-line px-2 py-0.5 font-medium text-brand hover:border-brand">
                    Retry
                  </button>
                  <button onClick={() => discard(m.id)} className="rounded-md px-2 py-0.5 font-medium text-ink-2 hover:bg-ground hover:text-danger">
                    Discard
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
