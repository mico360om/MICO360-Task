import { describe, it, expect } from 'vitest';
import { ApiError, NetworkError } from './api-client';
import { completionBars, ownerChangeProblem, projectDates, reportTotals, statusChangeProblem } from './project-list';

// Stage 2: the Projects page's card rules (figures, labels, the empty texts, the status request) are
// the website's own, in lib/projects-page.ts and lib/project-status.ts (tested there); what is left
// here is a project's dates, the change problems and the Dashboard's totals.

describe('a project’s dates', () => {
  it('writes its dates as start → target', () => {
    expect(projectDates('2026-10-01T00:00:00.000Z', '2026-12-15T00:00:00.000Z')).toBe('1 Oct 2026 → 15 Dec 2026');
    expect(projectDates(null, '2026-12-15', 'Asia/Muscat')).toBe('— → 15 Dec 2026');
    expect(projectDates(null, null)).toBeNull();
  });
});

describe('changing a project', () => {
  it('says plainly why the owner didn’t change, in the website’s words', () => {
    expect(ownerChangeProblem(new ApiError(403, 'FORBIDDEN', 'Insufficient role'))).toBe('Only this project’s owner, its managers or an administrator can change it.');
    expect(ownerChangeProblem(new NetworkError('offline'))).toBe('You’re offline — the owner can be changed when you’re connected.');
    expect(ownerChangeProblem(new ApiError(500, 'ERROR', 'Request failed (500)'))).toBe('Couldn’t change the owner. Please try again.');
  });

  it('says plainly why the status didn’t change', () => {
    expect(statusChangeProblem(new NetworkError('offline'))).toBe('You’re offline — the status can be changed when you’re connected.');
    expect(statusChangeProblem(new ApiError(403, 'FORBIDDEN', 'Insufficient role'))).toBe('Insufficient role');
    expect(statusChangeProblem(new ApiError(500, 'ERROR', 'Request failed (500)'))).toBe('Couldn’t change the status. Please try again.');
  });
});

describe('the Dashboard for administrators: all projects’ totals, as the website shows them', () => {
  const rows = [
    { projectId: 'a', projectName: 'Alpha', total: 10, completed: 7, overdue: 1, completionPct: 70 },
    { projectId: 'b', projectName: 'Beta', total: 6, completed: 2, overdue: 3, completionPct: 33 },
    { projectId: 'c', projectName: 'Gamma', total: 4, completed: 2, overdue: 0, completionPct: 50 },
  ];

  it('adds up all tasks, the completed ones and the overdue ones', () => {
    expect(reportTotals(rows)).toEqual({ total: 20, completed: 11, overdue: 4 });
    expect(reportTotals([])).toEqual({ total: 0, completed: 0, overdue: 0 });
  });

  it('colours each project’s completion by how healthy it is', () => {
    expect(completionBars(rows)).toEqual([
      { id: 'a', label: 'Alpha', pct: 70, tone: 'success' },
      { id: 'b', label: 'Beta', pct: 33, tone: 'danger' },
      { id: 'c', label: 'Gamma', pct: 50, tone: 'warning' },
    ]);
  });
});

it('the Projects page sends one request for every card, never one per project', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const queries = readFileSync(resolve(__dirname, '../core/project-queries.ts'), 'utf8');
  const screen = readFileSync(resolve(__dirname, '../screens/ProjectsScreen.tsx'), 'utf8');
  expect(queries).not.toMatch(/useQueries/);
  expect(screen).not.toMatch(/useProjectsProgress|useProjectCardFigures/);
  expect(screen).toMatch(/useProjectsOverview\(\)/);
});
