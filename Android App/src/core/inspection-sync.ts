import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import type { QueryClient } from '@tanstack/react-query';
import { useServices, useUserId } from './providers';
import { useOnline } from './chat';
import type { StorageProblem } from '../lib/draft-storage';
import type { DraftView, FlushState, InspectionOutbox, WaitingInspection } from '../lib/inspection-outbox';
import { FLUSH_ALL_EVERY_MS, RETRY_EVERY_MS, SEND_DELAY_MS, type SyncState } from '../lib/inspection-outboxes';
import { keptRows, type KeptRow } from '../lib/on-this-phone';

/**
 * The website's inspection hooks (`lib/inspection-sync.ts`) for the phone: the screens read the
 * signed-in person's outbox, and what waits is sent a moment after it is made, when the phone is
 * back online, when the app is in front again, every 20 s while something waits on the screen, and
 * every minute (and after signing in) in the background.
 */
export { FLUSH_ALL_EVERY_MS, RETRY_EVERY_MS, SEND_DELAY_MS };

/** The query keys an inspection's change touches. */
export function refreshInspectionQueries(qc: QueryClient, inspectionId: string, projectId?: string | null): void {
  void qc.invalidateQueries({ queryKey: ['inspection', inspectionId] });
  if (projectId) void qc.invalidateQueries({ queryKey: ['project-inspections', projectId] });
  void qc.invalidateQueries({ queryKey: ['task-inspections'] });
}

/** The storage's own change counter (a refused write is heard through it). */
const storageVersion = { n: 0 };

/** A change counter per outbox, so `useSyncExternalStore` sees each change. */
const versions = new WeakMap<InspectionOutbox, { n: number }>();
function versionOf(outbox: InspectionOutbox): { n: number } {
  let v = versions.get(outbox);
  if (!v) {
    const counter = { n: 0 };
    outbox.subscribe(() => {
      counter.n += 1;
    });
    versions.set(outbox, counter);
    v = counter;
  }
  return v;
}

/** The signed-in person's outbox (null when nobody is), its change counter and whether the phone's records are read. */
function useOutbox(): { ownerId: string | null; outbox: InspectionOutbox | null; ready: boolean; version: number } {
  const { inspections } = useServices();
  const ownerId = useUserId();
  const outbox = useMemo(() => (ownerId ? inspections.outboxFor(ownerId) : null), [inspections, ownerId]);
  const [ready, setReady] = useState(inspections.isReady());
  useEffect(() => {
    let live = true;
    void inspections.ready.then(() => live && setReady(true));
    return () => {
      live = false;
    };
  }, [inspections]);
  // The outbox's changes, and the storage's (a write it refused later — Final I2).
  const subscribe = useCallback(
    (cb: () => void) => {
      const stopOutbox = outbox ? outbox.subscribe(cb) : () => undefined;
      const stopStorage = inspections.storage.subscribe(() => {
        storageVersion.n += 1;
        cb();
      });
      return () => {
        stopOutbox();
        stopStorage();
      };
    },
    [outbox, inspections],
  );
  const snapshot = useCallback(() => (outbox ? versionOf(outbox).n : 0) * 1_000_003 + storageVersion.n, [outbox]);
  const version = useSyncExternalStore(subscribe, snapshot, snapshot);
  return { ownerId, outbox, ready, version };
}

/**
 * One inspection's record on this phone, and sending it. `view` is null until the inspection has
 * been read once (or after it was finished and nothing waits).
 */
