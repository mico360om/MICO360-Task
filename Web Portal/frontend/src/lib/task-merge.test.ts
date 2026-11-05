import { describe, it, expect } from 'vitest';
import { bulkMergeAvailability, checklistGroups, countsLine, mergeAvailability, mergeNoticeText, mergedFromKeys, undoNotes } from './task-merge';

const targets = (over: Partial<{ managesAll: boolean; managedProjectIds: string[] }> = {}) => ({ managesAll: false, managedProjectIds: ['rig'], projects: [], ...over });

describe('who sees "Merge with other tasks…"', () => {
  it('administrators and whoever manages the task’s project; employees never see it', () => {
    expect(mergeAvailability('rig', targets())).toEqual({ show: true, reason: null });
    expect(mergeAvailability('ops', targets({ managesAll: true }))).toEqual({ show: true, reason: null });
    expect(mergeAvailability('ops', targets())).toEqual({ show: false, reason: null });
    expect(mergeAvailability('rig', undefined)).toEqual({ show: false, reason: null });
    expect(mergeAvailability('rig', null)).toEqual({ show: false, reason: null });
  });

  it('a read-only project (archived or completed) or a merged task: shown, unavailable, saying why', () => {
    expect(mergeAvailability('rig', targets(), { readOnly: 'Rig Inspection is archived.' })).toEqual({ show: true, reason: 'Rig Inspection is archived.' });
  });

  it('the bulk bar: 2 to 10 tasks, every one in a project the person manages', () => {
    const t = (projectId: string) => ({ projectId });
    expect(bulkMergeAvailability([t('rig')], targets())).toEqual({ show: false, reason: null });
    expect(bulkMergeAvailability([t('rig'), t('rig')], targets())).toEqual({ show: true, reason: null });
    expect(bulkMergeAvailability([t('rig'), t('ops')], targets())).toEqual({ show: false, reason: null });
    expect(bulkMergeAvailability([t('rig'), t('ops')], targets({ managesAll: true }))).toEqual({ show: true, reason: null });
    expect(bulkMergeAvailability(Array.from({ length: 11 }, () => t('rig')), targets())).toEqual({ show: true, reason: 'Merge at most 10 tasks at a time.' });
  });
});

describe('merge words', () => {
  it('what each task brings, the non-zero kinds only', () => {
    expect(countsLine({ comments: 3, checklist: 1, files: 2, assignees: 1, watchers: 0, contacts: 0, tags: 0, blockers: 1, actionItems: 0, inspections: 1, activity: 7 })).toBe(
      '3 comments, 1 checklist item, 2 files, 1 person, 1 blocker link, 1 inspection, 7 history entries',
    );
    expect(countsLine({ comments: 0, checklist: 0, files: 0, assignees: 0, watchers: 0, contacts: 0, tags: 0, blockers: 0, actionItems: 0, inspections: 0, activity: 0 })).toBe('Nothing besides its own fields');
  });

  it('opened by an old number: which task it was, when and by whom', () => {
    expect(mergeNoticeText({ key: 'MICO-14', mergedAt: '2026-11-05T09:00:00Z', mergedByName: 'Khurram' }, 'Asia/Muscat', '2026-11-05')).toBe('MICO-14 was merged into this task on 5 Nov by Khurram.');
    expect(mergeNoticeText({ key: 'MICO-14', mergedAt: '2025-12-30T09:00:00Z', mergedByName: null }, 'Asia/Muscat', '2026-11-05')).toBe('MICO-14 was merged into this task on 30 Dec 2025.');
  });

  it('the main task’s own numbers, apart from those of the tasks merged into it', () => {
    expect(mergedFromKeys({ formerKeys: ['RIG-4', 'MICO-14'], mergedFrom: [{ id: 'x', key: 'MICO-14', mergeId: 'm' }] })).toEqual({ former: ['RIG-4'], merged: ['MICO-14'] });
    expect(mergedFromKeys({ formerKeys: ['RIG-4'] })).toEqual({ former: ['RIG-4'], merged: [] });
  });

  it('the Undo question: what was deleted since, and a project the main task stays in', () => {
    expect(undoNotes({ deletedSince: ['1 file from MICO-14 was deleted after the merge.'], mainMoved: { fromProject: 'Rig', toProject: 'Operations' }, mainKey: 'OPS-3' } as never)).toEqual([
      '1 file from MICO-14 was deleted after the merge.',
      'OPS-3 stays in Operations (the merge moved it from Rig).',
    ]);
  });
});

describe('the checklist after a merge', () => {
  it('the main task’s own items first, then a "From MICO-14" group per merged task, each in order', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    expect(checklistGroups(items, { b: 'MICO-14', d: 'MICO-15', c: 'MICO-14' })).toEqual([
      { fromKey: null, items: [{ id: 'a' }] },
      { fromKey: 'MICO-14', items: [{ id: 'b' }, { id: 'c' }] },
      { fromKey: 'MICO-15', items: [{ id: 'd' }] },
    ]);
    expect(checklistGroups(items, {})).toEqual([{ fromKey: null, items }]);
  });
});
