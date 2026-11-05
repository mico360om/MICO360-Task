import { beforeEach, describe, expect, it } from 'vitest';
import {
  EMPTY_TABLE_FILTERS,
  PAGE_SIZE,
  dueMatches,
  nextSort,
  readTableMemory,
  saveFailureText,
  sortRows,
  tableFiltersActive,
  writeTableMemory,
} from './data-table';
import { ApiError } from './api-client';
import { userStorageKey } from './user-storage';

describe('nextSort: a header click goes ascending, descending, then back to the page’s usual order', () => {
  it('starts a new column in its first direction', () => {
    expect(nextSort(null, 'title')).toEqual({ column: 'title', dir: 'asc' });
    expect(nextSort({ column: 'due', dir: 'asc' }, 'title')).toEqual({ column: 'title', dir: 'asc' });
    expect(nextSort(null, 'progress', 'desc')).toEqual({ column: 'progress', dir: 'desc' });
  });
  it('then flips it, then lets go', () => {
    expect(nextSort({ column: 'title', dir: 'asc' }, 'title')).toEqual({ column: 'title', dir: 'desc' });
    expect(nextSort({ column: 'title', dir: 'desc' }, 'title')).toBeNull();
    // A column that starts descending ends after its ascending turn.
    expect(nextSort({ column: 'progress', dir: 'desc' }, 'progress', 'desc')).toEqual({ column: 'progress', dir: 'asc' });
    expect(nextSort({ column: 'progress', dir: 'asc' }, 'progress', 'desc')).toBeNull();
  });
});

