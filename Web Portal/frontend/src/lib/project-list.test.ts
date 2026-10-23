import { describe, it, expect } from 'vitest';
import type { ProjectOverview, ProjectStats } from '../api/projects';
import {
  countLine,
  filterProjects,
  headerSummary,
  inTab,
  isMine,
  matchesSearch,
  needsAttention,
  nextDueLabel,
  ownerOptions,
  progressOf,
  readListState,
  sortProjects,
  tabCounts,
  targetLabel,
  updatedLabel,
  writeListState,
} from './project-list';

const TODAY = '2026-10-23'; // a Friday
const TZ = 'Asia/Muscat';

let seq = 0;
function project(extra: Partial<Omit<ProjectOverview, 'stats'>> & { stats?: Partial<ProjectStats> } = {}): ProjectOverview {
  const { stats, ...rest } = extra;
  seq += 1;
  return {
    id: `p${seq}`,
    code: `P${seq}`,
    number: null,
    name: `Project ${seq}`,
    description: null,
    clientName: null,
    status: 'ACTIVE',
    priority: 'NORMAL',
    color: '#8B1E1E',
    icon: null,
    imageUrl: null,
    ownerId: null,
    managerId: null,
    startDate: null,
    targetDate: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    owner: null,
    team: [],
    ...rest,
    stats: { total: 0, done: 0, open: 0, overdue: 0, nextDue: null, lastActivityAt: '2026-10-01T00:00:00.000Z', ...stats },
  };
}

describe('the list’s state in the address', () => {
  it('starts on All, unsearched, anyone’s, needing attention first', () => {
    expect(readListState(new URLSearchParams())).toEqual({ status: 'all', q: '', owner: '', sort: 'attention', mine: false });
  });

  it('reads the tab, search, owner, sort and “only mine” back', () => {
    expect(readListState(new URLSearchParams('status=on-hold&q=rig+portal&owner=u1&sort=name&mine=1'))).toEqual({
      status: 'on-hold',
      q: 'rig portal',
      owner: 'u1',
      sort: 'name',
      mine: true,
    });
  });

  it('falls back to the defaults for values it doesn’t know', () => {
    expect(readListState(new URLSearchParams('status=bogus&sort=size&mine=yes'))).toMatchObject({ status: 'all', sort: 'attention', mine: false });
  });

  it('writes only what differs from the defaults, keeping anything else in the address', () => {
    expect(writeListState(new URLSearchParams('status=active&x=1'), { status: 'all', q: 'rig' }).toString()).toBe('x=1&q=rig');
    expect(writeListState(new URLSearchParams('q=rig&sort=name'), { q: '', sort: 'attention', mine: true }).toString()).toBe('mine=1');
    expect(writeListState(new URLSearchParams(), { status: 'archived', owner: 'u2', sort: 'progress' }).toString()).toBe('status=archived&owner=u2&sort=progress');
  });
});

describe('search', () => {
  const rig = project({ name: 'Rig Inspection Portal', code: 'RIG', clientName: 'Gulf Energy', number: 'C-2041' });

  it('matches the name, code, client or project number, whatever the case', () => {
    for (const q of ['inspection', 'rig', 'GULF', 'c-2041', 'Energy']) expect(matchesSearch(rig, q)).toBe(true);
    expect(matchesSearch(rig, 'falcon')).toBe(false);
  });

  it('needs every word to match, in any of those', () => {
    expect(matchesSearch(rig, 'gulf portal')).toBe(true);
    expect(matchesSearch(rig, '  portal   2041 ')).toBe(true);
    expect(matchesSearch(rig, 'gulf mobile')).toBe(false);
  });

  it('matches everything when empty', () => {
    expect(matchesSearch(rig, '')).toBe(true);
    expect(matchesSearch(rig, '   ')).toBe(true);
  });
});

