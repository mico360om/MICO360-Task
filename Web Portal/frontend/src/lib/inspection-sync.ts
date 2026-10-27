import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { inspectionsApi } from '../api/inspections';
import { useAuthStore } from '../stores/auth-store';
import { createInspectionOutbox, localDraftStorage, type DraftView, type FlushState, type InspectionOutbox } from './inspection-outbox';

/**
 * The app's one inspection outbox (see inspection-outbox), and the hooks the pages use. Waiting
 * changes are sent a moment after they are made, when the browser comes back online, when the tab
 * is shown again, every 20 seconds while something waits, and after signing in again.
 */
export const inspectionOutbox: InspectionOutbox = createInspectionOutbox({ storage: localDraftStorage, api: inspectionsApi(apiClient) });

// Another tab changed a record: tell this tab's pages.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (!e.key || e.key.startsWith('mico360.inspection.')) inspectionOutbox.changedElsewhere();
  });
}

let version = 0;
inspectionOutbox.subscribe(() => {
  version += 1;
});
const subscribe = (cb: () => void) => inspectionOutbox.subscribe(cb);
const getVersion = () => version;

/** The query keys an inspection's change touches. */
export function refreshInspectionQueries(qc: QueryClient, inspectionId: string, projectId?: string | null): void {
  void qc.invalidateQueries({ queryKey: ['inspection', inspectionId] });
  if (projectId) void qc.invalidateQueries({ queryKey: ['project-inspections', projectId] });
  void qc.invalidateQueries({ queryKey: ['task-inspections'] });
}

export type SyncState = 'idle' | 'sending' | FlushState;

const SEND_DELAY_MS = 400;
const RETRY_EVERY_MS = 20_000;

/**
 * One inspection's record on this device, and sending it. `view` is null until the inspection has
 * been read once (or after it was finished and nothing waits).
 */
export function useInspectionDraft(inspectionId: string | undefined) {
  const ownerId = useAuthStore((s) => s.user?.id ?? null);
  const qc = useQueryClient();
  const v = useSyncExternalStore(subscribe, getVersion, getVersion);
  const view: DraftView | null = useMemo(() => (ownerId && inspectionId ? inspectionOutbox.view(ownerId, inspectionId) : null), [ownerId, inspectionId, v]);
  const [sync, setSync] = useState<SyncState>('idle');
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Sends what waits; `force` tries at once even while waiting after a failure (back online, "Try now"). */
  const send = useCallback(
    async (opts: { force?: boolean } = {}): Promise<FlushState> => {
      if (!ownerId || !inspectionId) return 'sent';
      const before = inspectionOutbox.view(ownerId, inspectionId);
      const waitingAfterFailure = !opts.force && !!before?.retryAt && Date.parse(before.retryAt) > Date.now();
      if (!waitingAfterFailure) setSync('sending');
      const { state } = await inspectionOutbox.flush(ownerId, inspectionId, opts);
      setSync(state === 'sent' ? 'idle' : state);
      // No signal is the device's; a server that can't be reached or is in trouble isn't.
      if (state === 'offline') setOnline(false);
      else if (state !== 'unreachable' && state !== 'retry') setOnline(true);
      if (state === 'sent' || state === 'problem') refreshInspectionQueries(qc, inspectionId, before?.projectId);
      return state;
    },
    [ownerId, inspectionId, qc],
  );

  const sendSoon = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void send(), SEND_DELAY_MS);
  }, [send]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // Back online, shown again, or something still waits: try again.
  const waiting = !!view && !view.problem && (view.pending.answers > 0 || view.pending.finish || view.pending.followUps > 0);
  useEffect(() => {
    const goOnline = () => {
      setOnline(true);
      void send({ force: true });
    };
    const goOffline = () => setOnline(false);
    const shown = () => document.visibilityState === 'visible' && void send();
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    document.addEventListener('visibilitychange', shown);
    const every = waiting ? setInterval(() => void send(), RETRY_EVERY_MS) : null;
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      document.removeEventListener('visibilitychange', shown);
      if (every) clearInterval(every);
    };
  }, [send, waiting]);

  return { ownerId, view, sync, online, send, sendSoon, outbox: inspectionOutbox };
}

/** The signed-in person's inspections with something waiting on this device (and a problem to look at). */
export function useWaitingInspections() {
  const ownerId = useAuthStore((s) => s.user?.id ?? null);
  const v = useSyncExternalStore(subscribe, getVersion, getVersion);
  return useMemo(() => (ownerId ? inspectionOutbox.waiting(ownerId) : []), [ownerId, v]);
}

/**
 * Sends every inspection change waiting on this device — on load, back online, shown again, and
 * whenever someone signs in (a session that ended offline: their changes go once they are back).
 */
export function useInspectionOutboxSync(): void {
  const ownerId = useAuthStore((s) => s.user?.id ?? null);
  const qc = useQueryClient();
  useEffect(() => {
    if (!ownerId) return;
    let stopped = false;
    const flush = async (force = false) => {
      if (stopped || (typeof navigator !== 'undefined' && !navigator.onLine)) return;
      const before = inspectionOutbox.waiting(ownerId);
      if (!before.length) return;
      const r = await inspectionOutbox.flushAll(ownerId, { force });
      if (r.sent > 0) for (const w of before) refreshInspectionQueries(qc, w.inspectionId, w.projectId);
    };
    const shown = () => document.visibilityState === 'visible' && void flush();
    const backOnline = () => void flush(true);
    void flush();
    window.addEventListener('online', backOnline);
    document.addEventListener('visibilitychange', shown);
    const every = setInterval(() => void flush(), 60_000);
    return () => {
      stopped = true;
      window.removeEventListener('online', backOnline);
      document.removeEventListener('visibilitychange', shown);
      clearInterval(every);
    };
  }, [ownerId, qc]);
}
