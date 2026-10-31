import { describe, it, expect } from 'vitest';
import {
  DASHBOARD_ACTION_LABEL,
  DASHBOARD_TEXT,
  FIRST_STEPS_TEXT,
  TILE_FAILED,
  activityRows,
  approvalsCardView,
  dashboardActionLabel,
  dashboardActionTone,
  dashboardTiles,
  dueMeta,
  dueSoonRows,
  isFirstDay,
  timeAgo,
  weekHint,
  welcomeBand,
} from './dashboard';
import { reportTotals } from './project-list';
import type { ApiActivityRow } from './activity-page';
import type { ApiTask, ApprovalTask } from './types';
import { hasWeb, readWeb } from '../testing/web-source';

/** Wed 28 Oct 2026, 10:00 in Muscat. */
const NOW = new Date('2026-10-28T06:00:00Z');
const TZ = 'Asia/Muscat';

const task = (o: Partial<ApiTask> = {}): ApiTask => ({
  id: 't1', key: 'RIG-4', title: 'Pressure test', description: null, projectId: 'p1', columnId: 'c1', position: 0,
  priority: 'NORMAL', startDate: null, dueDate: null, estimatedHours: null, progress: 0, completedAt: null, columnCategory: 'TODO', ...o,
});

/** An ApprovalTask `t${i}` in project Rig, finished by Sara Ali at 06:00 UTC on 28 Oct. */
const approvalTask = (i: number): ApprovalTask => ({
  ...task({ id: `t${i}`, key: `RIG-${i}`, title: `Task ${i}`, columnCategory: 'REVIEW', approvalRequestedAt: '2026-10-28T06:00:00Z' }),
  project: { id: 'p1', code: 'RIG', name: 'Rig', color: null, icon: null, imageUrl: null },
  requestedBy: { id: 'u2', name: 'Sara Ali' },
});

describe('the four tiles', () => {
  it('Review Focus 4: an administrator’s All tasks and Overdue are the server’s report totals', () => {
    const rows = [{ projectId: 'p1', projectName: 'Rig', total: 40, completed: 25, overdue: 3, completionPct: 63 }, { projectId: 'p2', projectName: 'Ops', total: 10, completed: 10, overdue: 0, completionPct: 100 }];
    expect(reportTotals(rows)).toEqual({ total: 50, completed: 35, overdue: 3 });
    expect(dashboardTiles({ isAdmin: true, myTasks: [1, 2], projects: [1], reportRows: rows }).map((t) => [t.label, t.value, t.hint])).toEqual([['My tasks', '2', 'Assigned to you'], ['Projects', '1', 'Active workspaces'], ['All tasks', '50', '35 completed'], ['Overdue', '3', '6% of tasks']]);
    expect(dashboardTiles({ isAdmin: true, myTasks: [], projects: [], reportRows: [] })[3]).toMatchObject({ value: '0', hint: 'No tasks yet' });
    expect(dashboardTiles({ isAdmin: true, myTasks: [], projects: [] }).slice(2).map((t) => [t.value, t.hint])).toEqual([['—', undefined], ['—', undefined]]);
  });

  it('everyone else: My tasks, Projects, Overdue, Due this week; "—" until loaded', () => {
    const mine = { overdue: 2, dueThisWeek: 0, today: '2026-10-28', weekEnd: '2026-10-31' };
    expect(dashboardTiles({ isAdmin: false, myTasks: [1], projects: [1, 2], mine }).map((t) => [t.label, t.value, t.hint, t.to])).toEqual([['My tasks', '1', 'Assigned to you', { tab: 'MyTasks' }], ['Projects', '2', 'Active workspaces', { tab: 'Projects' }], ['Overdue', '2', 'Past their due day', { tab: 'MyTasks' }], ['Due this week', '0', 'Today – Sat 31 Oct', { tab: 'MyTasks' }]]);
    expect(dashboardTiles({ isAdmin: false }).map((t) => [t.value, t.hint])).toEqual([['—', undefined], ['—', undefined], ['—', undefined], ['—', undefined]]);
    expect(dashboardTiles({ isAdmin: false, mine: { ...mine, overdue: 0 } })[2]!.hint).toBe('Nothing late');
    expect(weekHint({ ...mine, weekEnd: '2026-10-28' })).toBe('Today, the week’s last day');
  });

  it('each tile’s tone, drawn icon and page, as the website’s', () => {
    expect(dashboardTiles({ isAdmin: true }).map((t) => [t.key, t.tone, t.icon, t.to])).toEqual([
      ['myTasks', 'brand', 'misc.tasks', { tab: 'MyTasks' }],
      ['projects', 'info', 'nav.projects', { tab: 'Projects' }],
      ['allTasks', 'success', 'misc.layers', { screen: 'Reports' }],
      ['overdue', 'danger', 'misc.alertTriangle', { screen: 'Reports' }],
    ]);
    expect(dashboardTiles({ isAdmin: false }).slice(2).map((t) => [t.key, t.tone, t.icon])).toEqual([['overdue', 'danger', 'misc.alertTriangle'], ['dueThisWeek', 'warning', 'misc.week']]);
  });
});

