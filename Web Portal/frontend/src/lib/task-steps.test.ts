import { describe, it, expect, beforeEach } from 'vitest';
import { stepsAt, useTaskSteps } from './task-steps';

describe('stepsAt — where a task is in the list it was opened from', () => {
  const ids = ['a', 'b', 'c', 'd'];
  it('says its place, and the tasks before and after it', () => {
    expect(stepsAt(ids, 'c')).toEqual({ position: 3, total: 4, previous: 'b', next: 'd' });
  });
  it('has nothing before the first or after the last', () => {
    expect(stepsAt(ids, 'a')).toEqual({ position: 1, total: 4, previous: null, next: 'b' });
    expect(stepsAt(ids, 'd')).toEqual({ position: 4, total: 4, previous: 'c', next: null });
  });
  it('a task not in the list, an empty list or a list of one: no stepping', () => {
    expect(stepsAt(ids, 'z')).toBeNull();
    expect(stepsAt([], 'a')).toBeNull();
    expect(stepsAt(null, 'a')).toBeNull();
    expect(stepsAt(['a'], 'a')).toBeNull();
  });
  it('a task listed twice (a repeat shown on two days) counts once, where it first appears', () => {
    expect(stepsAt(['a', 'b', 'a', 'c'], 'c')).toEqual({ position: 3, total: 3, previous: 'b', next: null });
  });
});

describe('useTaskSteps — the list the open task came from', () => {
  beforeEach(() => useTaskSteps.getState().clear());
  it('keeps the list a page opened the task from, with that page', () => {
    useTaskSteps.getState().open(['a', 'b'], '/board');
    expect(useTaskSteps.getState()).toMatchObject({ ids: ['a', 'b'], path: '/board', stepped: null });
  });
  it('remembers which way the person stepped (so focus stays on that button)', () => {
    useTaskSteps.getState().open(['a', 'b'], '/board');
    useTaskSteps.getState().step('next');
    expect(useTaskSteps.getState().stepped).toBe('next');
    useTaskSteps.getState().open(null, '/board');
    expect(useTaskSteps.getState()).toMatchObject({ ids: null, stepped: null });
  });
});
