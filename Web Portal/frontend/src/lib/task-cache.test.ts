import { describe, it, expect } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { invalidateTaskQueries } from './task-cache';
import { PROJECTS_OVERVIEW_KEY } from '../api/projects';

describe('invalidateTaskQueries', () => {
  it('refreshes the Projects page’s figures after any task change, but not the plain project lists', async () => {
    const qc = new QueryClient();
    qc.setQueryData([...PROJECTS_OVERVIEW_KEY], []);
    qc.setQueryData(['projects'], []);
    qc.setQueryData(['board', 'p1'], []);
    await invalidateTaskQueries(qc);
    expect(qc.getQueryState([...PROJECTS_OVERVIEW_KEY])?.isInvalidated).toBe(true);
    expect(qc.getQueryState(['board', 'p1'])?.isInvalidated).toBe(true);
    // A task change doesn't change the projects themselves.
    expect(qc.getQueryState(['projects'])?.isInvalidated).toBe(false);
  });
});