it('the welcome band, the first day and Due soon', () => {
  expect(welcomeBand({ firstDay: false, username: 'sara', now: new Date('2026-10-30T08:00:00Z'), timeZone: TZ })).toEqual({ dateLine: 'Friday 30 October', greeting: 'Welcome back, sara.', showLinks: true });
  expect(welcomeBand({ firstDay: true, username: null, now: NOW, timeZone: TZ })).toMatchObject({ greeting: 'Welcome, there.', showLinks: false });
  expect(isFirstDay({ projects: [], myTasks: [], dueSoon: [] })).toBe(true);
  expect(isFirstDay({ projects: [], myTasks: [] })).toBe(false);
  expect(isFirstDay({ projects: [1], myTasks: [], dueSoon: [] })).toBe(false);
  expect(['2026-10-25', '2026-10-28', '2026-10-29', '2026-11-01'].map((d) => dueMeta(d, NOW, TZ).label)).toEqual(['3d overdue', 'Due today', 'Due tomorrow', 'Due in 4d']);
  const late = task({ dueDate: '2026-10-25', columnCategory: 'REVIEW', approvalRequestedAt: '2026-10-25T09:00:00Z' });
  expect(dueSoonRows([late, task({ dueDate: null }), task({ dueDate: '2026-10-24', columnCategory: 'DONE' })], NOW, TZ)).toEqual([expect.objectContaining({ waiting: true })]);
});

it('Due soon: the earliest first, six at most; a late task not waiting says how late', () => {
  const days = ['2026-11-05', '2026-10-20', '2026-10-30', '2026-10-29', '2026-11-02', '2026-10-28', '2026-11-09'];
  const rows = dueSoonRows(days.map((d, i) => task({ id: `t${i}`, dueDate: d })), NOW, TZ);
  expect(rows.map((r) => r.task.dueDate)).toEqual(['2026-10-20', '2026-10-28', '2026-10-29', '2026-10-30', '2026-11-02', '2026-11-05']);
  expect(rows[0]).toMatchObject({ waiting: false, meta: { label: '8d overdue', overdue: true } });
});

it('the approvals card and recent activity', () => {
  const view = approvalsCardView({ canApprove: true, tasks: Array.from({ length: 7 }, (_, i) => approvalTask(i)) }, Date.parse('2026-10-28T08:00:00Z'), TZ);
  expect(view).toMatchObject({ visible: true, title: 'Waiting for your approval (7)', more: '+2 more on My Tasks.', reviewAll: true });
  expect(view.rows).toHaveLength(5);
  expect(view.rows[0]).toEqual({ id: 't0', key: 'RIG-0', title: 'Task 0', line: 'Rig · finished by Sara Ali · 2h ago' });
  expect(approvalsCardView({ canApprove: false, tasks: [] }, 0, TZ).visible).toBe(false);
  expect(approvalsCardView(undefined, 0, TZ).visible).toBe(false);
  expect(approvalsCardView({ canApprove: true, tasks: [] }, 0, TZ)).toMatchObject({ empty: 'Nothing is waiting for your approval.', reviewAll: false, more: null });
  expect(approvalsCardView({ canApprove: true, tasks: [{ ...approvalTask(1), requestedBy: null, approvalRequestedAt: null }] }, 0, TZ).rows[0]!.line).toBe('Rig');
  expect(['APPROVAL_REQUESTED', 'SENT_BACK', 'PROJECT_RENAMED'].map(dashboardActionLabel)).toEqual(['asked for approval on', 'sent back', 'project renamed']);
  expect(['COMPLETED', 'APPROVED', 'SENT_BACK', 'REOPENED', 'MOVED', 'CREATED', 'ASSIGNED'].map(dashboardActionTone)).toEqual(['success', 'success', 'warning', 'warning', 'info', 'brand', 'ink2']);
  expect([timeAgo('2026-10-28T07:59:30Z', Date.parse('2026-10-28T08:00:00Z')), timeAgo('2026-10-26T08:00:00Z', Date.parse('2026-10-28T08:00:00Z'))]).toEqual(['just now', '2d ago']);
  expect([timeAgo('2026-10-28T07:55:00Z', Date.parse('2026-10-28T08:00:00Z')), timeAgo('2026-10-28T05:00:00Z', Date.parse('2026-10-28T08:00:00Z')), timeAgo('2026-10-10T08:00:00Z', Date.parse('2026-10-28T08:00:00Z'))]).toEqual(['5m ago', '3h ago', '18d ago']);
  expect(timeAgo('2026-10-28T09:00:00Z', Date.parse('2026-10-28T08:00:00Z'))).toBe('');
});

