import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useRowEdits, useTableMemory } from './hooks';
import { useAuthStore } from '../../stores/auth-store';
import { readTableMemory } from '../../lib/data-table';
import { ApiError } from '../../lib/api-client';

beforeEach(() => {
  localStorage.clear();
  useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: [] }, accessToken: 'at', refreshToken: 'rt' });
});

describe('useTableMemory', () => {
  it('starts with the default columns, and remembers sort, filters and columns for the page', () => {
    const { result, unmount } = renderHook(() => useTableMemory('board', { shown: ['start'] }));
    expect(result.current.shown).toEqual(['start']);
    expect(result.current.sort).toBeNull();
    act(() => result.current.setSort({ column: 'due', dir: 'desc' }));
    act(() => result.current.setFilters({ ...result.current.filters, priority: 'HIGH' }));
    act(() => result.current.setShown(['tags']));
    unmount();
    expect(readTableMemory('u1', 'board')).toEqual({ sort: { column: 'due', dir: 'desc' }, filters: { text: '', status: '', person: '', priority: 'HIGH', due: '' }, shown: ['tags'] });
    const again = renderHook(() => useTableMemory('board', { shown: ['start'] }));
    expect(again.result.current.sort).toEqual({ column: 'due', dir: 'desc' });
    expect(again.result.current.filters.priority).toBe('HIGH');
    expect(again.result.current.shown).toEqual(['tags']);
  });
});

describe('useTableMemory without remembering', () => {
  it('neither reads nor writes (a page that keeps the table’s state itself)', () => {
    localStorage.setItem('mico360.u.u1.table.mytasks', JSON.stringify({ sort: { column: 'title', dir: 'asc' }, filters: {}, shown: ['tags'] }));
    const { result } = renderHook(() => useTableMemory('mytasks', { shown: [] }, { remember: false }));
    expect(result.current.sort).toBeNull();
    expect(result.current.shown).toEqual([]);
    act(() => result.current.setShown(['start']));
    expect(JSON.parse(localStorage.getItem('mico360.u.u1.table.mytasks')!).shown).toEqual(['tags']);
  });
});

interface Row {
  id: string;
  title: string;
  priority: string;
}

describe('useRowEdits: a quick edit shows at once and rolls back if refused', () => {
  const row: Row = { id: 'a', title: 'Old', priority: 'LOW' };

  it('shows the change at once, keeps what the server confirms', async () => {
    const { result } = renderHook(() => useRowEdits<Row>());
    let finish!: (v: Partial<Row>) => void;
    let done!: Promise<boolean>;
    act(() => {
      done = result.current.edit('a', row, { title: 'New' }, () => new Promise((r) => (finish = r)));
    });
    expect(result.current.apply([row], (r) => r.id)[0]!.title).toBe('New');
    await act(async () => {
      finish({ title: 'New (saved)' });
      expect(await done).toBe(true);
    });
    expect(result.current.apply([row], (r) => r.id)[0]!.title).toBe('New (saved)');
    expect(result.current.error).toBeNull();
  });

  it('puts the old value back and says why when the server refuses', async () => {
    const { result } = renderHook(() => useRowEdits<Row>());
    await act(async () => {
      const ok = await result.current.edit('a', row, { priority: 'HIGH' }, () => Promise.reject(new ApiError(403, 'FORBIDDEN', 'no')));
      expect(ok).toBe(false);
    });
    expect(result.current.apply([row], (r) => r.id)[0]!.priority).toBe('LOW');
    expect(result.current.error).toBe('Couldn’t save — you don’t have permission to do that.');
    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });

  it('a refused edit leaves another field’s pending edit alone', async () => {
    const { result } = renderHook(() => useRowEdits<Row>());
    let failTitle!: (e: unknown) => void;
    act(() => {
      void result.current.edit('a', row, { title: 'New' }, () => new Promise((_, rej) => (failTitle = rej)));
      void result.current.edit('a', row, { priority: 'HIGH' }, () => new Promise(() => {}));
    });
    await act(async () => {
      failTitle(new TypeError('Failed to fetch'));
      await Promise.resolve();
    });
    const shown = result.current.apply([row], (r) => r.id)[0]!;
    expect(shown.title).toBe('Old');
    expect(shown.priority).toBe('HIGH');
  });

  it('lets go once fresh data for the row arrives', async () => {
    const { result } = renderHook(() => useRowEdits<Row>());
    await act(async () => {
      await result.current.edit('a', row, { title: 'New' }, () => Promise.resolve());
    });
    const fresh: Row = { id: 'a', title: 'Changed by someone else', priority: 'LOW' };
    expect(result.current.apply([fresh], (r) => r.id)[0]!.title).toBe('Changed by someone else');
  });

  it('an older save’s answer doesn’t overwrite a newer edit of the same field', async () => {
    const { result } = renderHook(() => useRowEdits<Row>());
    let first!: (v: Partial<Row>) => void;
    act(() => {
      void result.current.edit('a', row, { priority: 'HIGH' }, () => new Promise((r) => (first = r)));
      void result.current.edit('a', row, { priority: 'URGENT' }, () => new Promise(() => {}));
    });
    await act(async () => {
      first({ priority: 'HIGH' });
      await Promise.resolve();
    });
    expect(result.current.apply([row], (r) => r.id)[0]!.priority).toBe('URGENT');
  });
});
