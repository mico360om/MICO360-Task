import { it, expect } from 'vitest';
import { appSource as src } from '../testing/web-source';
import { DETAIL, SIG_DRAWN, fakeApiClient, fakeInspectionServer } from '../testing/inspection-fixtures';
import { createInspectionOutboxes } from './inspection-outboxes';
import { detailView } from './inspection-outbox';
import { ON_PHONE_TEXT, changesWaiting, keptRows } from './on-this-phone';
import { TASK_COPIES_KEPT, offlineCopyCaps, taskCopyKey } from './offline-copy';
import { createMemoryStore } from './storage';

/**
 * Device check B (31 Oct): restarted with no signal, an unfinished inspection couldn't be reached —
 * its task said "Could not load this task" and Projects only offered Retry; only a link opened it.
 * (1) The Dashboard (and the top of a project's Inspections tab) lists "On this phone": each
 * inspection the signed-in person has changes waiting for, or keeps on this phone unfinished, on
 * this server — read from the phone's own records, so it works with no signal — each with Open.
 * (2) A task's details are kept on the phone when it is read (an inspection's task is read when the
 * inspection is opened or started), so its page opens with no signal too.
 */
const SERVER = 'https://task.mico360.com/api/v1';
const second = { ...DETAIL, id: 'i2', title: 'Alpha walk', task: { id: 't2', key: 'RIG-2', title: 'Walk', done: false } };

async function phone() {
  const all = createInspectionOutboxes({ store: createMemoryStore(), api: fakeApiClient(fakeInspectionServer({ detail: DETAIL }), () => 'u1'), server: SERVER });
  await all.ready;
  return all;
}

it('lists the person’s kept inspections: changes waiting first, then the unfinished ones kept here', async () => {
  const all = await phone();
  const o = all.outboxFor('u1');
  o.remember('u1', DETAIL);
  o.remember('u1', second);
  o.saveAnswer('u1', 'i1', { itemId: 'a', result: 'FAIL', reading: null, note: null });
  o.saveAnswer('u1', 'i1', { itemId: 'p', result: null, reading: '12', note: null });
  expect(keptRows(all.kept('u1'))).toEqual([
    { inspectionId: 'i1', projectId: 'pr1', title: 'Rig check', taskKey: 'RIG-1', line: '2 changes waiting', label: 'Rig check, RIG-1, 2 changes waiting' },
    { inspectionId: 'i2', projectId: 'pr1', title: 'Alpha walk', taskKey: 'RIG-2', line: 'In progress', label: 'Alpha walk, RIG-2, In progress' },
  ]);
});

it('a signed inspection waiting to be sent says so', async () => {
  const all = await phone();
  const o = all.outboxFor('u1');
  o.remember('u1', DETAIL);
  o.queueFinish('u1', 'i1', [SIG_DRAWN]);
  expect(keptRows(all.kept('u1'))[0]).toMatchObject({ inspectionId: 'i1', line: 'Signed · waiting to finish' });
});

it('only this person’s records on this server, and a project’s own when asked', async () => {
  const store = createMemoryStore();
  const here = createInspectionOutboxes({ store, api: fakeApiClient(fakeInspectionServer(), () => 'u1'), server: SERVER });
  const elsewhere = createInspectionOutboxes({ store, api: fakeApiClient(fakeInspectionServer(), () => 'u1'), server: 'https://other.example.com/api/v1' });
  await Promise.all([here.ready, elsewhere.ready]);
  here.outboxFor('u1').remember('u1', DETAIL);
  here.outboxFor('u2').remember('u2', { ...DETAIL, id: 'i9' });
  elsewhere.outboxFor('u1').remember('u1', { ...DETAIL, id: 'i8' });
  here.outboxFor('u1').remember('u1', { ...second, projectId: 'pr2' });
  expect(keptRows(here.kept('u1')).map((r) => r.inspectionId)).toEqual(['i2', 'i1']);
  expect(keptRows(here.kept('u1'), 'pr1').map((r) => r.inspectionId)).toEqual(['i1']);
  expect(here.kept('u3')).toEqual([]);
});

it('a finished inspection with nothing waiting isn’t listed; one without a task still is', () => {
  const done = { ...detailView({ ...DETAIL, status: 'FINISHED' }) };
  expect(keptRows([done])).toEqual([]);
  const plain = detailView({ ...DETAIL, task: null });
  expect(keptRows([plain])).toEqual([{ inspectionId: 'i1', projectId: 'pr1', title: 'Rig check', taskKey: null, line: 'In progress', label: 'Rig check, In progress' }]);
});

it('says the changes in the app’s plain words', () => {
  // Headed "On this phone" (re-check note a): it lists unfinished ones with nothing waiting too.
  expect(ON_PHONE_TEXT).toEqual({ title: 'On this phone', open: 'Open' });
  expect(changesWaiting(1)).toBe('1 change waiting');
  expect(changesWaiting(3)).toBe('3 changes waiting');
});

it('the Dashboard and a project’s Inspections tab show the card, each row opening its inspection', () => {
  const card = src('components/inspections/OnThisPhoneCard.tsx');
  expect(card).toMatch(/const rows = useKeptInspections\(projectId\);/);
  expect(card).toMatch(/if \(!rows\.length\) return null;/);
  expect(card).toMatch(/navigation\.navigate\('Inspection', \{ inspectionId: r\.inspectionId, title: r\.title \}\)/);
  expect(src('core/inspection-sync.ts')).toMatch(/keptRows\(inspections\.kept\(ownerId\), projectId\)/);
  expect(src('screens/DashboardScreen.tsx')).toMatch(/<SyncStatus \/>\s*(\{\/\*[^]*?\*\/\}\s*)?<OnThisPhoneCard \/>/);
  const tab = src('components/project/InspectionsTab.tsx');
  expect(tab).toMatch(/<View style=\{s\.stack\}>\s*<OnThisPhoneCard projectId=\{projectId\} \/>/);
  expect(tab).toMatch(/waiting: Math\.max\(waiting\.length, kept\.length\),/); // kept ones count: not the first-run screen
});

it('a task’s details are kept on the phone (the most recent ones), and an inspection keeps its task', () => {
  expect(taskCopyKey('t1')).toBe('task.t1');
  const capOf = (key: string) => offlineCopyCaps().find((g) => g.matches(key));
  expect(capOf('task.t1')).toMatchObject({ name: 'task', keep: TASK_COPIES_KEPT });
  expect(TASK_COPIES_KEPT).toBe(50);
  expect(capOf('tasks.p1.all')).toBeUndefined();
  const q = src('core/queries.ts');
  expect(q).toMatch(/queryFn: \(\{ queryKey \}[^)]*\) => s\.reads\.read\(queryKey, taskCopyKey\(taskId\), \(\) => s\.resources\.tasks\.get\(taskId\)\)/);
  expect(q).toMatch(/export function useTask\(taskId: string\) \{\s*const s = useServices\(\);\s*return useQuery\(\{ \.\.\.taskQuery\(s, taskId\), enabled: !!taskId \}\);/);
  expect(q).toMatch(/void qc\.prefetchQuery\(taskQuery\(s, taskId\)\)/);
  expect(src('screens/InspectionScreen.tsx')).toMatch(/useKeepTaskCopy\(q\.data\?\.task\?\.id\);/);
});
