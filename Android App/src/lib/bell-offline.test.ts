import { it, expect } from 'vitest';
import { unreadAfterPendingReads } from './alerts';
import { UNREAD_COUNT_COPY } from './offline-copy';
import { appSource as src } from '../testing/web-source';

/**
 * Device check N11 (31 Oct): the bell's number went away with the signal — after a restart with no
 * connection it had no count at all. The unread count is kept on the phone like the alerts list, so
 * the bell keeps its last known number offline; alerts read on this phone meanwhile come off it. The
 * app's icon still takes only the server's own answers (lib/alerts' badge rule), never the kept copy.
 */
it('the kept count less the alerts read on this phone, not sent yet (each once)', () => {
  const read = (id: string) => ({ kind: 'notification.read', payload: { id } });
  expect(unreadAfterPendingReads(18, [])).toBe(18);
  expect(unreadAfterPendingReads(18, [read('a'), read('b'), read('a'), { kind: 'task.move', payload: { id: 'c' } }])).toBe(16);
  expect(unreadAfterPendingReads(1, [read('a'), read('b')])).toBe(0);
});

it('the unread count is read through the offline copy, with this phone’s reads laid over a kept copy', () => {
  expect(UNREAD_COUNT_COPY).toBe('notifications.unread');
  const q = src('core/queries.ts');
  expect(q).toMatch(/reads\.read\(queryKey, UNREAD_COUNT_COPY, \(\) => resources\.notifications\.unreadCount\(\)\)/);
  expect(q).toMatch(/reads\.answeredFromCopy\(\{ queryHash: hashKey\(queryKey\) \}\)\s*\?\s*\{ count: unreadAfterPendingReads\(c\.count, queue\.pendingFor\(currentUserId\(\)\)\) \}\s*:\s*c/);
});

it('a count from the kept copy never reaches the app’s icon', () => {
  expect(src('core/alerts.ts')).toMatch(/if \(count === undefined \|\| reads\.answeredFromCopy\(event\.query\)\) return;/);
});