describe('status tabs', () => {
  const list = [
    project({ status: 'ACTIVE' }),
    project({ status: 'ACTIVE' }),
    project({ status: 'PLANNING' }),
    project({ status: 'ON_HOLD' }),
    project({ status: 'COMPLETED' }),
    project({ status: 'ARCHIVED' }),
    project({ status: 'ARCHIVED' }),
  ];

  it('puts every project but the archived ones under All, and archived ones only under their own tab', () => {
    expect(list.filter((p) => inTab(p, 'all')).map((p) => p.status)).toEqual(['ACTIVE', 'ACTIVE', 'PLANNING', 'ON_HOLD', 'COMPLETED']);
    expect(list.filter((p) => inTab(p, 'archived'))).toHaveLength(2);
    expect(list.filter((p) => inTab(p, 'on-hold')).map((p) => p.status)).toEqual(['ON_HOLD']);
  });

  it('counts each tab', () => {
    expect(tabCounts(list)).toEqual({ all: 5, active: 2, planning: 1, 'on-hold': 1, completed: 1, archived: 2 });
  });
});

describe('needing attention', () => {
  it('is a project with an overdue task, or one past its target date that isn’t finished', () => {
    expect(needsAttention(project({ stats: { overdue: 1 } }), TODAY)).toBe(true);
    expect(needsAttention(project({ targetDate: '2026-10-20T00:00:00.000Z' }), TODAY)).toBe(true);
    expect(needsAttention(project({ targetDate: '2026-10-20T00:00:00.000Z', status: 'COMPLETED' }), TODAY)).toBe(false);
    expect(needsAttention(project({ targetDate: '2026-10-23T00:00:00.000Z' }), TODAY)).toBe(false); // due today: not yet late
    expect(needsAttention(project(), TODAY)).toBe(false);
  });

  it('never counts an archived project', () => {
    expect(needsAttention(project({ status: 'ARCHIVED', stats: { overdue: 3 }, targetDate: '2026-01-01T00:00:00.000Z' }), TODAY)).toBe(false);
  });

  it('heads the page: open projects and how many need attention', () => {
    const list = [project({ stats: { overdue: 2 } }), project(), project({ status: 'COMPLETED' }), project({ status: 'ARCHIVED', stats: { overdue: 1 } })];
    expect(headerSummary(list, TODAY)).toBe('3 projects · 1 needs attention');
    expect(headerSummary([...list, project({ targetDate: '2026-10-01T00:00:00.000Z' })], TODAY)).toBe('4 projects · 2 need attention');
    expect(headerSummary([project()], TODAY)).toBe('1 project');
    expect(headerSummary([], TODAY)).toBe('No projects yet');
  });
});

describe('owner and “only my projects”', () => {
  it('counts a project as mine when I own it, manage it or am on its team — not just because I made it', () => {
    const me = 'u1';
    expect(isMine(project({ ownerId: me }), me)).toBe(true);
    expect(isMine(project({ managerId: me }), me)).toBe(true);
    expect(isMine(project({ team: [{ id: 'u9', name: 'Zed', avatarUrl: null }, { id: me, name: 'Me', avatarUrl: null }] }), me)).toBe(true);
    expect(isMine(project({ ownerId: 'u2' }), me)).toBe(false);
  });

  it('filters by search, owner and “only mine” together (the tab is applied apart)', () => {
    const a = project({ name: 'Rig Portal', ownerId: 'u1', status: 'ARCHIVED' });
    const b = project({ name: 'Rig Mobile', ownerId: 'u2' });
    const c = project({ name: 'Falcon', ownerId: 'u1' });
    const list = [a, b, c];
    expect(filterProjects(list, { status: 'all', q: 'rig', owner: '', sort: 'attention', mine: false }, 'u1')).toEqual([a, b]);
    expect(filterProjects(list, { status: 'all', q: '', owner: 'u1', sort: 'attention', mine: false }, 'u1')).toEqual([a, c]);
    expect(filterProjects(list, { status: 'all', q: 'rig', owner: '', sort: 'attention', mine: true }, 'u1')).toEqual([a]);
  });

  it('offers the people who own projects, by name, once each', () => {
    const sara = { id: 'u1', name: 'Sara Ahmed', avatarUrl: null };
    const adam = { id: 'u2', name: 'Adam Noor', avatarUrl: null };
    expect(ownerOptions([project({ ownerId: 'u1', owner: sara }), project({ ownerId: 'u2', owner: adam }), project({ ownerId: 'u1', owner: sara }), project()])).toEqual([
      { id: 'u2', name: 'Adam Noor' },
      { id: 'u1', name: 'Sara Ahmed' },
    ]);
  });
});

