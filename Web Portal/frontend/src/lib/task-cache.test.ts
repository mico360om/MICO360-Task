import { describe, it, expect } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { invalidateTaskQueries } from './task-cache';
import { PROJECTS_OVERVIEW_KEY } from '../api/projects';
import { timelineKey, workloadKey } from '../api/planning';

describe('invalidateTaskQueries', () => {
  it('refreshes the Projects page’s figures after any task change, but not the plain project lists', async () => {
    const qc = new QueryClient();
    qc.setQueryData([...PROJECTS_OVERVIEW_KEY], []);
    qc.setQueryData(['projects'], []);
    qc.setQueryData(['board', 'p1'], []);
    await invalidateTaskQueries(qc);
    expect(qc.getQueryState([...PROJECTS_OVERVIEW_KEY])?.isInvalidated).toBe(true);
    expect(qc.getQueryState(['board', 'p1'])?.isInvalidated).toBe(true);
    // The Timeline and Workload pages count tasks too.
    qc.setQueryData([...timelineKey('2026-10-05', '2027-01-03', 1, '2026-10-24')], {});
    qc.setQueryData([...workloadKey('2026-10-25', '', '2026-10-24')], {});
    await invalidateTaskQueries(qc);
    expect(qc.getQueryState([...timelineKey('2026-10-05', '2027-01-03', 1, '2026-10-24')])?.isInvalidated).toBe(true);
    expect(qc.getQueryState([...workloadKey('2026-10-25', '', '2026-10-24')])?.isInvalidated).toBe(true);
    // A task change doesn't change the projects themselves.
    expect(qc.getQueryState(['projects'])?.isInvalidated).toBe(false);
  });
});

describe('the planning pages’ data', () => {
  it('the Timeline is read again when any project is saved (it sits under projects), and when the company day changes (a new key)', async () => {
    const qc = new QueryClient();
    qc.setQueryData([...timelineKey('2026-10-05', '2027-01-03', 1, '2026-10-24')], {});
    await qc.invalidateQueries({ queryKey: ['projects'] });
    expect(qc.getQueryState([...timelineKey('2026-10-05', '2027-01-03', 1, '2026-10-24')])?.isInvalidated).toBe(true);
    expect(timelineKey('2026-10-05', '2027-01-03', 1, '2026-10-25')).not.toEqual(timelineKey('2026-10-05', '2027-01-03', 1, '2026-10-24'));
    expect(workloadKey('2026-10-25', '', '2026-10-25')).not.toEqual(workloadKey('2026-10-25', '', '2026-10-24'));
  });
});
