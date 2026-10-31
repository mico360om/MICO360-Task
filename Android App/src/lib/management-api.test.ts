/**
 * Management's requests (Stage 3 Task 6): the website's query for the same filters, the payload
 * unwrapped from { data }, each request sent as the person it is for.
 */
import { describe, it, expect } from 'vitest';
import { managementApi, managementQuery } from './management-api';
import { DEFAULT_FILTERS } from './management';
import { fakeApiClient } from '../testing/fake-api';
import { appSource as src, hasWeb, interfaceFields, loadWebTs, readWeb } from '../testing/web-source';

const params = (qs: string) => Object.fromEntries(qs.split('&').map((kv) => kv.split('=').map(decodeURIComponent)));

it('asks with the website’s query and unwraps data', async () => {
  const { client, calls } = fakeApiClient(); const api = managementApi(client); const f = { ...DEFAULT_FILTERS, projectIds: ['p1', 'p2'] };
  await api.access(); await api.overview(f); await api.items(f, { metric: 'late-tasks', projectId: 'p1', failed: true });
  expect(calls[0]).toBe('GET /management/access');
  expect(params(calls[1]!.replace('GET /management/overview?', ''))).toEqual({ projectIds: 'p1,p2', status: 'PLANNING,ACTIVE,ON_HOLD', weeks: '12' });
  expect(params(calls[2]!.replace('GET /management/items?', ''))).toMatchObject({ metric: 'late-tasks', projectId: 'p1', failed: '1' });
  expect(api.pdfPath(DEFAULT_FILTERS)).toBe('/management/overview.pdf?status=PLANNING%2CACTIVE%2CON_HOLD&weeks=12');
});

it('unwraps the payload and sends each request as the person it is for', async () => {
  const { client, opts } = fakeApiClient((_m, path) => (path === '/management/access' ? { allowed: true, scope: 'RUN' } : { title: 'x' }));
  const api = managementApi(client);
  expect(await api.access({ asUser: 'u1' })).toEqual({ allowed: true, scope: 'RUN' });
  expect(await api.items(DEFAULT_FILTERS, { metric: 'projects' }, { asUser: 'u1' })).toEqual({ title: 'x' });
  await api.overview(DEFAULT_FILTERS, { asUser: 'u1' });
  expect(opts).toEqual([{ asUser: 'u1' }, { asUser: 'u1' }, { asUser: 'u1' }]);
});

it('an owner and an odd id are encoded; a false or missing list field is left out', () => {
  const qs = managementQuery({ ...DEFAULT_FILTERS, ownerId: 'u 9', projectIds: ['a&b'] }, { metric: 'inspections', failed: false, formId: undefined });
  expect(qs).toBe('projectIds=a%26b&ownerId=u%209&status=PLANNING%2CACTIVE%2CON_HOLD&weeks=12&metric=inspections');
  expect(qs).not.toMatch(/^\?/);
});

it('the app’s copy of the address never uses URLSearchParams (React Native’s has no get/set)', () => expect(src('lib/management-api.ts')).not.toMatch(/URLSearchParams/));

describe.skipIf(!hasWeb('frontend/src/api/management.ts'))('the website’s API', () => {
  const web = loadWebTs('frontend/src/api/management.ts') as { filterParams: (f: unknown) => URLSearchParams };
  it('the same filters', () => { for (const f of [DEFAULT_FILTERS, { projectIds: ['a'], ownerId: 'u9', statuses: ['ACTIVE'], weeks: 26 }]) expect(params(managementQuery(f as never))).toEqual(Object.fromEntries(web.filterParams(f))); });
  it('the same fields', () => { for (const n of ['ManagementOverview', 'HealthRow', 'PersonRow', 'TrendRow', 'ItemRow', 'ItemList', 'ManagementFilters', 'RagReason', 'OptionProject', 'ItemQuery']) expect(interfaceFields(src('lib/management-api.ts'), n), n).toEqual(interfaceFields(readWeb('frontend/src/api/management.ts'), n)); });
});

it('Management’s hooks ask as the person, keyed by them, only once the server said yes, never from the offline copy', () => {
  const q = src('core/management-queries.ts');
  expect(q).toMatch(/function useManagementOverview[^]*?queryKey: managementOverviewKey\(userId \?\? '', f\)/);
  expect(q).toMatch(/function useManagementOverview[^]*?enabled: !!userId && allowed/);
  expect(q).toMatch(/function useManagementItems[^]*?queryKey: managementItemsKey\(userId \?\? '', f, q \?\? \{ metric: 'projects' \}\)/);
  expect(q).toMatch(/function useManagementItems[^]*?enabled: !!userId && allowed && !!q/);
  expect(q.match(/asUser: userId/g)?.length).toBeGreaterThanOrEqual(2);
  expect(q).toMatch(/refetchInterval: 300_000/);
  expect(q).toMatch(/placeholderData: samePersonPlaceholder\(userId \?\? ''\)/);
  expect(q).toMatch(/retry: \(n, e\) => !\(e instanceof ApiError && e\.status === 403\) && n < 1/);
  expect(q).not.toMatch(/reads\.read|readCache|queueOnOffline|persist/);
  expect(src('lib/resources.ts')).toMatch(/management: managementApi\(client\),/);
});
