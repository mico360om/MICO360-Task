import type { ApiClient } from './api-client';
import { INSPECTION_RECORD_PREFIX, createMirroredDraftStorage, type MirroredDraftStorage, type StorageProblem } from './draft-storage';
import { createInspectionOutbox, removeOwnerRecords, type FlushState, type InspectionOutbox } from './inspection-outbox';
import { inspectionsApi } from './inspections-api';
import type { KeyValueStore } from './storage';

/**
 * The phone's inspection outboxes (Stage 4): one per person who signed in on it, over one store of
 * records kept on the phone. A person's outbox sends only with that person's session
 * (`api.forUser`): on a shared phone, someone else signed in never sees, counts or sends them, and
 * they go when the same person signs in again. It stays apart from the app's offline queue, as the
 * website keeps it apart from its own: its conflict rules (edit times, what the signers saw, one
 * finish per id) are not those of a queue of requests.
 */

/** The website's timings (`lib/inspection-sync.ts`): a change goes 400 ms after it is made… */
export const SEND_DELAY_MS = 400;
/** …is tried again every 20 s while something waits on the screen… */
export const RETRY_EVERY_MS = 20_000;
/** …and everything waiting is sent every minute in the background. */
export const FLUSH_ALL_EVERY_MS = 60_000;

/** What the inspection screen says about sending: idle, sending, or how the last send ended. */
export type SyncState = 'idle' | 'sending' | FlushState;

export interface InspectionOutboxes {
  storage: MirroredDraftStorage;
  /** The records kept on the phone have been read (the screens wait for it). */
  ready: Promise<void>;
  isReady(): boolean;
  /** One person's outbox on this server: its methods take the person's id (the record is named for the server too). */
  outboxFor(ownerId: string): InspectionOutbox;
  /** The owner a record is kept under: the person, on this server (Final I6). */
  ownerKey(ownerId: string): string;
  /** The phone's key of one person's record of one inspection on this server. */
  recordKey(ownerId: string, inspectionId: string): string;
  /** The person's changes not sent yet: answers, follow-up requests and a waiting finish (the sign-out question). */
  unsentCount(ownerId: string | null | undefined): number;
  /** The same, once the phone's records are read (before that the count would say 0 — Final I4). */
  unsentCountWhenReady(ownerId: string | null | undefined): Promise<number>;
  /** Why a person's record of an inspection is only in the app (too big, or the storage full / refused it). */
  storageProblem(ownerId: string, inspectionId: string): StorageProblem | null;
  /** Signing out on purpose: the person's records go, on the phone and in the app. */
  clearOwner(ownerId: string): Promise<void>;
}

/** The server's site (scheme and host), from its API address — without URL (React Native's is partial). */
function siteOf(server: string): string {
  const m = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]+/i.exec(server.trim());
  return (m ? m[0] : server.trim()).toLowerCase();
}

