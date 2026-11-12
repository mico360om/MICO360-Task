import { describe, it, expect } from 'vitest';
import { ACTION_DOT, ACTION_TONE, ACTION_VERB, detailOf } from './activity-lines';
import type { ApiActivity } from '../api/activity';

const line = (action: string, meta: Record<string, unknown> = {}) => ({ id: 'a1', action, meta, createdAt: '2026-11-10T06:00:00Z', userId: 'u1', taskId: 't1', projectId: 'p1' }) as unknown as ApiActivity;

describe('Activity page lines: the Recycle Bin', () => {
  it('a delete reads "deleted … to the Recycle Bin" in red; a restore "restored … from the Recycle Bin" in green', () => {
    expect([ACTION_VERB.DELETED, detailOf(line('DELETED')), ACTION_TONE.DELETED, ACTION_DOT.DELETED]).toEqual(['deleted', 'to the Recycle Bin', 'text-danger', 'bg-danger']);
    expect([ACTION_VERB.RESTORED, detailOf(line('RESTORED')), ACTION_TONE.RESTORED, ACTION_DOT.RESTORED]).toEqual(['restored', 'from the Recycle Bin', 'text-success', 'bg-success']);
  });
});
