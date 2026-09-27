import { describe, it, expect } from 'vitest';
import { searchAll, createSearchService, createCachedSearchDataSource, TASK_RESULT_LIMIT, type SearchData } from './search-service';

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

  it('uses the per-request database task search (scoped, capped) when the source offers it', async () => {
    const calls: { q: string; allowed: string[] | null; limit: number }[] = [];
    const svc = createSearchService({
      data: {
        async getSearchData() { return { ...data, tasks: [] }; },
        async searchTasks(q, allowed, limit) {
          calls.push({ q, allowed, limit });
          return [{ id: 't9', key: 'MICO-9', title: 'Prepare monthly report', projectId: 'p1' }];
        },
      },
    });
    const r = await svc.search('report', { allowedProjectIds: ['p1'] });
    expect(r.tasks.map((t) => t.key)).toEqual(['MICO-9']);
    expect(calls).toEqual([{ q: 'report', allowed: ['p1'], limit: TASK_RESULT_LIMIT }]);
    expect((await svc.search('   ')).tasks).toEqual([]); // blank query never hits the database
    expect(calls).toHaveLength(1);
  });

  it('keeps the per-request task search when the snapshot is cached', async () => {
    const inner = {
      async getSearchData() { return data; },
      async searchTasks() { return [{ id: 'x', key: 'X-1', title: 'x', projectId: 'p1' }]; },
    };
    const cached = createCachedSearchDataSource(inner, { ttlMs: 1000 });
    expect(await cached.searchTasks!('x', null, 5)).toHaveLength(1);
  });
});
