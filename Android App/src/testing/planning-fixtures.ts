/**
 * Shared fixtures for the Timeline and Workload tests (Stage 3, Lane P). Test-only — nothing in the
 * app imports this folder. The numbers deliberately disagree with what a recount would give (Review
 * Focus 5): the app must show what the server sent.
 */
import type { TimelineProject, TimelineTask, TimelineTasksData } from '../lib/planning-api';

/** The company's today in every fixture. */
export const TODAY = '2026-10-30';

const OMAR = { id: 'u-omar', name: 'Omar Said', avatarUrl: null };
const SARA = { id: 'u-sara', name: 'Sara Ahmed', avatarUrl: null };

const project = (over: Partial<TimelineProject> & Pick<TimelineProject, 'id' | 'name'>): TimelineProject => ({
  code: over.id.toUpperCase(),
  color: '#1E5A8B',
  icon: null,
  imageUrl: null,
  status: 'ACTIVE',
  owner: OMAR,
  start: '2026-09-01',
  startFrom: 'project',
  startIsCreated: false,
  target: '2026-12-10',
  targetFrom: 'project',
  tasks: { total: 10, done: 5, open: 5, overdue: 0 },
  progress: 50,
  timeUsed: 40,
  health: 'on-track',
  daysLate: 0,
  dueByWeek: [0, 1, 2],
  milestones: [],
  nextMilestone: null,
  milestoneCount: 0,
  milestonesSoon: 0,
  meetings: [],
  meetingsThisWeek: 0,
  ...over,
});

/** Five open projects, two owners (and one with none). */
export const PROJECTS: TimelineProject[] = [
  project({
    id: 'p-late',
    name: 'Rig 3 overhaul',
    target: '2026-10-21',
    daysLate: 9,
    health: 'late',
    progress: 70,
    timeUsed: 100,
    tasks: { total: 12, done: 8, open: 4, overdue: 2 },
    nextMilestone: { id: 'm1', key: 'RIG-9', title: 'Pilot on rig 3', date: '2026-10-15', done: false },
    milestoneCount: 2,
    meetingsThisWeek: 1,
  }),
  project({
    id: 'p-late-tasks',
    name: 'Field CRM',
    owner: SARA,
    startFrom: 'tasks',
    target: '2026-10-29',
    targetFrom: 'tasks',
    daysLate: 1,
    health: 'late',
    progress: 40,
    tasks: { total: 5, done: 2, open: 3, overdue: 1 },
    nextMilestone: { id: 'm2', key: 'CRM-4', title: 'Go live', date: '2026-11-12', done: false },
    milestoneCount: 2,
    milestonesSoon: 1,
  }),
  project({
    id: 'p-risk',
    name: 'Mobile app',
    owner: SARA,
    target: '2027-02-03',
    progress: 9,
    timeUsed: 45,
    health: 'at-risk',
    tasks: { total: 22, done: 2, open: 20, overdue: 3 },
    milestoneCount: 3,
    meetingsThisWeek: 2,
  }),
  project({
    id: 'p-ok',
    name: 'Office move',
    progress: 62,
    timeUsed: 30,
    tasks: { total: 11, done: 1, open: 10, overdue: 0 },
    nextMilestone: { id: 'm3', key: 'OFF-4', title: 'Beta build', date: '2026-11-06', done: false, waiting: true },
    milestoneCount: 1,
    milestonesSoon: 1,
  }),
  project({
    id: 'p-none',
    name: 'Archive scan',
    owner: null,
    target: null,
    targetFrom: null,
    timeUsed: null,
    health: 'no-target',
    progress: 0,
    tasks: { total: 0, done: 0, open: 0, overdue: 0 },
  }),
];

/** A project's task rows: done, waiting for approval (due before today), overdue, and open in another year. */
export const TIMELINE_TASKS: TimelineTask[] = [
  { id: 't-done', key: 'OFF-1', title: 'Book the movers', start: '2026-10-12', due: '2026-10-20', done: true, overdue: false, priority: 'NORMAL', isMilestone: false, assignees: [{ id: 'u-omar', name: 'Omar Said' }] },
  { id: 't-wait', key: 'OFF-2', title: 'Sign the lease', start: null, due: '2026-10-29', done: false, overdue: false, waiting: true, priority: 'HIGH', isMilestone: false, assignees: [] },
  {
    id: 't-over',
    key: 'OFF-3',
    title: 'Order the desks',
    start: null,
    due: '2026-10-22',
    done: false,
    overdue: true,
    priority: 'URGENT',
    isMilestone: false,
    assignees: [
      { id: 'u-omar', name: 'Omar Said' },
      { id: 'u-sara', name: 'Sara Ahmed' },
      { id: 'u-hassan', name: 'Hassan Ahmed' },
    ],
  },
  { id: 't-open', key: 'OFF-5', title: 'Hand back the keys', start: '2026-12-28', due: '2027-01-05', done: false, overdue: false, priority: 'LOW', isMilestone: true, assignees: [{ id: 'u-sara', name: 'Sara Ahmed' }] },
];

export const TASKS_DATA: TimelineTasksData = {
  projectId: 'p-ok',
  from: '2026-10-11',
  to: '2027-01-09',
  today: TODAY,
  matched: 4,
  open: 10,
  undated: 0,
  tasks: TIMELINE_TASKS,
};
