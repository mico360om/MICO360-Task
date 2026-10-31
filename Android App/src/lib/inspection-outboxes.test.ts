import { describe, it, expect } from 'vitest';
import { appSource as src, hasWeb, readWeb } from '../testing/web-source';
import { DETAIL, SIG_DRAWN, fakeApiClient, fakeInspectionServer } from '../testing/inspection-fixtures';
import { FLUSH_ALL_EVERY_MS, RETRY_EVERY_MS, SEND_DELAY_MS, createInspectionOutboxes } from './inspection-outboxes';
import { createMemoryStore } from './storage';

/** One inspection outbox per person on the phone; sending; sign-out (Stage 4 Task 5, Review Focus 2). */

const SERVER = 'https://task.mico360.com/api/v1';

it('on a shared phone another person never sees, counts or sends the first person’s unsent inspection', async () => {
  let who: string | null = 'u1';
  const server = fakeInspectionServer({ detail: DETAIL });
  const all = createInspectionOutboxes({ store: createMemoryStore(), api: fakeApiClient(server, () => who), server: SERVER });
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
  const all = createInspectionOutboxes({ store: createMemoryStore(), api: fakeApiClient(fakeInspectionServer(), () => 'u1'), server: SERVER });
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
  const all = createInspectionOutboxes({ store: disk, api: fakeApiClient(fakeInspectionServer(), () => 'u1'), server: SERVER });
  await all.ready;
  expect(all.isReady()).toBe(true);
  all.outboxFor('u1').remember('u1', DETAIL);
  all.outboxFor('u1').saveAnswer('u1', 'i1', { itemId: 'a', result: 'PASS', reading: null, note: null });
  all.outboxFor('u2').remember('u2', { ...DETAIL, id: 'i2' });
  await all.storage.settled();
  await all.clearOwner('u1');
  expect(await disk.keys()).toEqual([all.recordKey('u2', 'i2')]);
  expect(all.outboxFor('u1').waiting('u1')).toEqual([]);
  expect(all.outboxFor('u1').view('u1', 'i1')).toBeNull();
});

