import { isSafeId } from './ids';

/**
 * Where a push notification tap (or the app itself) sends you. URL links are read by the
 * navigator's linking config alone (navigation/linking), so there is one reading of every path.
 */
export type LinkTarget =
  | { screen: 'TaskDetail'; params: { taskId: string } }
  | { screen: 'Board'; params: { projectId: string } }
  | { screen: 'ProjectDetail'; params: { projectId: string } }
  | { screen: 'MeetingDetail'; params: { meetingId: string } }
  | { screen: 'Meetings' }
  | { screen: 'MyActionItems' }
  | { screen: 'Chat' }
  | { screen: 'ChatThread'; params: { conversationId: string } }
  | { screen: 'Notifications' }
  | { screen: 'Reset'; params: { token: string } };

/**
 * Map a push notification's data payload to a navigation target (A6.2). The backend notification
 * carries `entityType` + `entityId` (entityType is lowercase — `task` / `conversation` / `digest`,
 * and `meeting` once the server sends meeting notifications), so matching is case-insensitive. A
 * conversation opens its thread (3a: the thread finds its own title in the inbox), or the Chat tab
 * without an id; unknown/absent entities open the notifications list.
 */
export function notificationToTarget(data: Record<string, unknown>): LinkTarget {
  const entityType = typeof data.entityType === 'string' ? data.entityType.trim().toLowerCase() : '';
  // An id that isn't an id (a path, spaces, too long) opens nothing built from it (3a review).
  if (typeof data.entityId === 'string' && data.entityId && !isSafeId(data.entityId)) return { screen: 'Notifications' };
  const entityId = isSafeId(data.entityId) ? data.entityId : undefined;
  if (entityType === 'task' && entityId) return { screen: 'TaskDetail', params: { taskId: entityId } };
  if (entityType === 'project' && entityId) return { screen: 'ProjectDetail', params: { projectId: entityId } }; // its dashboard (5c)
  if (entityType === 'meeting' && entityId) return { screen: 'MeetingDetail', params: { meetingId: entityId } };
  if (entityType === 'conversation' && entityId) return { screen: 'ChatThread', params: { conversationId: entityId } };
  if (entityType === 'conversation') return { screen: 'Chat' };
  return { screen: 'Notifications' };
}

/**
 * The reset token from whatever the user has: the full e-mail link
 * (`https://task.mico360.com/reset?token=…`), a query fragment (`reset?token=…`), or the bare
 * token they copied (MOB-09). Returns '' for blank input.
 */
export function extractResetToken(input: string): string {
  const s = input.trim();
  const m = /[?&]token=([^&#\s]+)/.exec(s);
  if (!m) return s;
  try {
    return decodeURIComponent(m[1]!).trim();
  } catch {
    return m[1]!;
  }
}
