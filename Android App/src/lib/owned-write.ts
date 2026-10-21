/**
 * Whose change it is (4b review #1). A change waits — in its item's lane, behind an older change of
 * the same thing — before it is sent, and on a shared phone the person who made it may have signed
 * out (and someone else in) by then. So the maker is captured when the change is made, and the
 * write goes with their session only: the API client's `forUser` refuses to send it with anyone
 * else's (SESSION_CHANGED), write-order never keeps it for anyone else, and an error says whose it
 * was, so a screen's offline path (queueOnOffline) never keeps it for the next person. Pure.
 */
import { resourcesApi, type ResourcesApi } from './resources';
import { ownerOf, tagOwner, type WriteOrderDeps } from './write-order';
import type { ApiClient } from './api-client';

export { ownerOf };

export interface OwnerDeps {
  /** Who is signed in now. */
  currentUserId: () => string | null;
  api: Pick<ApiClient, 'forUser'>;
  /** The resources for whoever is signed in (used only when nobody is). */
  resources: ResourcesApi;
  queue: WriteOrderDeps['queue'];
  sync?: { trigger: () => unknown };
}

export interface OwnedWrite {
  /** The person the change is made by (null: nobody signed in). */
  owner: string | null;
  /** The write order for that person (their queue; kept only while they are still signed in). */
  order: WriteOrderDeps;
  /** The server, as that person only. */
  resources: ResourcesApi;
  /** A write sent at once: as that person, its failure marked with whose it was. */
  run<T>(fn: (r: ResourcesApi) => Promise<T>): Promise<T>;
}

/** Capture who is making a change, now — call it when the change is made, never inside its lane. */
export function ownedWrite(s: OwnerDeps): OwnedWrite {
  const owner = s.currentUserId();
  const resources = owner ? resourcesApi(s.api.forUser(owner)) : s.resources;
  const sync = s.sync;
  return {
    owner,
    order: { queue: s.queue, userId: () => owner, holder: s.currentUserId, ...(sync ? { sync: () => void sync.trigger() } : {}) },
    resources,
    run: (fn) =>
      fn(resources).catch((e: unknown) => {
        throw tagOwner(e, owner);
      }),
  };
}
