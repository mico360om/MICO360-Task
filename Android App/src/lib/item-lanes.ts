import { sendInOrder, writeTarget, type Write, type WriteOrderDeps } from './write-order';

/**
 * Write lanes, one per item (2c review). Changes to one item go to the server one after another —
 * the order they were made — while changes to different items go at once.
 *
 * A TanStack mutation scope per task or meeting put every subtask tick (or agenda tick, attendance,
 * action item) of it in one line: tick A, B and C quickly and B and C wait for A's answer (up to
 * 20 s each on hanging Wi-Fi), flip back when A's answer reloads the list, and — not yet kept on
 * the phone — are lost if Android closes the app meanwhile. Keyed by the item (writeTarget), only a
 * second change of the same item waits for the first. Pure, so it is tested here.
 */
export function createItemLanes() {
  const lanes = new Map<string, Promise<unknown>>();
  return {
    /** Run one write after the earlier writes of its item have finished (failed or not); one with no item at once. */
    run<T>(key: string | null, write: () => Promise<T>): Promise<T> {
      if (!key) return write();
      const before = lanes.get(key) ?? Promise.resolve();
      const next = before.then(write, write);
      const settled = next.catch(() => undefined);
      lanes.set(key, settled);
      void settled.then(() => {
        if (lanes.get(key) === settled) lanes.delete(key);
      });
      return next;
    },
  };
}

export type ItemLanes = ReturnType<typeof createItemLanes>;

/** The app's one set of item lanes. */
export const itemLanes = createItemLanes();

/**
 * A change to an existing item, the way every screen sends it: in its item's lane, and in order
 * with an older change to it still waiting on this phone (write-order).
 */
export function sendItemWrite<T>(lanes: ItemLanes, deps: WriteOrderDeps, write: Write, send: () => Promise<T>): Promise<T> {
  return lanes.run(writeTarget(write.kind, write.payload), () => sendInOrder(deps, write, send));
}
