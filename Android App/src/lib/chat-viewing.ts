/**
 * The conversation open on screen right now (3a), like the website's: a push about it that arrives
 * while the app is open is not shown again (its messages are already on screen), and the Chat tab's
 * number leaves it out (it is being read). The thread sets it while it is in view and the app is in
 * front. Pure, so it is tested here.
 */

let viewing: string | null = null;
/**
 * Is the app covered — the fingerprint lock, or the plain cover shown until the lock setting is
 * known (3a review)? Then nothing under it is on screen: no conversation is read and no push is
 * silenced. It starts covered (a screen's effects run before the lock gate's), until the lock gate
 * says the app is shown.
 */
let covered = true;
const listeners = new Set<() => void>();
const tell = () => {
  for (const l of [...listeners]) l();
};

export function setViewingConversation(conversationId: string | null): void {
  if (viewing === conversationId) return;
  viewing = conversationId;
  tell();
}

/** The thread for this conversation was left: it is no longer the one open (whether covered or not). */
export function stopViewing(conversationId: string): void {
  if (viewing === conversationId) setViewingConversation(null);
}

/** The conversation on screen — none while the app is covered by the lock. */
export const viewingConversation = (): string | null => (covered ? null : viewing);

export const appCovered = (): boolean => covered;

/** The lock gate: the app is covered (locked, or not yet known), or shown. */
export function setAppCovered(next: boolean): void {
  if (covered === next) return;
  covered = next;
  tell();
}

/** Is an open thread really in front of the person: in view, the app in front, and not behind the lock? */
export function canReadOnScreen({ focused, appActive, covered: isCovered }: { focused: boolean; appActive: boolean; covered: boolean }): boolean {
  return focused && appActive && !isCovered;
}

/** Hear each change; returns a function that stops listening. */
export function subscribeViewing(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const about = (data: unknown, entityType: string, entityId: string): boolean => {
  const d = (data ?? {}) as { entityType?: unknown; entityId?: unknown };
  return typeof d.entityType === 'string' && d.entityType.trim().toLowerCase() === entityType && d.entityId === entityId;
};

/** How a push that arrives while the app is open is shown: not at all for the conversation on screen. */
export function pushPresentation(
  data: Record<string, unknown> | null | undefined,
  viewingId: string | null,
): { shouldShowAlert: boolean; shouldPlaySound: boolean; shouldSetBadge: boolean } {
  const quiet = !!viewingId && about(data, 'conversation', viewingId);
  return { shouldShowAlert: !quiet, shouldPlaySound: !quiet, shouldSetBadge: false };
}

/** The ids of the phone's notifications about this thing (to clear them once it was read). */
export function notificationsAbout(
  presented: ReadonlyArray<{ request: { identifier: string; content: { data?: Record<string, unknown> | null } } }>,
  entityType: string,
  entityId: string,
): string[] {
  return presented.filter((n) => about(n.request.content.data, entityType, entityId)).map((n) => n.request.identifier);
}
