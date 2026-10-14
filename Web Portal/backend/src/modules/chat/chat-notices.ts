/**
 * The title of the notification for direct messages: who they are from and how many are waiting.
 * ("New direct message" said neither, so a bell full of them told the reader nothing.)
 */
export function directMessageTitle(senderName: string | null | undefined, waiting: number): string {
  const name = senderName?.trim();
  const many = waiting > 1;
  if (!name) return many ? `${waiting} new direct messages` : 'New direct message';
  return many ? `${waiting} new messages from ${name}` : `New message from ${name}`;
}
