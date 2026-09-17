import { useEffect, useRef, useState } from 'react';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { flushOfflineQueue, pendingCount } from '../lib/offline-replay';

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
 */
export function SyncStatus() {
  const fetching = useIsFetching();
  const qc = useQueryClient();
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [pending, setPending] = useState(() => pendingCount());
  const wasFetching = useRef(false);

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
      setPending(pendingCount());
    }, 5000);
    return () => clearInterval(id);
  }, []);

  async function syncNow() {
    await flushOfflineQueue(); // replay anything queued while offline first
    setPending(pendingCount());
    await qc.invalidateQueries();
  }

  const syncing = fetching > 0;
  const dot = syncing ? 'animate-pulse bg-warning' : pending > 0 ? 'bg-warning' : 'bg-success';
  const label = syncing ? 'Syncing…' : pending > 0 ? `${pending} queued` : `Synced ${rel(lastSync, nowMs)}`;
  return (
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
      className="hidden items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-2 transition-all hover:-translate-y-0.5 hover:border-brand/30 hover:bg-ground md:inline-flex"
    >
      <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}
