/**
 * The conversation open on screen right now (3a), like the website's: a push about it that arrives
 * while the app is open is not shown again (its messages are already on screen), and the Chat tab's
 * number leaves it out (it is being read). The thread sets it while it is in view and the app is in
 * front. Pure, so it is tested here.
 */

let viewing: string | null = null;
const listeners = new Set<() => void>();

export function setViewingConversation(conversationId: string | null): void {
  if (viewing === conversationId) return;
  viewing = conversationId;
  for (const l of [...listeners]) l();
}

export const viewingConversation = (): string | null => viewing;

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