export function useInspectionDraft(inspectionId: string | undefined): {
  ownerId: string | null;
  ready: boolean;
  view: DraftView | null;
  /** Why the changes are only in the app (too big, or the storage full) — the banner's words. */
  storageProblem: StorageProblem | null;
  sync: SyncState;
  online: boolean;
  send(opts?: { force?: boolean }): Promise<FlushState>;
  sendSoon(): void;
  outbox: InspectionOutbox | null;
} {
  const { queryClient: qc, connectivity, inspections } = useServices();
  const { ownerId, outbox, ready, version } = useOutbox();
  const online = useOnline();
  const view = useMemo(
    () => (ready && outbox && ownerId && inspectionId ? outbox.view(ownerId, inspectionId) : null),
    // `version` changes with every change of the record.
    [ready, outbox, ownerId, inspectionId, version],
  );
  const [sync, setSync] = useState<SyncState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Sends what waits; `force` tries at once even while waiting after a failure (back online, "Try now"). */
  const send = useCallback(
    async (opts: { force?: boolean } = {}): Promise<FlushState> => {
      if (!outbox || !ownerId || !inspectionId) return 'sent';
      const before = outbox.view(ownerId, inspectionId);
      const waitingAfterFailure = !opts.force && !!before?.retryAt && Date.parse(before.retryAt) > Date.now();
      if (!waitingAfterFailure) setSync('sending');
      const { state } = await outbox.flush(ownerId, inspectionId, opts);
      setSync(state === 'sent' ? 'idle' : state);
      if (state === 'sent' || state === 'problem') refreshInspectionQueries(qc, inspectionId, before?.projectId);
      return state;
    },
    [outbox, ownerId, inspectionId, qc],
  );

  const sendSoon = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void send(), SEND_DELAY_MS);
  }, [send]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // Back online, in front again, or something still waits: try again.
  const waiting = !!view && !view.problem && (view.pending.answers > 0 || view.pending.finish || view.pending.followUps > 0);
  useEffect(() => {
    const stopOnline = connectivity.subscribe((isOnline) => {
      if (isOnline) void send({ force: true });
    });
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void send();
    });
    const every = waiting ? setInterval(() => void send(), RETRY_EVERY_MS) : null;
    return () => {
      stopOnline();
      sub.remove();
      if (every) clearInterval(every);
    };
  }, [connectivity, send, waiting]);

  const storageProblem = view && !view.persisted && ownerId && inspectionId ? inspections.storageProblem(ownerId, inspectionId) : null;
  return { ownerId, ready, view, storageProblem, sync, online, send, sendSoon, outbox };
}

/** The signed-in person's inspections with something waiting on this phone (or a problem to look at). */
export function useWaitingInspections(): WaitingInspection[] {
  const { ownerId, outbox, ready, version } = useOutbox();
  return useMemo(
    () => (ready && outbox && ownerId ? outbox.waiting(ownerId) : []),
    // `version` changes with every change of a record.
    [ready, outbox, ownerId, version],
  );
}

/**
 * "Waiting on this phone" (lib/on-this-phone): the signed-in person's inspections with changes waiting
 * or kept unfinished here, of one project when given — from the phone's records, so it works offline.
 */
export function useKeptInspections(projectId?: string): KeptRow[] {
  const { inspections } = useServices();
  const { ownerId, outbox, ready, version } = useOutbox();
  return useMemo(
    () => (ready && outbox && ownerId ? keptRows(inspections.kept(ownerId), projectId) : []),
    // `version` changes with every change of a record.
    [ready, outbox, ownerId, version, inspections, projectId],
  );
}

/**
 * Sends every inspection change waiting on this phone for the signed-in person — at once (the app
 * started, or they signed in: a session that ended offline sends once they are back), back online,
 * in front again and every minute. Mounted once, beside the offline queue's own sync.
 */
export function useInspectionOutboxSync(): void {
  const { inspections, connectivity, queryClient: qc } = useServices();
  const ownerId = useUserId();
  useEffect(() => {
    if (!ownerId) return;
    let stopped = false;
    const flush = async (force = false) => {
      await inspections.ready;
      if (stopped) return;
      const outbox = inspections.outboxFor(ownerId);
      const before = outbox.waiting(ownerId);
      if (!before.length) return;
      const r = await outbox.flushAll(ownerId, { force });
      if (r.sent > 0) for (const w of before) refreshInspectionQueries(qc, w.inspectionId, w.projectId);
    };
    void flush();
    const stopOnline = connectivity.subscribe((isOnline) => {
      if (isOnline) void flush(true);
    });
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void flush();
    });
    const every = setInterval(() => void flush(), FLUSH_ALL_EVERY_MS);
    return () => {
      stopped = true;
      stopOnline();
      sub.remove();
      clearInterval(every);
    };
  }, [ownerId, inspections, connectivity, qc]);
}
