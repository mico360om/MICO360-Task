/**
 * Test-only: six Projects-page rows as GET /projects/overview answers them, for the projects-page and
 * project-status tests. Friday 30 Oct 2026 in Muscat. ACTIVE ×2 (one with overdue tasks and a passed
 * target), PLANNING, ON_HOLD (target passed), COMPLETED, ARCHIVED; owners Ann Lee / Omar Said / none;
 * targets past, near, none and in another year; next due today, +3, +20 and none; teams of 6, 2 and 0.
 */
import type { ProjectOverview, ProjectPerson } from '../lib/types';

export const TODAY = '2026-10-30';
export const NOW = new Date('2026-10-30T08:00:00Z');
export const TZ = 'Asia/Muscat';

const person = (id: string, name: string): ProjectPerson => ({ id, name, avatarUrl: null });
export const ANN = person('u1', 'Ann Lee');
export const OMAR = person('u2', 'Omar Said');
const SARA = person('u3', 'Sara Ali');
const ZED = person('u4', 'Zed King');

const row = (o: Partial<ProjectOverview> & Pick<ProjectOverview, 'id' | 'name' | 'code' | 'status'>): ProjectOverview => ({
  number: null,
  clientName: null,
  color: '#3A6EA5',
  icon: null,
  imageUrl: null,
  ownerId: null,
  targetDate: null,
  stats: { total: 0, done: 0, open: 0, overdue: 0, nextDue: null, lastActivityAt: '2026-10-20T10:00:00.000Z' },
  owner: null,
  team: [],
  teamCount: 0,
  mine: false,
  ...o,
});

export const LIST: ProjectOverview[] = [
  row({
    id: 'p1', name: 'Rig Inspection', code: 'RIG', number: '4471', clientName: 'PDO', status: 'ACTIVE', ownerId: 'u1', owner: ANN, targetDate: '2026-10-20T00:00:00.000Z',
    stats: { total: 40, done: 25, open: 15, overdue: 3, nextDue: '2026-10-30', lastActivityAt: '2026-10-30T06:00:00.000Z' },
    team: [ANN, OMAR, SARA, ZED], teamCount: 6, mine: true, canManage: true,
  }),
  row({
    id: 'p2', name: 'Ops Upgrade', code: 'OPS', status: 'ACTIVE', ownerId: 'u2', owner: OMAR, targetDate: '2026-11-15',
    stats: { total: 10, done: 4, open: 6, overdue: 0, nextDue: '2026-11-02', lastActivityAt: '2026-10-29T10:00:00.000Z' },
    team: [OMAR, SARA], teamCount: 2, canManage: false,
  }),
  row({ id: 'p3', name: 'alpha site', code: 'ALP', status: 'PLANNING', mine: true }),
  row({
    id: 'p4', name: 'Beta Plant', code: 'BET', clientName: 'Acme', status: 'ON_HOLD', ownerId: 'u1', owner: ANN, targetDate: '2026-10-28',
    stats: { total: 5, done: 1, open: 4, overdue: 0, nextDue: '2026-11-19', lastActivityAt: '2026-10-01T10:00:00.000Z' },
    team: [ANN, ZED], teamCount: 2,
  }),
  row({
    id: 'p5', name: 'Gamma Works', code: 'GAM', status: 'COMPLETED', ownerId: 'u2', owner: OMAR, targetDate: '2026-09-30',
    stats: { total: 12, done: 12, open: 0, overdue: 0, nextDue: null, lastActivityAt: '2026-10-30T07:59:30.000Z' },
    team: [OMAR, ANN], teamCount: 2,
  }),
  row({
    id: 'p6', name: 'Delta 10', code: 'DEL', number: 'PDO-9', status: 'ARCHIVED', targetDate: '2025-08-01',
    stats: { total: 3, done: 2, open: 1, overdue: 1, nextDue: null, lastActivityAt: '2025-12-01T10:00:00.000Z' },
  }),
];