it('records kept on the phone are read back when the app starts again', async () => {
  const disk = createMemoryStore();
  const first = createInspectionOutboxes({ store: disk, api: fakeApiClient(fakeInspectionServer(), () => 'u1'), server: SERVER });
  await first.ready;
  first.outboxFor('u1').remember('u1', DETAIL);
  first.outboxFor('u1').saveAnswer('u1', 'i1', { itemId: 'a', result: 'PASS', reading: null, note: null });
  await first.storage.settled();
  const again = createInspectionOutboxes({ store: disk, api: fakeApiClient(fakeInspectionServer(), () => 'u1'), server: SERVER });
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

it('records are kept per server: one made for another server is never shown, counted or sent here (Final I6)', async () => {
  const disk = createMemoryStore();
  const serverA = fakeInspectionServer({ detail: DETAIL });
  const a = createInspectionOutboxes({ store: disk, api: fakeApiClient(serverA, () => 'u1'), server: 'https://office.example.om/api/v1' });
  await a.ready;
  a.outboxFor('u1').remember('u1', DETAIL);
  a.outboxFor('u1').saveAnswer('u1', 'i1', { itemId: 'a', result: 'FAIL', reading: null, note: null });
  await a.storage.settled();
  // An inspection record in the old shape (before records named their server): kept, never sent.
  await disk.setItem('mico360.inspection.u1.i7', JSON.stringify({ v: 1, ownerId: 'u1', inspectionId: 'i7', projectId: 'pr1', title: 'Old', snapshot: DETAIL, answers: { a: { itemId: 'a', result: 'PASS', reading: null, note: null, editedAt: '2026-10-30T08:00:00.000Z' } }, finish: null, followUps: {}, problem: null, savedAt: '', sentAt: null }));
  const serverB = fakeInspectionServer({ detail: DETAIL });
  const b = createInspectionOutboxes({ store: disk, api: fakeApiClient(serverB, () => 'u1'), server: SERVER });
  await b.ready;
  expect(b.outboxFor('u1').waiting('u1')).toEqual([]);
  expect(b.outboxFor('u1').view('u1', 'i1')).toBeNull();
  expect(b.outboxFor('u1').view('u1', 'i7')).toBeNull();
  expect(b.unsentCount('u1')).toBe(0);
  await b.outboxFor('u1').flushAll('u1', { force: true });
  expect(serverB.calls).toEqual([]);
  await b.clearOwner('u1');
  expect((await disk.keys()).sort()).toEqual([a.recordKey('u1', 'i1'), 'mico360.inspection.u1.i7'].sort());
  // Back on the first server, its record is there and goes.
  const again = createInspectionOutboxes({ store: disk, api: fakeApiClient(serverA, () => 'u1'), server: 'https://office.example.om/api/v1' });
  await again.ready;
  expect(again.unsentCount('u1')).toBe(1);
  expect((await again.outboxFor('u1').flush('u1', 'i1')).state).toBe('sent');
  expect(serverA.calls.map((c) => c.kind)).toEqual(['answer']);
  expect(a.recordKey('u1', 'i1')).not.toBe(b.recordKey('u1', 'i1'));
  expect(a.recordKey('u1', 'i1')).toMatch(/^mico360\.inspection\.u1~[0-9a-z]+\.i1$/);
});

/** An inspection with both items answered and sent, and signed: its finish is the next send. */
async function signedAndReady(store = createMemoryStore()) {
  const server = fakeInspectionServer({ detail: DETAIL });
  const all = createInspectionOutboxes({ store, api: fakeApiClient(server, () => 'u1'), server: SERVER });
  await all.ready;
  const o = all.outboxFor('u1');
  o.remember('u1', DETAIL);
  o.saveAnswer('u1', 'i1', { itemId: 'a', result: 'PASS', reading: null, note: null });
  o.saveAnswer('u1', 'i1', { itemId: 'p', result: null, reading: '12', note: null });
  expect((await o.flush('u1', 'i1')).state).toBe('sent');
  o.queueFinish('u1', 'i1', [SIG_DRAWN]);
  let release!: () => void;
  server.hold = new Promise<void>((r) => (release = r));
  return { server, all, o, store, release };
}

it('a finish on its way when the person throws the record away doesn’t bring it back (Final I5)', async () => {
  const { all, o, store, release } = await signedAndReady();
  const going = o.flush('u1', 'i1');
  await new Promise((r) => setTimeout(r, 5)); // the finish has reached the server, its answer is on its way
  o.discard('u1', 'i1');
  release();
  expect((await going).state).toBe('sent');
  await Promise.resolve();
  await all.storage.settled();
  expect(o.view('u1', 'i1')).toBeNull();
  expect(await store.keys()).toEqual([]);
});

it('signing out waits for a send on its way, sends nothing more, and leaves nothing behind (Final I5)', async () => {
  const { server, all, o, store, release } = await signedAndReady();
  const going = o.flush('u1', 'i1');
  let cleared = false;
  const clearing = all.clearOwner('u1').then(() => (cleared = true));
  await new Promise((r) => setTimeout(r, 5));
  expect(cleared).toBe(false); // it waits for the finish on its way
  expect((await o.flush('u1', 'i2')).state).toBe('signed-out'); // and nothing new is sent meanwhile
  release();
  await going;
  await clearing;
  expect(o.view('u1', 'i1')).toBeNull();
  expect(await store.keys()).toEqual([]);
  expect(server.calls.filter((c) => c.kind === 'finish')).toHaveLength(1);
  // The same person signing in again can send again.
  o.remember('u1', { ...DETAIL, id: 'i3' });
  o.saveAnswer('u1', 'i3', { itemId: 'a', result: 'PASS', reading: null, note: null });
  server.hold = null;
  expect((await o.flush('u1', 'i3')).state).toBe('sent');
});
