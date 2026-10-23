import { describe, it, expect } from 'vitest';
import { buildProjectOverview, type ProjectOverviewRows } from './project-overview';
import type { ProjectRecord } from './project-repository';

const project = (id: string, extra: Partial<ProjectRecord> = {}): ProjectRecord => ({
  id,
  code: id.toUpperCase(),
  number: null,
  name: `Project ${id}`,
  description: null,
  clientName: null,
  managerId: null,
  ownerId: null,
  status: 'ACTIVE',
  priority: 'NORMAL',
  color: '#8B1E1E',
  icon: null,
  imageUrl: null,
  startDate: null,
  targetDate: null,
  notes: null,
  createdById: 'admin',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-10-01T08:00:00Z'),
  ...extra,
});

const empty: ProjectOverviewRows = { totals: [], openByDue: [], members: [], owners: [] };
// 01:00 on 23 October in Muscat — still the 22nd in UTC, so "today" must come from the company zone.
const now = new Date('2026-10-22T21:00:00Z');
const opts = { timeZone: 'Asia/Muscat', now, viewerId: 'viewer' };

describe('buildProjectOverview', () => {
  it('counts done, open and overdue tasks, judging overdue by the company’s today', () => {
    const rows: ProjectOverviewRows = {
      ...empty,
      totals: [{ projectId: 'p1', total: 10, lastTaskUpdate: null }],
      openByDue: [
        { projectId: 'p1', dueDate: new Date('2026-10-20T00:00:00Z'), count: 2 }, // overdue
        { projectId: 'p1', dueDate: new Date('2026-10-22T00:00:00Z'), count: 1 }, // yesterday in Muscat: overdue
        { projectId: 'p1', dueDate: new Date('2026-10-23T00:00:00Z'), count: 1 }, // today: not overdue
        { projectId: 'p1', dueDate: null, count: 2 }, // no due date: never overdue
      ],
    };
    const [p] = buildProjectOverview([project('p1')], rows, opts);
    expect(p!.stats).toMatchObject({ total: 10, open: 6, done: 4, overdue: 3 });
  });

  it('gives the nearest due day of an open task, today or later, as the next due day', () => {
    const rows: ProjectOverviewRows = {
      ...empty,
      totals: [{ projectId: 'p1', total: 4, lastTaskUpdate: null }, { projectId: 'p2', total: 2, lastTaskUpdate: null }],
      openByDue: [
        { projectId: 'p1', dueDate: new Date('2026-10-21T00:00:00Z'), count: 1 }, // overdue: not "next"
        { projectId: 'p1', dueDate: new Date('2026-10-30T00:00:00Z'), count: 1 },
        // An instant rather than a day: 02:30 on the 23rd in Muscat, so due today.
        { projectId: 'p1', dueDate: new Date('2026-10-22T22:30:00Z'), count: 1 },
        { projectId: 'p2', dueDate: new Date('2026-10-01T00:00:00Z'), count: 2 }, // only overdue work
      ],
    };
    const [p1, p2] = buildProjectOverview([project('p1'), project('p2')], rows, opts);
    expect(p1!.stats.nextDue).toBe('2026-10-23');
    expect(p1!.stats.overdue).toBe(1);
    expect(p2!.stats.nextDue).toBeNull();
  });

  it('gives a project without tasks zeros, no next due day, and its own last update', () => {
    const [p] = buildProjectOverview([project('p1')], empty, opts);
    expect(p!.stats).toEqual({ total: 0, done: 0, open: 0, overdue: 0, nextDue: null, lastActivityAt: new Date('2026-10-01T08:00:00Z') });
  });

  it('dates the last update by the later of the project’s own change and its latest task change', () => {
    const rows: ProjectOverviewRows = {
      ...empty,
      totals: [
        { projectId: 'p1', total: 1, lastTaskUpdate: new Date('2026-10-22T18:00:00Z') },
        { projectId: 'p2', total: 1, lastTaskUpdate: new Date('2026-09-01T00:00:00Z') },
      ],
    };
    const [p1, p2] = buildProjectOverview([project('p1'), project('p2')], rows, opts);
    expect(p1!.stats.lastActivityAt).toEqual(new Date('2026-10-22T18:00:00Z'));
    expect(p2!.stats.lastActivityAt).toEqual(new Date('2026-10-01T08:00:00Z'));
  });

  it('names each project’s owner and lists its team in the order given', () => {
    const sara = { id: 'u1', name: 'Sara Ahmed', avatarUrl: '/uploads/avatars/sara.png' };
    const omar = { id: 'u2', name: 'Omar Said', avatarUrl: null };
    const rows: ProjectOverviewRows = {
      ...empty,
      members: [
        { projectId: 'p1', person: omar },
        { projectId: 'p1', person: sara },
        { projectId: 'p2', person: sara },
      ],
      owners: [sara],
    };
    const [p1, p2, p3] = buildProjectOverview(
      [project('p1', { ownerId: 'u1' }), project('p2', { ownerId: 'gone' }), project('p3')],
      rows,
      opts,
    );
    expect(p1!.owner).toEqual(sara);
    expect(p1!.team).toEqual([omar, sara]);
    expect(p2!.owner).toBeNull(); // an owner who no longer exists
    expect(p2!.team).toEqual([sara]);
    expect(p3!.owner).toBeNull();
    expect(p3!.team).toEqual([]);
  });

  it('keeps every project’s own details and the order of the list', () => {
    const list = buildProjectOverview([project('b', { name: 'Beta', number: '2026-014' }), project('a')], empty, opts);
    expect(list.map((p) => p.id)).toEqual(['b', 'a']);
    expect(list[0]).toMatchObject({ code: 'B', name: 'Beta', number: '2026-014', status: 'ACTIVE' });
  });

  it('sends only what a card shows: no description or notes, at most four faces with the team’s size', () => {
    const people = Array.from({ length: 6 }, (_, i) => ({ id: `u${i}`, name: `Person ${i}`, avatarUrl: null }));
    const rows: ProjectOverviewRows = { ...empty, members: people.map((person) => ({ projectId: 'p1', person })) };
    const [item] = buildProjectOverview([project('p1', { description: 'Long scope…', notes: 'Private notes', targetDate: new Date('2026-11-30T00:00:00Z') })], rows, opts);
    // The response shape, field by field.
    expect(Object.keys(item!).sort()).toEqual(
      ['clientName', 'code', 'color', 'icon', 'id', 'imageUrl', 'mine', 'name', 'number', 'owner', 'ownerId', 'stats', 'status', 'targetDate', 'team', 'teamCount'].sort(),
    );
    expect(item!.team.map((m) => m.id)).toEqual(['u0', 'u1', 'u2', 'u3']);
    expect(item!.teamCount).toBe(6);
  });

  it('says whether the person asking owns, manages or is on the team of each project', () => {
    const me = { id: 'viewer', name: 'Me', avatarUrl: null };
    const rows: ProjectOverviewRows = { ...empty, members: [{ projectId: 'member', person: me }] };
    const list = buildProjectOverview(
      [project('owner', { ownerId: 'viewer' }), project('manager', { managerId: 'viewer' }), project('member'), project('creator', { createdById: 'viewer' }), project('other')],
      rows,
      opts,
    );
    expect(Object.fromEntries(list.map((p) => [p.id, p.mine]))).toEqual({ owner: true, manager: true, member: true, creator: false, other: false });
  });
});
