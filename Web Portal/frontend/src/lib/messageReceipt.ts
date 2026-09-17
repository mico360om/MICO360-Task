export type ReceiptStatus = 'sent' | 'delivered' | 'seen';

export interface ReceiptMessage {
  createdAt: string;
}
export interface ReceiptOther {
  /** The other participant's last read time (drives "seen"). */
  lastReadAt: string | null;
  /** The other participant's last active time (drives "delivered" once offline). */
  lastActiveAt: string | null;
}

/**
 * Delivery/read status of one of MY messages in a 1:1 conversation, relative to the other person:
 * - seen      — they read the conversation at/after this message was sent
 * - delivered — they are online now, or were active at/after the message (their client has it)
 * - sent      — on the server, but not yet known to have reached them
 */
export function messageReceiptStatus(msg: ReceiptMessage, other: ReceiptOther, otherOnline: boolean): ReceiptStatus {
  const created = new Date(msg.createdAt).getTime();
  if (other.lastReadAt && new Date(other.lastReadAt).getTime() >= created) return 'seen';
  if (otherOnline) return 'delivered';
  if (other.lastActiveAt && new Date(other.lastActiveAt).getTime() >= created) return 'delivered';
  return 'sent';
}