describe('sorting', () => {
  const names = (list: ProjectOverview[]) => list.map((p) => p.name);

  it('needs attention: most overdue first, then past their target, then the nearest next due day', () => {
    const list = [
      project({ name: 'Quiet' }),
      project({ name: 'Due Tuesday', stats: { nextDue: '2026-10-27' } }),
      project({ name: 'Two late', stats: { overdue: 2, nextDue: '2026-10-30' } }),
      project({ name: 'Past target', targetDate: '2026-10-01T00:00:00.000Z' }),
      project({ name: 'Five late', stats: { overdue: 5 } }),
      project({ name: 'Due today', stats: { nextDue: '2026-10-23' } }),
    ];
    expect(names(sortProjects(list, 'attention', TODAY))).toEqual(['Five late', 'Two late', 'Past target', 'Due today', 'Due Tuesday', 'Quiet']);
  });

  it('by name, A to Z, with numbers in their natural order', () => {
    const list = [project({ name: 'phase 10' }), project({ name: 'Beta' }), project({ name: 'Phase 2' }), project({ name: 'alpha' })];
    expect(names(sortProjects(list, 'name', TODAY))).toEqual(['alpha', 'Beta', 'Phase 2', 'phase 10']);
  });

  it('recently updated first', () => {
    const list = [
      project({ name: 'Old', stats: { lastActivityAt: '2026-09-01T00:00:00.000Z' } }),
      project({ name: 'New', stats: { lastActivityAt: '2026-10-22T09:00:00.000Z' } }),
      project({ name: 'Mid', stats: { lastActivityAt: '2026-10-10T00:00:00.000Z' } }),
    ];
    expect(names(sortProjects(list, 'updated', TODAY))).toEqual(['New', 'Mid', 'Old']);
  });

  it('by target date, nearest first, those without one last', () => {
    const list = [
      project({ name: 'None' }),
      project({ name: 'December', targetDate: '2026-12-02T00:00:00.000Z' }),
      project({ name: 'Passed', targetDate: '2026-10-20T00:00:00.000Z' }),
      project({ name: 'November', targetDate: '2026-11-30T00:00:00.000Z' }),
    ];
    expect(names(sortProjects(list, 'target', TODAY))).toEqual(['Passed', 'November', 'December', 'None']);
  });

  it('by progress, least done first, those without tasks last', () => {
    const list = [
      project({ name: 'Empty' }),
      project({ name: 'Most', stats: { total: 20, done: 17 } }),
      project({ name: 'Least', stats: { total: 15, done: 3 } }),
      project({ name: 'Half', stats: { total: 10, done: 5 } }),
    ];
    expect(names(sortProjects(list, 'progress', TODAY))).toEqual(['Least', 'Half', 'Most', 'Empty']);
  });

  it('does not reorder the list it is given', () => {
    const list = [project({ name: 'B' }), project({ name: 'A' })];
    sortProjects(list, 'name', TODAY);
    expect(names(list)).toEqual(['B', 'A']);
  });

  it('says how many show and in what order', () => {
    expect(countLine(8, 'attention')).toBe('8 projects · most overdue first');
    expect(countLine(1, 'name')).toBe('1 project · A to Z');
    expect(countLine(3, 'updated')).toBe('3 projects · recently updated first');
    expect(countLine(3, 'target')).toBe('3 projects · nearest target date first');
    expect(countLine(3, 'progress')).toBe('3 projects · least done first');
    expect(countLine(0, 'attention')).toBe('No projects');
  });
});

