import { describe, it, expect } from 'vitest';
import { taskNoticeBody } from './task-notice';

describe('taskNoticeBody — which task a notification is about', () => {
  it('names the task: its key and its title', () => {
    // "You were assigned a task" four times in a row told the reader nothing.
    expect(taskNoticeBody({ key: 'MICO-12', title: 'Prepare the monthly report' })).toBe('MICO-12 · Prepare the monthly report');
  });

  it('shortens a very long title', () => {
    const body = taskNoticeBody({ key: 'MICO-13', title: 'x'.repeat(400) })!;
    expect(body.length).toBeLessThanOrEqual(140);
    expect(body.endsWith('…')).toBe(true);
  });

  it('copes with a task that is gone or has no title', () => {
    expect(taskNoticeBody(null)).toBeNull();
    expect(taskNoticeBody({ key: 'MICO-14', title: '  ' })).toBe('MICO-14');
  });
});
