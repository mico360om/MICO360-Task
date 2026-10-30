import { describe, it, expect } from 'vitest';
import { appSource as src, hasWeb, loadWebTs, readWeb } from '../testing/web-source';
import { approvalNotice, DECISION_WORDS, isWaitingForApproval, waitingForText } from './approvals';
import { isTaskLate } from './due-date';

const normalise = (text: string) => text.replace(/\r\n/g, '\n');
const NOW = new Date('2026-10-30T08:00:00Z'); // 30 Oct in Muscat

// Due yesterday / today / tomorrow / never × To Do / Review / Done × completed or not × waiting or not.
const MATRIX = ['2026-10-29', '2026-10-30', '2026-10-31', null].flatMap((dueDate) =>
  ['TODO', 'REVIEW', 'DONE'].flatMap((columnCategory) =>
    [null, '2026-10-29T10:00:00Z'].flatMap((completedAt) =>
      [null, '2026-10-29T09:00:00Z'].map((approvalRequestedAt) => ({ dueDate, columnCategory, completedAt, approvalRequestedAt })),
    ),
  ),
);

describe.skipIf(!hasWeb('frontend/src/lib/approvals.ts', 'backend/src/modules/tasks/task-status.ts', 'backend/src/lib/due-date.ts'))('the website’s and the server’s rules', () => {
  it('approvals.ts is the website’s text', () => expect(normalise(src('lib/approvals.ts'))).toBe(normalise(readWeb('frontend/src/lib/approvals.ts'))));
  it('isTaskLate decides like the server’s', () => {
    const server = loadWebTs('backend/src/modules/tasks/task-status.ts', { '../../lib/due-date': 'backend/src/lib/due-date.ts' }) as { isTaskLate: typeof isTaskLate };
    expect(MATRIX).toHaveLength(48);
    for (const t of MATRIX) expect(isTaskLate(t, 'Asia/Muscat', NOW), JSON.stringify(t)).toBe(server.isTaskLate(t, 'Asia/Muscat', NOW));
  });
});

it('late: open and past its day — never while it waits for approval, never once done', () => {
  expect(isTaskLate({ dueDate: '2026-10-29' }, 'Asia/Muscat', NOW)).toBe(true);
  expect(isTaskLate({ dueDate: '2026-10-30' }, 'Asia/Muscat', NOW)).toBe(false);
  expect(isTaskLate({ dueDate: '2026-10-29', approvalRequestedAt: '2026-10-29T09:00:00Z' }, 'Asia/Muscat', NOW)).toBe(false);
  expect(isTaskLate({ dueDate: '2026-10-29', columnCategory: 'DONE' }, 'Asia/Muscat', NOW)).toBe(false);
  expect(isTaskLate({ dueDate: null }, 'Asia/Muscat', NOW)).toBe(false);
});

it('the website’s words for waiting', () => {
  expect(DECISION_WORDS.waiting).toBe('Waiting for approval');
  expect(isWaitingForApproval({ approvalRequestedAt: '2026-10-29T09:00:00Z' })).toBe(true);
  expect(isWaitingForApproval({ approvalRequestedAt: null })).toBe(false);
  expect(waitingForText('Omar Ahmed')).toBe('Waiting for Omar Ahmed’s approval');
  expect(waitingForText(null)).toBe('Waiting for a project manager’s approval');
  expect(approvalNotice('done', { key: 'RIG-4', columnId: 'review', approvalRequestedAt: '2026-10-30T08:00:00Z' })).toBe('RIG-4 needs approval, so it’s waiting for a project manager.');
  expect(approvalNotice('done', { key: 'RIG-4', columnId: 'done', approvalRequestedAt: null })).toBeNull();
});
