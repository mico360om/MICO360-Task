import { ValidationError } from '../../lib/http-errors';

/**
 * The Notifications page's type chips (1.22) and the notification `type`s each stands for. The
 * server owns the mapping, so the apps ask for chips (`kinds=mentions,due`) and never list types.
 * No type is in two chips, so the chips' unread counts add up. The types in no chip — a task moving
 * column (TASK_STATUS), a direct message (CHAT_MESSAGE), being put on a project (PROJECT_ADDED) and
 * the daily digest (TASK_DIGEST) — are shown under "All types" only.
 */
export const NOTIFICATION_KINDS = {
  mentions: ['MENTION', 'CHAT_MENTION'],
  assigned: ['TASK_ASSIGNED'],
  // An escalation is a task ≥3 days overdue (or Blocked), sent to whoever runs its project.
  due: ['TASK_DUE_SOON', 'TASK_OVERDUE', 'TASK_ESCALATION'],
  comments: ['TASK_COMMENT'],
  // 1.23: a client accepting or sending back a task joins the approvals.
  approvals: ['TASK_APPROVAL', 'TASK_CLIENT_SIGN_OFF'],
  meetings: ['MEETING_REMINDER'],
} as const satisfies Record<string, readonly string[]>;

export type NotificationKind = keyof typeof NOTIFICATION_KINDS;
export const KIND_KEYS = Object.keys(NOTIFICATION_KINDS) as [NotificationKind, ...NotificationKind[]];

/** The types of these chips, in chip order, once each; no chips (or none given) = every type (undefined). */
export function typesOfKinds(kinds: readonly NotificationKind[] | undefined): string[] | undefined {
  if (!kinds || kinds.length === 0) return undefined;
  return KIND_KEYS.filter((k) => kinds.includes(k)).flatMap((k) => [...NOTIFICATION_KINDS[k]]);
}

/** The chip a type is shown under; null for a type in no chip. */
export function kindOfType(type: string): NotificationKind | null {
  return KIND_KEYS.find((k) => (NOTIFICATION_KINDS[k] as readonly string[]).includes(type)) ?? null;
}

export interface NotificationCounts {
  /** Every unread notification (of every type), as the bell's badge counts them. */
  unread: number;
  /** Unread per chip. */
  kinds: Record<NotificationKind, number>;
}

/** Unread counts per type → the total and the count per chip. */
export function unreadByKind(byType: Readonly<Record<string, number>>): NotificationCounts {
  const kinds = Object.fromEntries(KIND_KEYS.map((k) => [k, 0])) as Record<NotificationKind, number>;
  let unread = 0;
  for (const [type, n] of Object.entries(byType)) {
    unread += n;
    const kind = kindOfType(type);
    if (kind) kinds[kind] += n;
  }
  return { unread, kinds };
}

/** Where the next page starts: the last row shown (newest first, by time and then id). */
export interface NotificationCursor {
  createdAt: Date;
  id: string;
}

export function encodeNotificationCursor(row: NotificationCursor): string {
  return Buffer.from(`n:${row.createdAt.toISOString()}|${row.id}`, 'utf8').toString('base64url');
}

/** None (or empty) = from the newest; anything that isn't a cursor of ours is refused (400). */
export function decodeNotificationCursor(cursor: string | undefined): NotificationCursor | undefined {
  if (!cursor) return undefined;
  const m = /^n:(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\|([A-Za-z0-9_-]{1,64})$/.exec(Buffer.from(cursor, 'base64url').toString('utf8'));
  const createdAt = m ? new Date(m[1]!) : null;
  if (!m || !createdAt || Number.isNaN(createdAt.getTime())) throw new ValidationError('Invalid cursor.');
  return { createdAt, id: m[2]! };
}
