import { describe, it, expect } from 'vitest';
import { alsoCopiedText, carriedStart, duplicatedNotice, filesOutcomeText } from './task-duplicate';

const TODAY = '2026-11-10';

describe('Duplicate Task words', () => {
  it('says what is copied without a field of its own', () => {
    expect(alsoCopiedText({ startDate: '2026-11-03', tags: ['safety', 'rig'], watchers: 2, estimatedHours: 4 }, TODAY)).toBe(
      'Also copied: start date 3 Nov, tags safety and rig, 2 watchers and 4 h estimate.',
    );
    expect(alsoCopiedText({ startDate: '2027-01-04', tags: ['rig'], watchers: 1 }, TODAY)).toBe('Also copied: start date 4 Jan 2027, tag rig and 1 watcher.');
    expect(alsoCopiedText({ tags: [], watchers: 0, estimatedHours: null }, TODAY)).toBeNull();
  });

  it('keeps the original’s start date only when it fits the due date', () => {
    expect(carriedStart('2026-11-03', '2026-11-20')).toBe('2026-11-03');
    expect(carriedStart('2026-11-03', '2026-11-03')).toBe('2026-11-03');
    expect(carriedStart('2026-11-03', '')).toBe('2026-11-03');
    expect(carriedStart('2026-11-03', '2026-11-02')).toBeNull();
    expect(carriedStart(null, '2026-11-02')).toBeNull();
  });

  it('says how the files went', () => {
    expect(filesOutcomeText({ total: 0, copied: 0, failed: [] })).toBeNull();
    expect(filesOutcomeText(null)).toBeNull();
    expect(filesOutcomeText({ total: 3, copied: 3, failed: [] })).toBe('3 files copied');
    expect(filesOutcomeText({ total: 1, copied: 1, failed: [] })).toBe('1 file copied');
    expect(filesOutcomeText({ total: 3, copied: 2, failed: [{ filename: 'x.dwg', reason: 'no' }] })).toBe('2 of 3 files copied — “x.dwg” couldn’t be copied');
    expect(filesOutcomeText({ total: 1, copied: 0, failed: [{ filename: 'x.dwg', reason: 'no' }] })).toBe('“x.dwg” couldn’t be copied');
    expect(filesOutcomeText({ total: 2, copied: 0, failed: [{ filename: 'a.dwg', reason: 'no' }, { filename: 'b.dwg', reason: 'no' }] })).toBe('No files copied — “a.dwg” and “b.dwg” couldn’t be copied');
  });

  it('the notice after saving: the usual “Task … created”, with Open, and the files', () => {
    expect(duplicatedNotice({ id: 't40', key: 'MSSP-40' }, { total: 3, copied: 2, failed: [{ filename: 'x.dwg', reason: 'no' }] })).toEqual({
      text: 'Task MSSP-40 created · 2 of 3 files copied — “x.dwg” couldn’t be copied',
      taskId: 't40',
      key: 'MSSP-40',
    });
    expect(duplicatedNotice({ id: 't40', key: 'MSSP-40' }, { total: 0, copied: 0, failed: [] }).text).toBe('Task MSSP-40 created');
  });
});