describe('sortRows', () => {
  const rows = [
    { id: 'a', title: 'beta', n: 2, due: '2026-11-07' },
    { id: 'b', title: 'Alpha', n: 10, due: null },
    { id: 'c', title: 'gamma', n: 1, due: '2026-11-05' },
    { id: 'd', title: 'alpha 2', n: 2, due: '' },
  ];
  const value = (r: (typeof rows)[number], column: string) => (column === 'title' ? r.title : column === 'n' ? r.n : r.due);

  it('keeps the page’s order when nothing is sorted', () => {
    expect(sortRows(rows, null, value).map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
  });
  it('sorts words A to Z ignoring case, and numbers as numbers', () => {
    expect(sortRows(rows, { column: 'title', dir: 'asc' }, value).map((r) => r.id)).toEqual(['b', 'd', 'a', 'c']);
    expect(sortRows(rows, { column: 'n', dir: 'asc' }, value).map((r) => r.id)).toEqual(['c', 'a', 'd', 'b']);
    expect(sortRows(rows, { column: 'n', dir: 'desc' }, value).map((r) => r.id)).toEqual(['b', 'a', 'd', 'c']);
  });
  it('is stable and puts empty values last both ways', () => {
    expect(sortRows(rows, { column: 'due', dir: 'asc' }, value).map((r) => r.id)).toEqual(['c', 'a', 'b', 'd']);
    expect(sortRows(rows, { column: 'due', dir: 'desc' }, value).map((r) => r.id)).toEqual(['a', 'c', 'b', 'd']);
  });
  it('never changes the list it was given', () => {
    const copy = [...rows];
    sortRows(rows, { column: 'title', dir: 'desc' }, value);
    expect(rows).toEqual(copy);
  });
});

describe('dueMatches', () => {
  const ctx = { today: '2026-11-05', weekStart: '2026-11-01', weekEnd: '2026-11-07' };
  it('Overdue only for late work', () => {
    expect(dueMatches({ dueKey: '2026-11-01', late: true }, 'overdue', ctx)).toBe(true);
    expect(dueMatches({ dueKey: '2026-11-01', late: false }, 'overdue', ctx)).toBe(false);
  });
  it('Today, This week (the calendar week) and No date', () => {
    expect(dueMatches({ dueKey: '2026-11-05', late: false }, 'today', ctx)).toBe(true);
    expect(dueMatches({ dueKey: '2026-11-06', late: false }, 'today', ctx)).toBe(false);
    expect(dueMatches({ dueKey: '2026-11-01', late: true }, 'week', ctx)).toBe(true);
    expect(dueMatches({ dueKey: '2026-11-08', late: false }, 'week', ctx)).toBe(false);
    expect(dueMatches({ dueKey: null, late: false }, 'none', ctx)).toBe(true);
    expect(dueMatches({ dueKey: '2026-11-08', late: false }, 'none', ctx)).toBe(false);
    expect(dueMatches({ dueKey: null, late: false }, '', ctx)).toBe(true);
  });
});

describe('tableFiltersActive', () => {
  it('is false for the empty filters and true for any one of them', () => {
    expect(tableFiltersActive(EMPTY_TABLE_FILTERS)).toBe(false);
    expect(tableFiltersActive({ ...EMPTY_TABLE_FILTERS, text: '  ' })).toBe(false);
    expect(tableFiltersActive({ ...EMPTY_TABLE_FILTERS, priority: 'HIGH' })).toBe(true);
  });
});

describe('remembering a table per person per page', () => {
  beforeEach(() => localStorage.clear());

  it('reads nothing as the defaults', () => {
    expect(readTableMemory('u1', 'board')).toEqual({ sort: null, filters: EMPTY_TABLE_FILTERS, shown: null });
    expect(readTableMemory(undefined, 'board')).toEqual({ sort: null, filters: EMPTY_TABLE_FILTERS, shown: null });
  });
  it('writes under the person’s own key and reads it back', () => {
    const memory = { sort: { column: 'due', dir: 'desc' as const }, filters: { ...EMPTY_TABLE_FILTERS, status: 'TODO' }, shown: ['start'] };
    writeTableMemory('u1', 'board', memory);
    expect(localStorage.getItem(userStorageKey('u1', 'table.board'))).not.toBeNull();
    expect(readTableMemory('u1', 'board')).toEqual(memory);
    // Another person, or another page, starts afresh.
    expect(readTableMemory('u2', 'board').sort).toBeNull();
    expect(readTableMemory('u1', 'meeting').sort).toBeNull();
  });
  it('ignores a damaged entry', () => {
    localStorage.setItem(userStorageKey('u1', 'table.board'), '{not json');
    expect(readTableMemory('u1', 'board')).toEqual({ sort: null, filters: EMPTY_TABLE_FILTERS, shown: null });
    localStorage.setItem(userStorageKey('u1', 'table.board'), JSON.stringify({ sort: { column: 3, dir: 'up' }, filters: { text: 5 }, shown: 'x' }));
    expect(readTableMemory('u1', 'board')).toEqual({ sort: null, filters: EMPTY_TABLE_FILTERS, shown: null });
  });
});

describe('saveFailureText: the site’s plain error', () => {
  it('names the server’s reason', () => {
    expect(saveFailureText(new ApiError(400, 'VALIDATION', 'That topic is not on this meeting’s agenda.'))).toBe('Couldn’t save — That topic is not on this meeting’s agenda.');
  });
  it('says permission, conflict, connection or try again', () => {
    expect(saveFailureText(new ApiError(403, 'FORBIDDEN', 'nope'))).toBe('Couldn’t save — you don’t have permission to do that.');
    expect(saveFailureText(new ApiError(409, 'VERSION_CONFLICT', 'x'))).toBe('Couldn’t save — someone else changed it meanwhile. Try again.');
    expect(saveFailureText(new TypeError('Failed to fetch'))).toBe('Couldn’t save — check your connection and try again.');
    expect(saveFailureText(new ApiError(500, 'INTERNAL', 'Request failed'))).toBe('Couldn’t save — please try again.');
  });
});

it('shows a hundred rows at a time', () => {
  expect(PAGE_SIZE).toBe(100);
});
