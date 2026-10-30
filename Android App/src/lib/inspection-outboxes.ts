import type { ApiClient } from './api-client';
import { createMirroredDraftStorage, type MirroredDraftStorage } from './draft-storage';
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
  outboxFor(ownerId: string): InspectionOutbox;
  /** The person's changes not sent yet: answers, follow-up requests and a waiting finish (the sign-out question). */
  unsentCount(ownerId: string | null | undefined): number;
  /** Signing out on purpose: the person's records go, on the phone and in the app. */
  clearOwner(ownerId: string): Promise<void>;
}

export function createInspectionOutboxes(deps: { store: KeyValueStore; api: Pick<ApiClient, 'forUser'>; now?: () => Date; newId?: () => string }): InspectionOutboxes {
  const storage = createMirroredDraftStorage(deps.store);
  const ready = storage.hydrate();
  const outboxes = new Map<string, InspectionOutbox>();

  function outboxFor(ownerId: string): InspectionOutbox {
    let o = outboxes.get(ownerId);
    if (!o) {
      o = createInspectionOutbox({ storage, api: inspectionsApi(deps.api.forUser(ownerId)), ...(deps.now ? { now: deps.now } : {}), ...(deps.newId ? { newId: deps.newId } : {}) });
      outboxes.set(ownerId, o);
    }
    return o;
  }

  return {
    storage,
    ready,
    isReady: () => storage.isHydrated(),
    outboxFor,
    unsentCount(ownerId) {
      if (!ownerId) return 0;
      return outboxFor(ownerId)
        .waiting(ownerId)
        .reduce((n, w) => n + w.pending.answers + w.pending.followUps + (w.pending.finish ? 1 : 0), 0);
    },
    async clearOwner(ownerId) {
      await ready;
      removeOwnerRecords(storage, ownerId);
      outboxFor(ownerId).forgetUnsaved(ownerId);
      await storage.settled();
    },
  };
}
