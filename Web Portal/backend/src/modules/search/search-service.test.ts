import { describe, it, expect } from 'vitest';
import { searchAll, createSearchService, taskMatches, GLOBAL_TASK_LIMIT, type SearchData } from './search-service';

const data: SearchData = {
  tasks: [{ id: 't1', key: 'MICO-1', title: 'Prepare monthly report', projectId: 'p1' }],
  projects: [{ id: 'p1', code: 'MICO', name: 'MICO360 Platform' }],
  users: [{ id: 'u1', username: 'ada', email: 'ada@x.co', firstName: 'Ada', lastName: 'Lovelace' }],
};

describe('searchAll', () => {
  it('matches task titles and keys', () => {
    expect(searchAll('report', data).tasks).toHaveLength(1);
    expect(searchAll('mico-1', data).tasks).toHaveLength(1);
  });

  it('matches a task by a key it had before it moved project', () => {
    const moved = { ...data, tasks: [{ id: 't5', key: 'OPS-17', title: 'Inspect', projectId: 'p1', formerKeys: ['RIG-4'] }] };
    expect(searchAll('rig-4', moved).tasks.map((t) => t.id)).toEqual(['t5']);
    expect(taskMatches({ title: 'Inspect', key: 'OPS-17', formerKeys: ['RIG-4'] }, 'rig-4')).toBe(true);
    expect(taskMatches({ title: 'Inspect', key: 'OPS-17' }, 'rig-4')).toBe(false);
  });

  it('matches a task number however it is typed, now or before it moved (1.22.3)', () => {
    for (const q of ['mico1', 'MICO 1', 'mico_1', '#MICO-1']) expect(searchAll(q, data).tasks.map((t) => t.id), q).toEqual(['t1']);
    const moved = { ...data, tasks: [{ id: 't5', key: 'OPS-17', title: 'Inspect', projectId: 'p1', formerKeys: ['RIG-4'] }] };
    expect(searchAll('rig 4', moved).tasks.map((t) => t.id)).toEqual(['t5']);
    expect(taskMatches({ title: 'Inspect', key: 'OPS-17', formerKeys: ['RIG-4'] }, 'rig4')).toBe(true);
    expect(taskMatches({ title: 'Inspect', key: 'OPS-17' }, 'ops 1')).toBe(false); // exactly that number
  });

  it('matches projects by code or name across all types', () => {
    const r = searchAll('MICO', data);
    expect(r.tasks).toHaveLength(1); // MICO-1
    expect(r.projects).toHaveLength(1);
  });

  it('matches users by name/username — never by (or with) their email', () => {
    expect(searchAll('lovelace', data).users).toHaveLength(1);
    expect(searchAll('ada', data).users).toHaveLength(1);
    expect(searchAll('ada@x', data).users).toHaveLength(0); // email is not searchable
    expect(searchAll('lovelace', data).users[0]).not.toHaveProperty('email'); // …nor returned to clients
  });

  it('scopes tasks and projects to allowedProjectIds (null = unscoped admin)', () => {
    const scoped: SearchData = {
      ...data,
      tasks: [...data.tasks, { id: 't2', key: 'RIG-1', title: 'Prepare rig report', projectId: 'p2' }],
      projects: [...data.projects, { id: 'p2', code: 'RIG', name: 'Rig Inspection' }],
    };
    const member = searchAll('report', scoped, { allowedProjectIds: ['p1'] });
    expect(member.tasks.map((t) => t.key)).toEqual(['MICO-1']);
    expect(searchAll('rig', scoped, { allowedProjectIds: ['p1'] }).projects).toHaveLength(0);
    expect(searchAll('report', scoped, { allowedProjectIds: null }).tasks).toHaveLength(2);
  });

  it('companies: people a person may find, a picked company’s meetings, and an invitation without its notes', () => {
    const withCompanies: SearchData = {
      ...data,
      users: [...data.users, { id: 'u2', username: 'bob', firstName: 'Bob', lastName: 'Builder' }],
      meetings: [
        { id: 'mA', title: 'Site walk', projectId: 'pA', organizerId: 'u9', attendeeUserIds: ['u1'], content: 'agenda one — secret note', inviteeContent: 'agenda one' },
        { id: 'mN', title: 'Office party', projectId: null, organizerId: 'u1', attendeeUserIds: [], content: 'cake', companyId: 'B' },
      ],
    };
    const companies = new Map([['pA', ['A']]]);
    // People: only those in the set (colleagues); none = everyone (an admin).
    expect(searchAll('bob', withCompanies, { people: new Set(['u1']) }).users).toEqual([]);
    expect(searchAll('bob', withCompanies, { people: null }).users.map((u) => u.id)).toEqual(['u2']);
    // u1 attends mA but shares no company with its project (A): found by its agenda, never its notes.
    const asInvitee = { allowedProjectIds: [], userId: 'u1', companyIds: ['B'] };
    expect(searchAll('secret', withCompanies, asInvitee, companies).meetings).toEqual([]);
    expect(searchAll('agenda', withCompanies, asInvitee, companies).meetings.map((m) => [m.id, m.snippet])).toEqual([['mA', 'agenda one']]);
    // The same person in company A sees the whole meeting.
    expect(searchAll('secret', withCompanies, { ...asInvitee, companyIds: ['A'] }, companies).meetings.map((m) => m.id)).toEqual(['mA']);
    // With pick B: B's no-project meeting, not the invitation to A's project meeting.
    expect(searchAll('a', withCompanies, { ...asInvitee, pick: 'B' }, companies).meetings.map((m) => m.id)).toEqual(['mN']);
    expect(searchAll('cake', withCompanies, { ...asInvitee, pick: 'A' }, companies).meetings).toEqual([]);
    // An administrator with a pick: every meeting of that company.
    expect(searchAll('party', withCompanies, { allowedProjectIds: [], userId: 'admin', admin: true, pick: 'B' }, companies).meetings.map((m) => m.id)).toEqual(['mN']);
  });

  it('returns everything empty for a blank query', () => {
    const r = searchAll('   ', data);
    expect(r.tasks).toHaveLength(0);
    expect(r.projects).toHaveLength(0);
    expect(r.users).toHaveLength(0);
  });
});

