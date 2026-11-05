import { describe, it, expect, vi } from 'vitest';
import { addedToMainText, noteMergedWrite, onMergedWrite } from './merged-write';

describe('something added to a merged task (1.23.1)', () => {
  it('an answer naming the main task is passed on; any other answer is not', () => {
    const heard = vi.fn();
    const stop = onMergedWrite(heard);
    noteMergedWrite({ data: { id: 'c1' } });
    noteMergedWrite({ data: { id: 'c2' }, mergedInto: { taskId: 't12', key: 'MICO-12', fromKey: 'MICO-14' } });
    stop();
    noteMergedWrite({ data: { id: 'c3' }, mergedInto: { taskId: 't12', key: 'MICO-12', fromKey: 'MICO-14' } });
    expect(heard).toHaveBeenCalledTimes(1);
    expect(heard).toHaveBeenCalledWith({ taskId: 't12', key: 'MICO-12', fromKey: 'MICO-14' });
  });

  it('says where it went', () => {
    expect(addedToMainText({ taskId: 't12', key: 'MICO-12', fromKey: 'MICO-14' })).toBe('Added to MICO-12 (MICO-14 was merged into it).');
    expect(addedToMainText({ taskId: 't12', key: null, fromKey: 'MICO-14' })).toBe('Added to the task MICO-14 was merged into.');
  });
});