it('Recent activity rows say who did what to which task, the newest six', () => {
  const row = (o: Partial<ApiActivityRow>): ApiActivityRow => ({ id: 'a1', taskId: 't1', userId: 'u1', action: 'CREATED', createdAt: '2026-10-28T07:00:00Z', actor: { id: 'u1', name: 'Aisha Khan' }, task: { id: 't1', key: 'MICO-3', title: 'Fix' }, project: { id: 'p1', name: 'Rig' }, ...o });
  const at = Date.parse('2026-10-28T08:00:00Z');
  const rows = activityRows([row({ action: 'ASSIGNED', meta: { assignee: 'Omar Ahmed' } }), row({ id: 'a2', actor: null, task: null, action: 'PROJECT_RENAMED' }), ...Array.from({ length: 6 }, (_, i) => row({ id: `b${i}` }))], at);
  expect(rows).toHaveLength(6);
  expect(rows[0]).toEqual({ id: 'a1', who: 'Aisha Khan', verb: 'assigned', taskKey: 'MICO-3', taskId: 't1', projectName: null, assignee: 'Omar Ahmed', ago: '1h ago', tone: 'ink2' });
  expect(rows[1]).toMatchObject({ who: 'Someone', verb: 'project renamed', taskKey: null, taskId: null, projectName: 'Rig', assignee: null });
});

describe.skipIf(!hasWeb('frontend/src/pages/DashboardPage.tsx', 'frontend/src/components/FirstSteps.tsx', 'frontend/src/components/approvals/ApprovalsCard.tsx'))('the website’s words', () => {
  it('every Dashboard word', () => {
    const w = ['frontend/src/pages/DashboardPage.tsx', 'frontend/src/components/FirstSteps.tsx', 'frontend/src/components/approvals/ApprovalsCard.tsx'].map(readWeb).join('\n');
    for (const t of [...Object.values(DASHBOARD_TEXT), ...Object.values(DASHBOARD_ACTION_LABEL), FIRST_STEPS_TEXT.admin.title, FIRST_STEPS_TEXT.admin.body, FIRST_STEPS_TEXT.employee.title, FIRST_STEPS_TEXT.employee.body, FIRST_STEPS_TEXT.createProject, FIRST_STEPS_TEXT.addTeam, 'Assigned to you', 'Active workspaces', 'Past their due day', 'Nothing late', 'No tasks yet', 'Today, the week’s last day', 'Nothing is waiting for your approval.', 'more on My Tasks.']) expect(w, t).toContain(t);
  });
});

// Stage 2 fix pass B9: a figure whose list couldn't load (and nothing is kept on the phone) said "—"
// and "loading" for ever. It says it couldn't load; the tiles offer Retry (DashboardTiles).
describe('B9: a figure that couldn’t load says so', () => {
  it('an administrator’s company totals', () => {
    const tiles = dashboardTiles({ isAdmin: true, myTasks: [1], projects: [1], failed: { reports: true } });
    expect(tiles.map((t) => [t.key, t.value, t.hint, t.failed ?? false])).toEqual([
      ['myTasks', '1', 'Assigned to you', false],
      ['projects', '1', 'Active workspaces', false],
      ['allTasks', '—', 'Couldn’t load', true],
      ['overdue', '—', 'Couldn’t load', true],
    ]);
  });

  it('everyone else’s own tasks, and the projects', () => {
    const tiles = dashboardTiles({ isAdmin: false, failed: { myTasks: true, projects: true } });
    expect(tiles.map((t) => [t.value, t.hint, t.failed])).toEqual([
      ['—', 'Couldn’t load', true],
      ['—', 'Couldn’t load', true],
      ['—', 'Couldn’t load', true],
      ['—', 'Couldn’t load', true],
    ]);
  });

  it('still loading is "—" with no hint; a list kept from before shows its figures', () => {
    expect(dashboardTiles({ isAdmin: true }).every((t) => t.value === '—' && t.hint === undefined && !t.failed)).toBe(true);
    // A failed refresh over a kept copy: the copy's figures, not "couldn't load".
    const kept = dashboardTiles({ isAdmin: true, myTasks: [], projects: [], reportRows: [], failed: {} })[2]!;
    expect(kept.value).toBe('0');
    expect(kept.failed).toBeUndefined();
    expect(TILE_FAILED).toEqual({ hint: 'Couldn’t load', spoken: 'couldn’t load', note: 'Couldn’t load these figures.' });
  });
});