describe('searchAll — Arabic', () => {
  const arabic: SearchData = {
    tasks: [{ id: 't1', key: 'MICO-7', title: 'إدارة المشروع', projectId: 'p1' }],
    projects: [{ id: 'p1', code: 'MSH', name: 'مُستشفى الأمل' }],
    users: [{ id: 'u1', username: 'ahmad', firstName: 'أحمد', lastName: 'علي' }],
  };
  it('matches hamza/alef, ta marbuta, alef maksura and diacritic variants', () => {
    expect(searchAll('ادارة', arabic).tasks).toHaveLength(1);
    expect(searchAll('مستشفي الامل', arabic).projects).toHaveLength(1);
    expect(searchAll('احمد', arabic).users).toHaveLength(1);
  });
});

describe('SearchService', () => {
  it('searches via the data source', async () => {
    const svc = createSearchService({ data: { async getSearchData() { return data; } } });
    const r = await svc.search('report');
    expect(r.tasks[0]!.key).toBe('MICO-1');
  });

  it('finds tasks with the task search engine (the caller’s projects, the best few)', async () => {
    const calls: { q: string; projectIds: string[] | null; limit: number }[] = [];
    const svc = createSearchService({
      data: { async getSearchData() { return { ...data, tasks: [] }; } },
      tasks: {
        async search(input) {
          calls.push({ q: input.q, projectIds: input.scope.projectIds, limit: input.limit });
          return { hits: [{ id: 't9', key: 'MICO-9', title: 'Prepare monthly report', projectId: 'p1' }], nextOffset: null };
        },
      },
    });
    const r = await svc.search('report', { allowedProjectIds: ['p1'] });
    expect(r.tasks.map((t) => t.key)).toEqual(['MICO-9']);
    expect(calls).toEqual([{ q: 'report', projectIds: ['p1'], limit: GLOBAL_TASK_LIMIT }]);
    expect(GLOBAL_TASK_LIMIT).toBe(5);
    await svc.search('report');
    expect(calls[1]?.projectIds).toBeNull(); // an administrator: every project
    expect((await svc.search('   ')).tasks).toEqual([]); // a blank query never asks
    expect(calls).toHaveLength(2);
  });
});

// 1.23.1 — the live task search failed (a database error) and took every top-bar search down with it.
describe('SearchService — the task search failing never hides the other results', () => {
  const failing = (err: unknown) => ({ async search(): Promise<never> { throw err; } });

  it('projects, people and meetings still come back, with a flag; the error is handed over once', async () => {
    const boom = new Error('Unknown column');
    const told: unknown[] = [];
    const svc = createSearchService({ data: { async getSearchData() { return { ...data, meetings: [{ id: 'm1', title: 'MICO weekly', projectId: 'p1', organizerId: 'u1', attendeeUserIds: [], content: '' }] }; } }, tasks: failing(boom) });
    const r = await svc.search('mico', {}, { onTasksFailed: (err) => told.push(err) });
    expect(r.tasks).toEqual([]);
    expect(r.tasksUnavailable).toBe(true);
    expect(r.projects.map((p) => p.code)).toEqual(['MICO']);
    expect(r.meetings.map((m) => m.id)).toEqual(['m1']);
    expect(told).toEqual([boom]);
  });

  it('a search that worked says nothing about it', async () => {
    const svc = createSearchService({ data: { async getSearchData() { return data; } }, tasks: { async search() { return { hits: [], nextOffset: null }; } } });
    expect(await svc.search('mico')).not.toHaveProperty('tasksUnavailable');
  });

  it('the rest failing still fails the search (nothing to show)', async () => {
    const svc = createSearchService({ data: { async getSearchData() { throw new Error('down'); } }, tasks: failing(new Error('x')) });
    await expect(svc.search('mico')).rejects.toThrow('down');
  });
});
