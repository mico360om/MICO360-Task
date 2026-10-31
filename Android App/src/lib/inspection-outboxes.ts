import type { ApiClient } from './api-client';
import { INSPECTION_RECORD_PREFIX, createMirroredDraftStorage, type MirroredDraftStorage } from './draft-storage';
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

/**
 * The website's outbox as one person's on this server: each method takes the person's id and works
 * on the records kept under `owner(person)`, so a record made for another server (or one in the old
 * shape, before records named their server) is never shown, counted or sent here — it is kept.
 */
function scopedOutbox(inner: InspectionOutbox, owner: (person: string) => string): InspectionOutbox {
  return {
    subscribe: (listener) => inner.subscribe(listener),
    changedElsewhere: () => inner.changedElsewhere(),
    draft: (o, id) => inner.draft(owner(o), id),
    view: (o, id) => inner.view(owner(o), id),
    remember: (o, detail) => inner.remember(owner(o), detail),
    saveAnswer: (o, id, value) => inner.saveAnswer(owner(o), id, value),
    queueFinish: (o, id, signatures) => inner.queueFinish(owner(o), id, signatures),
    cancelFinish: (o, id) => inner.cancelFinish(owner(o), id),
    queueFollowUps: (o, id, itemIds, assigneeId, detail) => inner.queueFollowUps(owner(o), id, itemIds, assigneeId, detail),
    clearProblem: (o, id) => inner.clearProblem(owner(o), id),
    forgetUnsaved: (o) => inner.forgetUnsaved(owner(o)),
    discard: (o, id) => inner.discard(owner(o), id),
    ackFinished: (o, id) => inner.ackFinished(owner(o), id),
    ackFollowUpReport: (o, id) => inner.ackFollowUpReport(owner(o), id),
    flush: (o, id, opts) => inner.flush(owner(o), id, opts),
    waiting: (o) => inner.waiting(owner(o)),
    flushAll: (o, opts) => inner.flushAll(owner(o), opts),
  };
}

export function createInspectionOutboxes(deps: {
  store: KeyValueStore;
  api: Pick<ApiClient, 'forUser'>;
  /** The server the app is connected to (its API address): records are kept per server. */
  server: string;
  now?: () => Date;
  newId?: () => string;
}): InspectionOutboxes {
  const storage = createMirroredDraftStorage(deps.store);
  const ready = storage.hydrate();
  const outboxes = new Map<string, InspectionOutbox>();
  const scope = serverScope(deps.server);
  const ownerKey = (ownerId: string) => `${ownerId}~${scope}`;

  function outboxFor(ownerId: string): InspectionOutbox {
    let o = outboxes.get(ownerId);
    if (!o) {
      const inner = createInspectionOutbox({ storage, api: inspectionsApi(deps.api.forUser(ownerId)), ...(deps.now ? { now: deps.now } : {}), ...(deps.newId ? { newId: deps.newId } : {}) });
      o = scopedOutbox(inner, ownerKey);
      outboxes.set(ownerId, o);
    }
    return o;
  }

  return {
    storage,
    ready,
    isReady: () => storage.isHydrated(),
    outboxFor,
    ownerKey,
    recordKey: (ownerId, inspectionId) => `${INSPECTION_RECORD_PREFIX}${ownerKey(ownerId)}.${inspectionId}`,
    unsentCount(ownerId) {
      if (!ownerId) return 0;
      return outboxFor(ownerId)
        .waiting(ownerId)
        .reduce((n, w) => n + w.pending.answers + w.pending.followUps + (w.pending.finish ? 1 : 0), 0);
    },
    async clearOwner(ownerId) {
      await ready;
      removeOwnerRecords(storage, ownerKey(ownerId));
      outboxFor(ownerId).forgetUnsaved(ownerId);
      await storage.settled();
    },
  };
}
