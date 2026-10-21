import { describe, it, expect } from 'vitest';
import { ApiError, NetworkError } from './api-client';
import { adminTotals, completionBars, emptyProjects, projectCardLabel, projectCardMeta, projectDates, projectsSubtitle, statusChangeProblem, statusChangeRequest } from './project-list';
import type { ApiProject } from './types';

const project = (patch: Partial<ApiProject> = {}): ApiProject => ({
  id: 'p1',
  code: 'RIG',
  number: 'PDO-14',
  name: 'Rig Inspection',
  description: null,
  status: 'ON_HOLD',
  clientName: 'PDO',
  ...patch,
});

describe('a project’s card', () => {
  it('shows progress only once the project has tasks', () => {
    expect(projectCardMeta({ total: 12, completed: 5, inProgress: 2, todo: 5, overdue: 3, completionPct: 42, byCategory: {} }, 'Omar Said')).toEqual({ total: 12, overdue: 3, completedPct: 42, hasProgress: true, ownerName: 'Omar Said' });
    expect(projectCardMeta({ total: 0, completed: 0, inProgress: 0, todo: 0, overdue: 0, completionPct: 0, byCategory: {} }, null)).toMatchObject({ hasProgress: false, ownerName: null });
    expect(projectCardMeta(undefined, null)).toBeNull();
  });

  it('writes its dates as start → target', () => {
    expect(projectDates('2026-10-01T00:00:00.000Z', '2026-12-15T00:00:00.000Z', 'en-US')).toBe('Oct 1 → Dec 15');
    expect(projectDates(null, '2026-12-15', 'en-US')).toBe('— → Dec 15');
    expect(projectDates(null, null, 'en-US')).toBeNull();
  });

  it('reads everything the card shows to TalkBack', () => {
    const meta = projectCardMeta({ total: 12, completed: 5, inProgress: 2, todo: 5, overdue: 3, completionPct: 42, byCategory: {} }, 'Omar Said');
    expect(projectCardLabel(project(), meta, 'Oct 1 → Dec 15')).toBe('Rig Inspection, RIG, project number PDO-14, On hold, PDO, 42% done, 12 tasks, 3 overdue, Oct 1 → Dec 15, owner Omar Said');
    expect(projectCardLabel(project({ number: null, clientName: null, status: 'ACTIVE' }), null, null)).toBe('Rig Inspection, RIG, Active, Internal');
  });

  it('says who the list is for', () => {
    expect(projectsSubtitle(true)).toBe('Create, browse and manage your projects.');
    expect(projectsSubtitle(false)).toBe('Browse and open the projects you have access to.');
    expect(emptyProjects(true)).toEqual({ title: 'No projects yet', subtitle: 'Create your first project with “New project”.' });
    expect(emptyProjects(false)).toEqual({ title: 'No projects yet', subtitle: 'Projects you can access will appear here.' });
  });
});

describe('changing a project’s status (administrators)', () => {
  it('archives through the archive action, and changes any other status as an edit', () => {
    expect(statusChangeRequest('ARCHIVED')).toBe('archive');
    expect(statusChangeRequest('ACTIVE')).toBe('update');
  });

  it('says plainly why it didn’t change', () => {
    expect(statusChangeProblem(new NetworkError('offline'))).toBe('You’re offline — the status can be changed when you’re connected.');
    expect(statusChangeProblem(new ApiError(403, 'FORBIDDEN', 'Insufficient role'))).toBe('Insufficient role');
    expect(statusChangeProblem(new ApiError(500, 'ERROR', 'Request failed (500)'))).toBe('Couldn’t change the status. Please try again.');
  });
});

describe('Home for administrators: all projects’ totals, as the website shows them', () => {
  const rows = [
    { projectId: 'a', projectName: 'Alpha', total: 10, completed: 7, overdue: 1, completionPct: 70 },
    { projectId: 'b', projectName: 'Beta', total: 6, completed: 2, overdue: 3, completionPct: 33 },
    { projectId: 'c', projectName: 'Gamma', total: 4, completed: 2, overdue: 0, completionPct: 50 },
  ];

  it('adds up all tasks and the overdue ones', () => {
    expect(adminTotals(rows)).toEqual([
      { key: 'all', label: 'All tasks', value: 20, hint: '11 completed', tone: 'success' },
      { key: 'overdue', label: 'Overdue', value: 4, hint: '20% of tasks', tone: 'danger' },
    ]);
    expect(adminTotals([])[1]!.hint).toBeUndefined();
  });

  it('colours each project’s completion by how healthy it is', () => {
    expect(completionBars(rows)).toEqual([
      { id: 'a', label: 'Alpha', pct: 70, tone: 'success' },
      { id: 'b', label: 'Beta', pct: 33, tone: 'danger' },
      { id: 'c', label: 'Gamma', pct: 50, tone: 'warning' },
    ]);
  });
});
