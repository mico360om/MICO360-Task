import { describe, it, expect } from 'vitest';
import { hasWeb, readWeb } from '../testing/web-source';
import { BULK_LABELS, bulkResultText, runBulk, type BulkDeps } from './bulk-actions';

describe('bulk Complete and tasks that need approval', () => {
  it('bulk Complete says which tasks wait for approval instead of reporting them done (the website’s words)', () => {
    expect(bulkResultText('Completed', { succeeded: 2, failed: 0, kept: 0, waiting: 1 })).toBe('Completed 2 tasks. 1 needs approval and is waiting for a project manager.');
    expect(bulkResultText('Completed', { succeeded: 3, failed: 0, kept: 0, waiting: 3 })).toBe('Completed 3 tasks. 3 need approval and are waiting for a project manager.');
    expect(bulkResultText(BULK_LABELS.complete, { succeeded: 2, failed: 0, kept: 0, waiting: 0 })).toBe('Completed 2 tasks.');
  });

  it('counts the tasks the server put to wait (Complete and Move to…), from its answers', async () => {
    const answers: Record<string, unknown> = {
      a: { key: 'RIG-1', columnId: 'review', approvalRequestedAt: '2026-10-30T08:00:00Z' },
      b: { key: 'RIG-2', columnId: 'done', approvalRequestedAt: null },
      c: undefined,
    };
    const deps: BulkDeps = {
      update: async () => {},
      assign: async () => {},
      move: async (t) => answers[t.id],
      doneColumnFor: async () => 'done',
    };
    const refs = ['a', 'b', 'c'].map((id) => ({ id, projectId: 'p' }));
    expect(await runBulk(refs, { type: 'complete' }, deps)).toEqual({ succeeded: 3, failed: 0, kept: 0, waiting: 1 });
    expect(await runBulk(refs, { type: 'move', columnId: 'done' }, deps)).toEqual({ succeeded: 3, failed: 0, kept: 0, waiting: 1 });
    expect(await runBulk(refs, { type: 'setPriority', priority: 'HIGH' }, deps)).toEqual({ succeeded: 3, failed: 0, kept: 0 });
  });
});

describe.skipIf(!hasWeb('frontend/src/pages/MyTasksPage.tsx'))('the website’s bulk toast', () => {
  it('words the tasks that wait the same way', () => {
    expect(readWeb('frontend/src/pages/MyTasksPage.tsx')).toContain("` ${waiting} need${waiting === 1 ? 's' : ''} approval and ${waiting === 1 ? 'is' : 'are'} waiting for a project manager.`");
  });
});
