/**
 * Management fixtures (Stage 3 Lane M): one overview as the server sends it, and one list behind a
 * number. Test-only — nothing in the app imports this folder.
 *
 * The figures deliberately disagree with what a recount would give (Review Focus 5): a health row's
 * completionPct is not done / total, and the tiles are not the sums of the rows.
 */
import type { HealthRow, ItemList, ManagementOverview, PersonRow, TrendRow } from '../lib/management-api';

const DEFAULT = { projectIds: [], ownerId: null, statuses: ['PLANNING', 'ACTIVE', 'ON_HOLD'], weeks: 12 } as const;

export const HEALTH: HealthRow[] = [
  {
    id: 'p-red', code: 'RIG', name: 'Rig Inspection Portal', status: 'ACTIVE', color: '#1E5A8B', icon: 'oil', imageUrl: null,
    owner: { id: 'u1', name: 'Aisha Khan' }, total: 20, done: 5, open: 15, late: 4,
    // Not 5 / 20: the server's figure is shown as sent.
    completionPct: 40,
    nextMilestone: { id: 't-ms1', key: 'RIG-9', title: 'Hand over the pumps', due: '2026-10-27', daysLeft: -3 },
    lateMilestones: 1, lastActivityAt: '2026-10-04T05:00:00Z', missingChecks: 2, checksDue: 3, checksDone: 1, checksDoneLate: 0, openFollowUps: 1,
    rag: 'RED',
    reasons: [{ code: 'MILESTONE_LATE', level: 'RED', text: 'A milestone is 3 days late' }, { code: 'NO_ACTIVITY', level: 'AMBER', text: 'No activity for 26 days' }],
  },
  {
    id: 'p-amber', code: 'SLB', name: 'Slab pour', status: 'ON_HOLD', color: '#B45309', icon: null, imageUrl: null,
    owner: { id: 'u2', name: 'Omar Said' }, total: 8, done: 6, open: 2, late: 2, completionPct: 70,
    nextMilestone: { id: 't-ms2', key: 'SLB-3', title: 'Cure test', due: '2026-10-29', daysLeft: -1, waiting: true },
    lateMilestones: 0, lastActivityAt: '2026-10-29T05:00:00Z', missingChecks: 0, checksDue: 0, checksDone: 0, checksDoneLate: 0, openFollowUps: 0,
    rag: 'AMBER',
    reasons: [{ code: 'LATE_TASKS', level: 'AMBER', text: '2 late tasks' }],
  },
  {
    id: 'p-green', code: 'OFC', name: 'Office move', status: 'PLANNING', color: '#15803D', icon: 'truck', imageUrl: null,
    owner: null, total: 0, done: 0, open: 0, late: 0, completionPct: 0, nextMilestone: null,
    lateMilestones: 0, lastActivityAt: '2026-10-30T05:00:00Z', missingChecks: 0, checksDue: 2, checksDone: 2, checksDoneLate: 1, openFollowUps: 0,
    rag: 'GREEN',
    reasons: [{ code: 'ON_TRACK', level: 'GREEN', text: 'On track' }],
  },
];

export const PEOPLE: PersonRow[] = [
  { id: 'u2', name: 'Omar Said', avatarUrl: null, lateTasks: 3, overloadedDays: [{ date: '2026-10-28', count: 7, limit: 5 }, { date: '2026-10-29', count: 6, limit: 5 }], openActions: 4, overdueActions: 1 },
  { id: 'u3', name: 'Mariam Al Balushi', avatarUrl: null, lateTasks: 0, overloadedDays: [], openActions: 1, overdueActions: 0 },
];

export const TRENDS: TrendRow[] = [
  { start: '2026-10-18', end: '2026-10-24', label: '18 Oct', current: false, created: 5, completed: 3, late: 2, passed: 10, failed: 2, passRate: 83 },
  { start: '2026-10-25', end: '2026-10-31', label: '25 Oct', current: true, created: 2, completed: 4, late: 4, passed: 0, failed: 0, passRate: null },
];

export const OVERVIEW: ManagementOverview = {
  scope: 'ALL',
  // 10:15 in Muscat.
  generatedAt: '2026-10-30T06:15:00Z',
  timeZone: 'Asia/Muscat',
  today: '2026-10-30',
  weekStart: 0,
  filters: { ...DEFAULT, projectIds: [], statuses: [...DEFAULT.statuses] },
  period: { from: '2026-08-09', to: '2026-10-31', weeks: 12 },
  options: {
    projects: [
      ...HEALTH.map(({ id, code, name, status, color, icon, imageUrl }) => ({ id, code, name, status, color, icon, imageUrl })),
      { id: 'p-arch', code: 'OLD', name: 'Old yard', status: 'ARCHIVED' as const, color: '#475569', icon: null, imageUrl: null },
    ],
    owners: [{ id: 'u1', name: 'Aisha Khan' }, { id: 'u2', name: 'Omar Said' }],
  },
  tiles: { projects: 3, red: 1, amber: 1, green: 1, lateTasks: 6, missingChecks: 2, checksDue: 5, checksDone: 3, checksDoneLate: 1, passRate: 88, openFollowUps: 2, overloadedPeople: 1 },
  projects: HEALTH,
  approvals: { total: 3, projects: [{ id: 'p-red', code: 'RIG', name: 'Rig Inspection Portal', count: 2 }, { id: 'p-amber', code: 'SLB', name: 'Slab pour', count: 1 }] },
  inspections: {
    due: 5, done: 3, doneLate: 1, noReport: 1, missing: 2, finished: 4, passed: 22, failed: 3, passRate: 88, openFollowUps: 2,
    topItems: [{ formId: 'f1', itemId: 'i1', label: 'Pressure relief valve', formTitle: 'Pump daily check', failures: 3 }],
    topForms: [{ formId: 'f1', title: 'Pump daily check', finished: 4, withFailures: 2, failedItems: 3 }],
  },
  people: PEOPLE,
  workload: { week: '2026-10-25', limit: 5, workingDays: [0, 1, 2, 3, 4] },
  trends: TRENDS,
};

/** A list behind a number: more than it shows (240 of them, the first 200 sent), one row of each kind. */
export const ITEMS: ItemList = {
  metric: 'late-tasks',
  title: 'Late tasks',
  total: 240,
  limit: 200,
  rows: [
    { kind: 'task', id: 't1', title: 'Fix the pump seal', key: 'RIG-4', project: { id: 'p-red', code: 'RIG', name: 'Rig Inspection Portal' }, due: '2026-10-21', daysLate: 9, people: ['Omar Said', 'Aisha Khan'] },
    { kind: 'inspection', id: 'ins1', title: 'Pump daily check', project: { id: 'p-red', code: 'RIG', name: 'Rig Inspection Portal' }, at: '2026-10-21T08:00:00Z', detail: '2 items failed', tone: 'danger', taskId: 't9', inspectionId: 'ins1' },
    { kind: 'action', id: 'a1', title: 'Order spare seals', meetingId: 'm1', due: '2026-10-31', people: ['Omar Said'] },
    { kind: 'project', id: 'p-amber', title: 'Slab pour', detail: 'Amber', tone: 'warning' },
    { kind: 'person', id: 'u2', title: 'Omar Said', detail: '2 overloaded days', tone: 'warning' },
    { kind: 'day', id: 'u2-2026-10-28', title: 'Wed 28 Oct', detail: '7 tasks due (limit 5)', tone: 'danger', tasks: [{ id: 't1', key: 'RIG-4', title: 'Fix the pump seal' }, { id: 't2', key: 'RIG-5', title: 'Grease the bearings' }] },
  ],
};
