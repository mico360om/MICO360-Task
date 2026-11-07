import { describe, expect, it } from 'vitest';
import { completionOf, DEFAULT_WEIGHTS, effectiveWeight, weightDefaultsOf, WEIGHT_MAX, WEIGHT_MIN } from './completion';

describe('task weight (1.23.5)', () => {
  it('a task without its own weight takes its project’s default for its priority', () => {
    const d = { URGENT: 5, HIGH: 4, NORMAL: 2, LOW: 1 };
    expect(effectiveWeight({ weight: null, priority: 'URGENT' }, d)).toBe(5);
    expect(effectiveWeight({ weight: null, priority: 'HIGH' }, d)).toBe(4);
    expect(effectiveWeight({ weight: null, priority: 'NORMAL' }, d)).toBe(2);
    expect(effectiveWeight({ weight: null, priority: 'LOW' }, d)).toBe(1);
  });

  it('its own weight wins over the default', () => {
    expect(effectiveWeight({ weight: 9, priority: 'LOW' }, DEFAULT_WEIGHTS)).toBe(9);
  });

  it('the defaults start at Urgent 4, High 3, Normal 2, Low 1 and points run 1–10', () => {
    expect(DEFAULT_WEIGHTS).toEqual({ URGENT: 4, HIGH: 3, NORMAL: 2, LOW: 1 });
    expect([WEIGHT_MIN, WEIGHT_MAX]).toEqual([1, 10]);
  });

  it('reads a project’s four stored defaults', () => {
    expect(weightDefaultsOf({ weightUrgent: 8, weightHigh: 6, weightNormal: 3, weightLow: 1 })).toEqual({ URGENT: 8, HIGH: 6, NORMAL: 3, LOW: 1 });
  });
});

describe('completion (1.23.5)', () => {
  const figures = { total: 10, done: 7, weightTotal: 40, weightDone: 25 };

  it('by number of tasks: finished ÷ all live tasks', () => {
    expect(completionOf(figures, 'COUNT')).toEqual({ mode: 'COUNT', pct: 70, countPct: 70, weightPct: 63 });
  });

  it('by weight: finished weight ÷ total weight, the count shown beside it', () => {
    expect(completionOf(figures, 'WEIGHT')).toEqual({ mode: 'WEIGHT', pct: 63, countPct: 70, weightPct: 63 });
  });

  it('a project without tasks is 0%, either way', () => {
    expect(completionOf({ total: 0, done: 0, weightTotal: 0, weightDone: 0 }, 'WEIGHT').pct).toBe(0);
    expect(completionOf({ total: 0, done: 0, weightTotal: 0, weightDone: 0 }, 'COUNT').pct).toBe(0);
  });

  it('never goes past 100 or below 0 on odd figures', () => {
    expect(completionOf({ total: 2, done: 3, weightTotal: 4, weightDone: 9 }, 'WEIGHT')).toMatchObject({ pct: 100, countPct: 100 });
    expect(completionOf({ total: 2, done: -1, weightTotal: 4, weightDone: -2 }, 'WEIGHT')).toMatchObject({ pct: 0, countPct: 0 });
  });
});

describe('completion never reads 100% before everything is done (review, re-graded)', () => {
  it('199 of 200 is 99%, by number and by weight; 100% only once all is finished', () => {
    expect(completionOf({ total: 200, done: 199, weightTotal: 1000, weightDone: 998 }, 'WEIGHT')).toEqual({ mode: 'WEIGHT', pct: 99, countPct: 99, weightPct: 99 });
    expect(completionOf({ total: 3, done: 3, weightTotal: 9, weightDone: 9 }, 'WEIGHT')).toMatchObject({ pct: 100, countPct: 100 });
  });
});