/** A short, stable name for a server, without dots (the record key's parts are split by dots). */
function serverScope(server: string): string {
  const site = siteOf(server);
  let h = 0x811c9dc5;
  for (let i = 0; i < site.length; i++) {
    h ^= site.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** How long signing out waits for a send on its way before it removes the records anyway. */
export const CLEAR_WAIT_MS = 25_000;

/** One person's outbox on this server, and what signing out needs of it. */
interface ScopedOutbox {
  outbox: InspectionOutbox;
  /** No more sends (signing out): every send answers 'signed-out' until `resume`. */
  stop(): void;
  resume(): void;
  /** The sends on their way now. */
  inFlight(): Promise<unknown>[];
}

/**
 * The website's outbox as one person's on this server: each method takes the person's id and works
 * on the records kept under `owner(person)`, so a record made for another server (or one in the old
 * shape, before records named their server) is never shown, counted or sent here — it is kept.
 *
 * It also knows the sends on their way (Final I5): the website's finish writes its record back when
 * its answer comes (`read() ?? d`), so a record thrown away meanwhile is thrown away again once
 * that send ends, and signing out stops new sends and waits for those on their way.
 */
function scopedOutbox(inner: InspectionOutbox, owner: (person: string) => string, storage: MirroredDraftStorage): ScopedOutbox {
  const flights = new Map<string, Promise<{ state: FlushState }>>();
  let stopped = false;
  /**
   * Kept on the phone only when the phone took it (Final I2): the outbox knows a write refused at
   * once; one AsyncStorage refuses later is the storage's to say.
   */
  const onPhone = (o: string, id: string) => !storage.unwritten().includes(`${INSPECTION_RECORD_PREFIX}${owner(o)}.${id}`);

  const flush: InspectionOutbox['flush'] = (o, id, opts) => {
    if (stopped) return Promise.resolve({ state: 'signed-out' });
    const p = inner.flush(owner(o), id, opts);
    if (flights.get(id) !== p) {
      flights.set(id, p);
      p.finally(() => {
        if (flights.get(id) === p) flights.delete(id);
      }).catch(() => undefined);
    }
    return p;
  };

  const outbox: InspectionOutbox = {
    subscribe: (listener) => inner.subscribe(listener),
    changedElsewhere: () => inner.changedElsewhere(),
    draft: (o, id) => inner.draft(owner(o), id),
    view: (o, id) => {
      const v = inner.view(owner(o), id);
      return v && v.persisted && !onPhone(o, id) ? { ...v, persisted: false } : v;
    },
    remember: (o, detail) => inner.remember(owner(o), detail),
    saveAnswer: (o, id, value) => inner.saveAnswer(owner(o), id, value),
    queueFinish: (o, id, signatures) => inner.queueFinish(owner(o), id, signatures),
    cancelFinish: (o, id) => inner.cancelFinish(owner(o), id),
    queueFollowUps: (o, id, itemIds, assigneeId, detail) => inner.queueFollowUps(owner(o), id, itemIds, assigneeId, detail),
    clearProblem: (o, id) => inner.clearProblem(owner(o), id),
    forgetUnsaved: (o) => inner.forgetUnsaved(owner(o)),
    discard: (o, id) => {
      inner.discard(owner(o), id);
      const going = flights.get(id);
      if (going) void going.then(() => inner.discard(owner(o), id), () => inner.discard(owner(o), id));
    },
    ackFinished: (o, id) => inner.ackFinished(owner(o), id),
    ackFollowUpReport: (o, id) => inner.ackFollowUpReport(owner(o), id),
    flush,
    waiting: (o) => inner.waiting(owner(o)).map((w) => (w.persisted && !onPhone(o, w.inspectionId) ? { ...w, persisted: false } : w)),
    // The website's flushAll, through this flush (so its sends are known, and stop when signing out).
    async flushAll(o, opts = {}) {
      let sent = 0;
      for (const w of inner.waiting(owner(o))) {
        if (w.problem?.stage === 'answers') continue;
        const r = await flush(o, w.inspectionId, opts);
        if (r.state === 'sent') sent += 1;
        if (r.state === 'offline' || r.state === 'unreachable' || r.state === 'signed-out') break;
      }
      return { sent, waiting: inner.waiting(owner(o)).length };
    },
  };

  return {
    outbox,
    stop: () => {
      stopped = true;
    },
    resume: () => {
      stopped = false;
    },
    inFlight: () => [...flights.values()],
  };
}

export function createInspectionOutboxes(deps: {
  store: KeyValueStore;
  api: Pick<ApiClient, 'forUser'>;
  /** The server the app is connected to (its API address): records are kept per server. */
  server: string;
  /** The storage's limits (tests). */
  limits?: { recordMax?: number; allMax?: number };
  /** A record on the phone that couldn't be read back, removed (dev logs). */
  onDroppedRecord?: (key: string, why: string) => void;
  now?: () => Date;
  newId?: () => string;
}): InspectionOutboxes {
  const storage = createMirroredDraftStorage(deps.store, { ...deps.limits, ...(deps.onDroppedRecord ? { onDropped: deps.onDroppedRecord } : {}) });
  const ready = storage.hydrate();
  const outboxes = new Map<string, ScopedOutbox>();
  const scope = serverScope(deps.server);
  const ownerKey = (ownerId: string) => `${ownerId}~${scope}`;

  function scoped(ownerId: string): ScopedOutbox {
    let o = outboxes.get(ownerId);
    if (!o) {
      const inner = createInspectionOutbox({ storage, api: inspectionsApi(deps.api.forUser(ownerId)), ...(deps.now ? { now: deps.now } : {}), ...(deps.newId ? { newId: deps.newId } : {}) });
      o = scopedOutbox(inner, ownerKey, storage);
      outboxes.set(ownerId, o);
    }
    return o;
  }
  const outboxFor = (ownerId: string): InspectionOutbox => scoped(ownerId).outbox;
  const unsentCount = (ownerId: string | null | undefined): number => {
    if (!ownerId) return 0;
    return outboxFor(ownerId)
      .waiting(ownerId)
      .reduce((n, w) => n + w.pending.answers + w.pending.followUps + (w.pending.finish ? 1 : 0), 0);
  };

  return {
    storage,
    ready,
    isReady: () => storage.isHydrated(),
    outboxFor,
    ownerKey,
    recordKey: (ownerId, inspectionId) => `${INSPECTION_RECORD_PREFIX}${ownerKey(ownerId)}.${inspectionId}`,
    unsentCount,
    async unsentCountWhenReady(ownerId) {
      await ready;
      return unsentCount(ownerId);
    },
    storageProblem(ownerId, inspectionId) {
      const key = `${INSPECTION_RECORD_PREFIX}${ownerKey(ownerId)}.${inspectionId}`;
      // A change refused at once (the outbox keeps it in the app) or one the storage refused later.
      if (scoped(ownerId).outbox.view(ownerId, inspectionId)?.persisted !== false) return null;
      return storage.problemOf(key) ?? 'full';
    },
    async clearOwner(ownerId) {
      await ready;
      const person = scoped(ownerId);
      // Nothing more is sent, and a send on its way ends first: its answer would write the record back.
      person.stop();
      try {
        const going = person.inFlight();
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([Promise.allSettled(going), new Promise<void>((r) => (timer = setTimeout(r, CLEAR_WAIT_MS)))]);
        if (timer) clearTimeout(timer);
        const clear = () => {
          removeOwnerRecords(storage, ownerKey(ownerId));
          person.outbox.forgetUnsaved(ownerId);
        };
        clear();
        // One still on its way after the wait is cleared after it too.
        for (const p of going) void p.then(clear, clear);
        await storage.settled();
      } finally {
        person.resume();
      }
    },
  };
}
