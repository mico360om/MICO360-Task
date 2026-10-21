/**
 * How the thread scrolls (3a). It is an inverted list: offset 0 is the newest message, and older
 * pages are added at the far end, so what you are reading stays put while they load. A new newest
 * message is followed only when you are at the newest already (or it is your own); otherwise it is
 * counted on a "new messages" pill. Pure, so it is tested here.
 */

/** Within this distance of the newest message the thread follows new ones. */
export const NEAR_NEWEST_PX = 120;
/** Further than this into the history, a button leads back to the newest. */
export const FAR_FROM_NEWEST_PX = 600;

export const isNearNewest = (offsetY: number): boolean => offsetY <= NEAR_NEWEST_PX;
export const isFarFromNewest = (offsetY: number): boolean => offsetY > FAR_FROM_NEWEST_PX;

/**
 * The newest row changed (or not): follow it, or count the messages others wrote since the one
 * that was newest before. `items` are newest first; their ids are the rows' keys.
 */
export function afterNewest({
  prevNewestId,
  items,
  nearNewest,
  myId,
}: {
  prevNewestId: string | undefined;
  items: ReadonlyArray<{ id: string; userId: string }>;
  nearNewest: boolean;
  myId: string;
}): { follow: boolean; unseen: number } {
  const newest = items[0];
  if (!newest) return { follow: false, unseen: 0 };
  if (prevNewestId === undefined) return { follow: true, unseen: 0 };
  if (newest.id === prevNewestId) return { follow: false, unseen: 0 };
  if (nearNewest || newest.userId === myId) return { follow: true, unseen: 0 };
  const at = items.findIndex((i) => i.id === prevNewestId);
  const added = at >= 0 ? items.slice(0, at) : [newest];
  return { follow: false, unseen: added.filter((i) => i.userId !== myId).length };
}

/** The pill's words. */
export const newMessagesLabel = (n: number): string => `${n} new message${n === 1 ? '' : 's'}`;
