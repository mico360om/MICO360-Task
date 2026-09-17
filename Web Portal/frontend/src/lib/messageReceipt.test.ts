import { describe, it, expect } from 'vitest';
import { messageReceiptStatus } from './messageReceipt';

const msg = (createdAt: string) => ({ createdAt });
const other = (lastReadAt: string | null, lastActiveAt: string | null) => ({ lastReadAt, lastActiveAt });

describe('messageReceiptStatus', () => {
  it('is "seen" when the other participant read at/after the message time', () => {
    expect(messageReceiptStatus(msg('2026-09-10T08:00:00Z'), other('2026-09-10T08:05:00Z', null), false)).toBe('seen');
    expect(messageReceiptStatus(msg('2026-09-10T08:00:00Z'), other('2026-09-10T08:00:00Z', null), false)).toBe('seen');
  });

  it('is "delivered" when they are online now (even if not yet read)', () => {
    expect(messageReceiptStatus(msg('2026-09-10T08:00:00Z'), other(null, null), true)).toBe('delivered');
  });

  it('is "delivered" when they were last active at/after the message (offline now)', () => {
    expect(messageReceiptStatus(msg('2026-09-10T08:00:00Z'), other(null, '2026-09-10T08:01:00Z'), false)).toBe('delivered');
  });

  it('is "sent" when they have not read, are offline, and were last active before the message', () => {
    expect(messageReceiptStatus(msg('2026-09-10T08:00:00Z'), other(null, '2026-09-10T07:00:00Z'), false)).toBe('sent');
    expect(messageReceiptStatus(msg('2026-09-10T08:00:00Z'), other(null, null), false)).toBe('sent');
  });

  it('prefers "seen" over "delivered" when both hold', () => {
    expect(messageReceiptStatus(msg('2026-09-10T08:00:00Z'), other('2026-09-10T09:00:00Z', '2026-09-10T09:00:00Z'), true)).toBe('seen');
  });

  it('an earlier read (before the message) does not count as seen', () => {
    expect(messageReceiptStatus(msg('2026-09-10T08:00:00Z'), other('2026-09-10T07:59:59Z', null), false)).toBe('sent');
  });
});
