import { describe, it, expect } from 'vitest';
import { BLOCKER_SEARCH_LIMIT, blockerSearchParams, rankSearchHits, stillMatching } from './blocker-search';

const hits = [
  { id: 't1', key: 'MICO-1', title: 'Prepare report' },
  { id: 't2', key: 'MICO-2', title: 'Book the venue' }, // the server matched its description
  { id: 't3', key: 'MICO-12', title: 'Review the report' },
  { id: 't4', key: 'MICO-4', title: 'إعداد التقرير' }, // the server matched another spelling
];

describe('blockerSearchParams (the blocker picker asks the server, not every task)', () => {
  it('searches this project for the words typed, most recently changed first, a page at a time', () => {
    expect(blockerSearchParams('p1', '  report ')).toEqual({ projectId: 'p1', q: 'report', limit: BLOCKER_SEARCH_LIMIT, sort: 'updatedAt', order: 'desc' });
    expect(BLOCKER_SEARCH_LIMIT).toBe(30);
  });
});

describe('rankSearchHits', () => {
  it('puts key and title matches first, as the picker always has', () => {
    expect(rankSearchHits(hits, 'mico-1', new Set(), 6).map((t) => t.id)).toEqual(['t1', 't3', 't2', 't4']);
    expect(rankSearchHits(hits, 'report', new Set(), 6).map((t) => t.id)).toEqual(['t1', 't3', 't2', 't4']);
  });

  it('keeps what the server found in a description or another spelling, after those', () => {
    expect(rankSearchHits(hits, 'venue hire', new Set(), 6).map((t) => t.id)).toEqual(['t1', 't2', 't3', 't4']);
  });

  it('leaves out the tasks that can’t be picked, and lists at most `limit`', () => {
    expect(rankSearchHits(hits, 'report', new Set(['t1', 't2']), 6).map((t) => t.id)).toEqual(['t3', 't4']);
    expect(rankSearchHits(hits, 'report', new Set(), 2).map((t) => t.id)).toEqual(['t1', 't3']);
  });
});

describe('stillMatching (while the next search runs)', () => {
  it('keeps only the earlier results whose key or title matches what is typed now', () => {
    expect(stillMatching(hits, 'report').map((t) => t.id)).toEqual(['t1', 't3']);
    expect(stillMatching(hits, 'reportx')).toEqual([]);
  });
});
