import { describe, it, expect } from 'vitest';
import { appSource as src, hasWeb, readWeb } from '../testing/web-source';
import { DETAIL, SIG_DRAWN, fakeApiClient, fakeInspectionServer } from '../testing/inspection-fixtures';
import { FLUSH_ALL_EVERY_MS, RETRY_EVERY_MS, SEND_DELAY_MS, createInspectionOutboxes } from './inspection-outboxes';
import { createMemoryStore } from './storage';

/** One inspection outbox per person on the phone; sending; sign-out (Stage 4 Task 5, Review Focus 2). */

it('on a shared phone another person never sees, counts or sends the first person’s unsent inspection', async () => {
  let who: string | null = 'u1';
  const server = fakeInspectionServer({ detail: DETAIL });
  const all = createInspectionOutboxes({ store: createMemoryStore(), api: fakeApiClient(server, () => who) });
  await all.ready;
  all.outboxFor('u1').remember('u1', DETAIL);
  all.outboxFor('u1').saveAnswer('u1', 'i1', { itemId: 'a', result: 'FAIL', reading: null, note: 'Loose' });
  who = 'u2'; // u1's session ended (expired / lock screen), u2 signs in
  expect(all.outboxFor('u2').waiting('u2')).toEqual([]);
  expect(all.outboxFor('u2').view('u2', 'i1')).toBeNull();
  expect(all.unsentCount('u2')).toBe(0);
  await all.outboxFor('u2').flushAll('u2');
  expect(server.calls).toEqual([]);
  expect((await all.outboxFor('u1').flush('u1', 'i1')).state).toBe('signed-out');
  expect(server.calls).toEqual([]);
  who = 'u1';
  expect((await all.outboxFor('u1').flush('u1', 'i1')).state).toBe('sent');
  expect(server.answersOf('i1').a).toMatchObject({ result: 'FAIL', note: 'Loose' });
});

it('the sign-out question counts unsent answers, follow-up requests and a waiting finish', async () => {
  const all = createInspectionOutboxes({ store: createMemoryStore(), api: fakeApiClient(fakeInspectionServer(), () => 'u1') });
  await all.ready;
  const o = all.outboxFor('u1');
  expect(all.outboxFor('u1')).toBe(o); // one outbox per person
  o.remember('u1', DETAIL);
  o.saveAnswer('u1', 'i1', { itemId: 'a', result: 'FAIL', reading: null, note: null });
  o.saveAnswer('u1', 'i1', { itemId: 'p', result: null, reading: '12', note: null });
  o.queueFollowUps('u1', 'i1', ['a'], undefined);
  o.queueFinish('u1', 'i1', [SIG_DRAWN]);
  expect(all.unsentCount('u1')).toBe(4);
  expect(all.unsentCount(null)).toBe(0);
  expect(all.unsentCount('u2')).toBe(0);
});

it('signing out on purpose removes only that person’s inspection records, kept or waiting, on the phone and in the app', async () => {
  const disk = createMemoryStore();
  const all = createInspectionOutboxes({ store: disk, api: fakeApiClient(fakeInspectionServer(), () => 'u1') });
  await all.ready;
  expect(all.isReady()).toBe(true);
  all.outboxFor('u1').remember('u1', DETAIL);
  all.outboxFor('u1').saveAnswer('u1', 'i1', { itemId: 'a', result: 'PASS', reading: null, note: null });
  all.outboxFor('u2').remember('u2', { ...DETAIL, id: 'i2' });
  await all.storage.settled();
  await all.clearOwner('u1');
  expect(await disk.keys()).toEqual(['mico360.inspection.u2.i2']);
  expect(all.outboxFor('u1').waiting('u1')).toEqual([]);
  expect(all.outboxFor('u1').view('u1', 'i1')).toBeNull();
});

it('records kept on the phone are read back when the app starts again', async () => {
  const disk = createMemoryStore();
  const first = createInspectionOutboxes({ store: disk, api: fakeApiClient(fakeInspectionServer(), () => 'u1') });
  await first.ready;
  first.outboxFor('u1').remember('u1', DETAIL);
  first.outboxFor('u1').saveAnswer('u1', 'i1', { itemId: 'a', result: 'PASS', reading: null, note: null });
  await first.storage.settled();
  const again = createInspectionOutboxes({ store: disk, api: fakeApiClient(fakeInspectionServer(), () => 'u1') });
  expect(again.isReady()).toBe(false);
  await again.ready;
  expect(again.unsentCount('u1')).toBe(1);
});

describe.skipIf(!hasWeb('frontend/src/lib/inspection-sync.ts'))('the website’s timings and query keys', () => {
  it('sends on the website’s timings and refreshes the website’s queries', () => {
    const web = readWeb('frontend/src/lib/inspection-sync.ts');
    expect([SEND_DELAY_MS, RETRY_EVERY_MS, FLUSH_ALL_EVERY_MS]).toEqual([400, 20_000, 60_000]);
    expect(web).toContain('const SEND_DELAY_MS = 400;');
    expect(web).toContain('const RETRY_EVERY_MS = 20_000;');
    expect(web).toContain('setInterval(() => void flush(), 60_000)');
    for (const key of ["['inspection', inspectionId]", "['project-inspections', projectId]", "['task-inspections']"]) {
      expect(web).toContain(key);
      expect(src('core/inspection-sync.ts')).toContain(key);
    }
  });
});

it('waiting inspections are sent on sign-in, back online, in front again and every minute', () => {
  const s = src('core/inspection-sync.ts');
  for (const m of ['connectivity.subscribe(', "AppState.addEventListener('change'", 'FLUSH_ALL_EVERY_MS', 'flushAll(ownerId', 'await inspections.ready']) expect(s, m).toContain(m);
  expect(src('core/providers.tsx')).toContain('useInspectionOutboxSync();');
});

it('a person’s sends go only with their own session', () => expect(src('lib/inspection-outboxes.ts')).toMatch(/inspectionsApi\(deps\.api\.forUser\(ownerId\)\)/));

it('Sign out asks first when inspection changes are unsent', () =>
  expect(src('components/account/SignOutButton.tsx')).toMatch(/signOutQuestion\(queued\.pending\.length \+ queued\.failed\.length \+ inspections\.unsentCount\(/));

it('the app’s sign-out clears the person’s inspections', () => expect(src('core/services.ts')).toMatch(/clearInspections: \(id\) => inspections\.clearOwner\(id\)/));