describe('card wording', () => {
  it('progress: share done (rounded, as on the Dashboard and in Reports) and how many tasks, never 100% before the last one is done', () => {
    expect(progressOf({ total: 40, done: 25 })).toEqual({ pct: 63, text: '63% done · 25 of 40 tasks' });
    expect(progressOf({ total: 3, done: 1 }).pct).toBe(33);
    expect(progressOf({ total: 200, done: 199 }).pct).toBe(99);
    expect(progressOf({ total: 1000, done: 999 }).pct).toBe(99);
    expect(progressOf({ total: 1, done: 1 })).toEqual({ pct: 100, text: '100% done · 1 of 1 task' });
    expect(progressOf({ total: 0, done: 0 })).toEqual({ pct: 0, text: 'No tasks yet' });
  });

  it('target date: the day and days left, late in red once passed, or none', () => {
    const t = (targetDate: string | null, status: ProjectOverview['status'] = 'ACTIVE') => targetLabel(project({ targetDate, status }), TODAY);
    expect(t(null)).toEqual({ text: 'No target date', late: false });
    expect(t('2026-11-30T00:00:00.000Z')).toEqual({ text: 'Target 30 Nov · 38 days', late: false });
    expect(t('2026-10-24T00:00:00.000Z')).toEqual({ text: 'Target 24 Oct · 1 day', late: false });
    expect(t('2026-10-23T00:00:00.000Z')).toEqual({ text: 'Target today', late: false });
    expect(t('2026-10-22T00:00:00.000Z')).toEqual({ text: 'Target passed yesterday', late: true });
    expect(t('2026-10-20T00:00:00.000Z')).toEqual({ text: 'Target passed 3 days ago', late: true });
    expect(t('2027-01-15T00:00:00.000Z')).toEqual({ text: 'Target 15 Jan 2027 · 84 days', late: false });
  });

  it('target date stored as a moment rather than a day: read in the company time zone, as the project dashboard does', () => {
    // 01:00 on the 23rd in Muscat (still the 22nd in UTC).
    const p = project({ targetDate: '2026-10-22T21:00:00.000Z' });
    expect(targetLabel(p, TODAY, TZ)).toEqual({ text: 'Target today', late: false });
    expect(needsAttention(p, TODAY, TZ)).toBe(false);
  });

  it('target date of a finished project: just the day, never late', () => {
    expect(targetLabel(project({ targetDate: '2026-10-20T00:00:00.000Z', status: 'COMPLETED' }), TODAY)).toEqual({ text: 'Target 20 Oct', late: false });
    expect(targetLabel(project({ targetDate: '2026-10-20T00:00:00.000Z', status: 'ARCHIVED' }), TODAY)).toEqual({ text: 'Target 20 Oct', late: false });
  });

  it('next due day: a dash, today, tomorrow, the weekday this week, else the date', () => {
    expect(nextDueLabel(null, TODAY)).toEqual({ short: '—', long: 'No upcoming due date' });
    expect(nextDueLabel('2026-10-23', TODAY)).toEqual({ short: 'Today', long: 'Today, Friday 23 October 2026' });
    expect(nextDueLabel('2026-10-24', TODAY).short).toBe('Tomorrow');
    expect(nextDueLabel('2026-10-26', TODAY)).toEqual({ short: 'Mon 26', long: 'Monday 26 October 2026' });
    expect(nextDueLabel('2026-10-29', TODAY).short).toBe('Thu 29');
    expect(nextDueLabel('2026-11-12', TODAY).short).toBe('12 Nov');
    expect(nextDueLabel('2027-02-01', TODAY).short).toBe('1 Feb 2027');
  });

  it('last update: minutes, hours, yesterday, days, then the date', () => {
    const now = new Date('2026-10-23T10:00:00Z'); // 14:00 in Muscat
    const u = (iso: string) => updatedLabel(iso, now, TZ);
    expect(u('2026-10-23T09:59:40Z')).toBe('Updated just now');
    expect(u('2026-10-23T09:55:00Z')).toBe('Updated 5 min ago');
    expect(u('2026-10-23T08:00:00Z')).toBe('Updated 2 h ago');
    expect(u('2026-10-22T20:30:00Z')).toBe('Updated 13 h ago'); // 00:30 today in Muscat
    expect(u('2026-10-22T19:30:00Z')).toBe('Updated yesterday'); // 23:30 yesterday in Muscat
    expect(u('2026-10-20T10:00:00Z')).toBe('Updated 3 days ago');
    expect(u('2026-10-10T10:00:00Z')).toBe('Updated 10 Oct');
    expect(u('2025-12-01T10:00:00Z')).toBe('Updated 1 Dec 2025');
    expect(u('2026-10-23T10:05:00Z')).toBe('Updated just now'); // a clock a little ahead
  });
});
