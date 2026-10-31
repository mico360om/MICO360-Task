import { describe, it, expect } from 'vitest';
import { fakeApiClient } from '../testing/fake-api';
import { appSource as src, hasWeb, interfaceFields, readWeb } from '../testing/web-source';
import { planningApi } from './planning-api';

/** Stage 3 Task 2: Timeline and Workload requests, the website's way, unwrapped from `{ data }`. */
it('asks the server the website’s way and unwraps data', async () => {
  const { client, calls } = fakeApiClient(); const api = planningApi(client);
  await api.timeline({ from: '2026-10-04', to: '2027-01-02', weekStart: 1 }); await api.timelineTasks('p1', { from: 'a', to: 'b' });
  await api.workload({ week: '2026-10-25' }); await api.workload({ week: '2026-10-25', projectId: 'p 1' });
  await api.swapAssignee('t1', { from: 'u1', to: 'u2', expectedVersion: 3 }); await api.moveDue('t1', { dueDate: '2026-10-31', expectedVersion: 3 }); await api.setDailyLimit(6);
  expect(calls).toEqual(['GET /timeline?from=2026-10-04&to=2027-01-02&weekStart=1', 'GET /timeline/projects/p1/tasks?from=a&to=b', 'GET /workload?week=2026-10-25', 'GET /workload?week=2026-10-25&projectId=p%201',
    'POST /tasks/t1/assignees/swap {"from":"u1","to":"u2","expectedVersion":3}', 'PUT /tasks/t1 {"dueDate":"2026-10-31","expectedVersion":3}', 'PUT /system-settings/workload.dailyLimit {"value":6}']);
});
it('sends each request as the person it is for, and returns what the server sent', async () => {
  const { client, opts } = fakeApiClient((_m, path) => (path.startsWith('/timeline?') ? { projects: [] } : undefined));
  const api = planningApi(client);
  expect(await api.timeline({ from: 'a', to: 'b', weekStart: 0 }, { asUser: 'u1' })).toEqual({ projects: [] });
  await api.swapAssignee('t 1', { from: 'u1', to: 'u2', expectedVersion: 1 }, { asUser: 'u1' });
  expect(opts.map((o) => o.asUser)).toEqual(['u1', 'u1']);
});
describe.skipIf(!hasWeb('frontend/src/api/planning.ts'))('the website’s types', () => {
  it('have the same fields', () => { for (const n of ['TimelineProject', 'TimelineData', 'TimelineTask', 'TimelineTasksData', 'WorkloadTask', 'WorkloadCell', 'WorkloadPerson', 'WorkloadData']) expect(interfaceFields(src('lib/planning-api.ts'), n), n).toEqual(interfaceFields(readWeb('frontend/src/api/planning.ts'), n)); });
});
it('planning hooks ask as the person, keyed by them, never from the offline copy', () => { const s = src('core/planning-queries.ts'); expect(s).toMatch(/asUser: userId/); expect(s).toMatch(/timelineKey\(userId,/); expect(s).not.toMatch(/reads\.read|readCache|queueOnOffline/); });
