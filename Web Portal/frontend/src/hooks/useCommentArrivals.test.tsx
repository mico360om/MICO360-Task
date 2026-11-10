import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useCommentArrivals } from './useCommentArrivals';
import { FRESH_FOR_MS } from '../lib/comment-feed';

type Props = { ids: string[]; ready?: boolean; away?: boolean };
const names: Record<string, string> = { c2: 'Omar Ahmed', c3: 'Sara Ali', c4: 'Sara Ali' };

function setup(initial: Props) {
  const state = { away: initial.away ?? false };
  const hook = renderHook(
    ({ ids, ready }: Props) =>
      useCommentArrivals({ ids, ready: ready ?? true, mine: (id) => id.startsWith('me'), isAway: () => state.away, nameOf: (id) => names[id] }),
    { initialProps: initial },
  );
  return { ...hook, state };
}

afterEach(() => vi.useRealTimers());

describe('useCommentArrivals', () => {
  it('takes the first list as read: nothing held, nothing highlighted', () => {
    const { result } = setup({ ids: ['c1', 'c2'] });
    expect(result.current.held.size).toBe(0);
    expect(result.current.fresh.size).toBe(0);
    expect(result.current.announcement).toBe('');
  });

  it('waits for the list to load before taking it as read', () => {
    const { result, rerender } = setup({ ids: [], ready: false });
    rerender({ ids: ['c1', 'c2'], ready: true });
    expect(result.current.fresh.size).toBe(0);
    expect(result.current.held.size).toBe(0);
  });

  it('shows someone else’s new comment at once, highlighted for a few seconds, and says so', () => {
    vi.useFakeTimers();
    const { result, rerender } = setup({ ids: ['c1'] });
    rerender({ ids: ['c2', 'c1'] });
    expect([...result.current.fresh]).toEqual(['c2']);
    expect(result.current.held.size).toBe(0);
    expect(result.current.announcement).toBe('New comment from Omar Ahmed');
    act(() => vi.advanceTimersByTime(FRESH_FOR_MS + 50));
    expect(result.current.fresh.size).toBe(0);
  });

  it('never holds or highlights my own new comment', () => {
    const { result, rerender, state } = setup({ ids: ['c1'] });
    state.away = true;
    rerender({ ids: ['me1', 'c1'] });
    expect(result.current.held.size).toBe(0);
    expect(result.current.fresh.size).toBe(0);
    expect([...result.current.arrived]).toEqual(['me1']);
  });

  it('holds new comments while the reader is further down, counts them, and shows them when asked', () => {
    const { result, rerender, state } = setup({ ids: ['c1'] });
    state.away = true;
    rerender({ ids: ['c2', 'c1'] });
    rerender({ ids: ['c3', 'c2', 'c1'] });
    expect([...result.current.held]).toEqual(['c2', 'c3']);
    expect(result.current.announcement).toBe('2 new comments above');
    act(() => result.current.reveal());
    expect(result.current.held.size).toBe(0);
    expect([...result.current.fresh].sort()).toEqual(['c2', 'c3']);
  });

  it('forgets a held comment that was deleted meanwhile', () => {
    const { result, rerender, state } = setup({ ids: ['c1'] });
    state.away = true;
    rerender({ ids: ['c3', 'c2', 'c1'] });
    rerender({ ids: ['c3', 'c1'] });
    expect([...result.current.held]).toEqual(['c3']);
    expect(result.current.announcement).toBe('1 new comment above');
  });

  it('shows the held ones by itself once the reader scrolls back to the top', () => {
    const { result, rerender, state } = setup({ ids: ['c1'] });
    state.away = true;
    rerender({ ids: ['c2', 'c1'] });
    expect(result.current.held.size).toBe(1);
    act(() => {
      document.dispatchEvent(new Event('scroll'));
    });
    expect(result.current.held.size).toBe(1); // still away
    state.away = false;
    act(() => {
      document.dispatchEvent(new Event('scroll'));
    });
    expect(result.current.held.size).toBe(0);
    expect([...result.current.fresh]).toEqual(['c2']);
  });

  it('decides once per comment (a re-render doesn’t move a shown comment into the held ones)', () => {
    const { result, rerender, state } = setup({ ids: ['c1'] });
    rerender({ ids: ['c2', 'c1'] });
    state.away = true;
    rerender({ ids: ['c2', 'c1'] });
    expect(result.current.held.size).toBe(0);
  });
});
