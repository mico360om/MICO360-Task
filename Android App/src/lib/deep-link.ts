/** A resolved navigation target from a deep link or a push notification tap. */
export type LinkTarget =
  | { screen: 'TaskDetail'; params: { taskId: string } }
  | { screen: 'Board'; params: { projectId: string } }
  | { screen: 'Chat' }
  | { screen: 'Notifications' };

/**
 * Parse an incoming URL (custom scheme `mico360://…` or an https universal link)
 * into a navigation target (A0.3). Returns null for anything unrecognized.
 */
export function parseDeepLink(url: string): LinkTarget | null {
  const match = /^(?:mico360:\/\/|https?:\/\/[^/]+\/)(.*)$/i.exec(url.trim());
  if (!match) return null;
  const path = (match[1] ?? '').replace(/^\/+/, '').replace(/[?#].*$/, '');
  const [segment, id] = path.split('/');

  if (segment === 'task' && id) return { screen: 'TaskDetail', params: { taskId: id } };
  if (segment === 'project' && id) return { screen: 'Board', params: { projectId: id } };
  if (segment === 'chat') return { screen: 'Chat' };
  if (segment === 'notifications') return { screen: 'Notifications' };
  return null;
}

/**
 * Map a push notification's data payload to a navigation target (A6.2). The backend notification
 * carries `entityType` + `entityId` (entityType is lowercase — `task` / `conversation` / `digest`),
 * so matching is case-insensitive. A conversation opens the Chat tab (the push payload doesn't
 * carry the title/kind a specific thread needs); unknown/absent entities open the notifications list.
 */
export function notificationToTarget(data: Record<string, unknown>): LinkTarget {
  const entityType = typeof data.entityType === 'string' ? data.entityType.trim().toLowerCase() : '';
  const entityId = typeof data.entityId === 'string' ? data.entityId : undefined;
  if (entityType === 'task' && entityId) return { screen: 'TaskDetail', params: { taskId: entityId } };
  if (entityType === 'project' && entityId) return { screen: 'Board', params: { projectId: entityId } };
  if (entityType === 'conversation') return { screen: 'Chat' };
  return { screen: 'Notifications' };
}
