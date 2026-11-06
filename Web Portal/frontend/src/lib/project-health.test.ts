import { describe, expect, it } from 'vitest';
import { completionText, countsByWeight, effectiveWeight, healthSummary, projectCompletion, projectWeights, weightChoices, WEIGHT_DEFAULTS } from './project-health';

describe('task weight on the website (1.23.5)', () => {
  it('a project’s defaults by priority (an older server sends none: 4/3/2/1)', () => {
    expect(projectWeights({})).toEqual(WEIGHT_DEFAULTS);
    expect(projectWeights({ weightUrgent: 8, weightHigh: 5, weightNormal: 3, weightLow: 1 })).toEqual({ URGENT: 8, HIGH: 5, NORMAL: 3, LOW: 1 });
  });

  it('a task counts its own weight, else its project’s default for its priority', () => {
    expect(effectiveWeight({ weight: null, priority: 'HIGH' }, {})).toBe(3);
    expect(effectiveWeight({ weight: 9, priority: 'LOW' }, {})).toBe(9);
    expect(effectiveWeight({ priority: 'URGENT' }, { weightUrgent: 6 })).toBe(6);
  });

  it('only a project that counts by weight shows weights', () => {
    expect(countsByWeight({ completionMode: 'WEIGHT' })).toBe(true);
    expect(countsByWeight({ completionMode: 'COUNT' })).toBe(false);
    expect(countsByWeight({})).toBe(false);
    expect(countsByWeight(null)).toBe(false);
  });

  it('the choices: the default (named with its points), then 1–10', () => {
    const c = weightChoices(3);
    expect(c[0]).toEqual({ value: '', label: 'Default (3)' });
    expect(c.slice(1).map((o) => o.value)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
    expect(c[1]!.label).toBe('1 point');
    expect(c[2]!.label).toBe('2 points');
  });
});

describe('completion in words', () => {
  it('by weight, with the count beside it; by number as before', () => {
    expect(completionText({ mode: 'WEIGHT', pct: 62, countPct: 70, weightPct: 62 })).toBe('62% by weight · 70% by count');
    expect(completionText({ mode: 'COUNT', pct: 70, countPct: 70, weightPct: 62 })).toBe('70% done');
  });
});

describe('the health badge for screen readers and on hover', () => {
  it('the mark and every reason', () => {
    expect(healthSummary({ rag: 'AMBER', reasons: [{ code: 'BLOCKED', level: 'AMBER', text: '1 task blocked for over 7 days' }, { code: 'LATE_TASKS', level: 'AMBER', text: '2 late tasks' }] })).toBe(
      'Health: Amber — 1 task blocked for over 7 days; 2 late tasks',
    );
    expect(healthSummary({ rag: 'GREEN', reasons: [{ code: 'ON_TRACK', level: 'GREEN', text: 'On track' }] })).toBe('Health: Green — On track');
  });
});

describe('a project’s completion from its tasks (the project page, live)', () => {
  const t = (done: boolean, priority: 'URGENT' | 'HIGH' | 'NORMAL' | 'LOW', weight: number | null = null) => ({ columnCategory: done ? 'DONE' : 'TODO', completedAt: null, priority, weight });
  const tasks = [t(true, 'URGENT'), t(true, 'NORMAL', 10), t(false, 'LOW'), t(false, 'HIGH')];

  it('both ways, the project’s own mode first', () => {
    expect(projectCompletion(tasks, { completionMode: 'WEIGHT' })).toEqual({ mode: 'WEIGHT', pct: 78, countPct: 50, weightPct: 78 });
    expect(projectCompletion(tasks, {})).toEqual({ mode: 'COUNT', pct: 50, countPct: 50, weightPct: 78 });
    expect(projectCompletion([], { completionMode: 'WEIGHT' })).toEqual({ mode: 'WEIGHT', pct: 0, countPct: 0, weightPct: 0 });
  });
});
