/**
 * Review Focus 1: a task waiting for approval and past its due day is never counted or called
 * overdue / late anywhere in the app — the same numbers as the website and the server.
 */
import { it, expect } from 'vitest';
import { isOverdue } from './due-date';
import { myDueCounts } from './dashboard-tiles';
import { dueLabel, enrichMyTasks, myTaskCounts, myTaskLabel } from './my-tasks';
import { boardCard, cardView } from './board';
import { allBoardCard } from './all-board';
import { filterCounts, milestoneNote, projectDeadlines, projectMilestones, taskStats, workload } from './project-dashboard';
import { statusOf } from './calendar-model';
import { dueState } from './task-detail';
import type { ApiColumn, ApiProject, ApiTask } from './types';

const NOW = new Date('2026-10-30T08:00:00Z');
const TODAY = '2026-10-30';
const TZ = 'Asia/Muscat';

const task = (over: Partial<ApiTask> = {}): ApiTask => ({
  id: 't1', key: 'RIG-4', title: 'Pressure test', description: null, projectId: 'p1', columnId: 'review', position: 0,
  priority: 'NORMAL', startDate: null, dueDate: null, estimatedHours: null, progress: 100, completedAt: null, ...over,
});
const project: ApiProject = { id: 'p1', code: 'RIG', name: 'Rig Inspection', description: null, status: 'ACTIVE' };
const reviewColumn: ApiColumn = { id: 'review', projectId: 'p1', name: 'Review', category: 'REVIEW', position: 3, color: '#3A6EA5', enabled: true };

const waiting = task({ dueDate: '2026-10-29', columnCategory: 'REVIEW', approvalRequestedAt: '2026-10-29T08:00:00Z', assignees: [{ id: 'u1', name: 'Ann Lee' }] as never });

it('is never counted or called overdue anywhere in the app', () => {
  expect(isOverdue(waiting, NOW, TZ)).toBe(false);
  // The Dashboard's own Overdue (fix pass B11: the old summarizeTasks buckets are gone).
  expect(myDueCounts([waiting], { timeZone: TZ, weekStart: 0, now: NOW }).overdue).toBe(0);
  const [row] = enrichMyTasks([waiting], [project], { timeZone: TZ, now: NOW });
  expect(row).toMatchObject({ overdue: false, waiting: true });
  expect(myTaskCounts([row!]).overdue).toBe(0);
  expect(dueLabel(row!)).not.toMatch(/Overdue/);
  expect(myTaskLabel(row!)).toMatch(/Waiting for approval/);
  const view = cardView(boardCard(waiting, reviewColumn), { now: NOW, timeZone: TZ });
  expect(view).toMatchObject({ overdue: false, waiting: true });
  expect(view.label).toMatch(/Waiting for approval\./);
  expect(view.label).toMatch(/Due 29 Oct 2026\./);
  expect(view.label).not.toMatch(/Overdue/);
  expect(view.dueText).toBe('29 Oct 2026');
  expect(allBoardCard(waiting, 'REVIEW', project, '#3A6EA5').awaitingApproval).toBe(true);
  expect(taskStats([waiting], TODAY, TZ).overdue).toBe(0);
  expect(workload([waiting], TODAY, TZ)[0]).toMatchObject({ id: 'u1', open: 1, overdue: 0 });
  expect(projectMilestones([{ ...waiting, isMilestone: true }], TODAY, TZ)[0]!.state).toBe('waiting');
  expect(milestoneNote('waiting', -1)).toBe('Waiting for approval');
  expect(projectDeadlines([waiting], TODAY, 14, TZ)[0]).toMatchObject({ waiting: true });
  expect(statusOf(waiting as never, '2026-10-29', TODAY)).toBe('in-progress');
  expect(dueState(waiting, NOW, TZ)).toMatchObject({ overdue: false, waiting: true, text: 'Due 29 Oct 2026' });
  expect(filterCounts([waiting], TODAY, TZ).overdue).toBe(0);
});

it('sent back (no longer waiting), it is late again', () => {
  const sentBack = { ...waiting, approvalRequestedAt: null, columnCategory: 'IN_PROGRESS' };
  expect(isOverdue(sentBack, NOW, TZ)).toBe(true);
  expect(myDueCounts([sentBack], { timeZone: TZ, weekStart: 0, now: NOW }).overdue).toBe(1);
  expect(cardView(boardCard(sentBack, { ...reviewColumn, category: 'IN_PROGRESS' }), { now: NOW, timeZone: TZ })).toMatchObject({ overdue: true, waiting: false });
  expect(dueState(sentBack, NOW, TZ)).toMatchObject({ overdue: true, waiting: false });
});

it('the task screens and lists that show “Late” or “Overdue” read the waiting flag', async () => {
  const { appSource: src } = await import('../testing/web-source');
  // Stage 2: the Projects page's Overdue is the server's stats.overdue (/projects/overview), which
  // leaves waiting tasks out; the page counts nothing late itself.
  expect(src('screens/ProjectsScreen.tsx') + src('components/projects/ProjectCard.tsx')).not.toMatch(/projectCardFigures|isOverdue\(|isTaskLate\(/);
  expect(src('components/project/OverviewTab.tsx')).toMatch(/d\.waiting/);
  expect(src('components/TaskRow.tsx')).toMatch(/isOverdue\(task\)/);
});
