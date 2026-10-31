import { it, expect, vi } from 'vitest';
import { DETAIL, SIG_DRAWN, fakeInspectionServer } from '../testing/inspection-fixtures';
import { ALL_RECORDS_MAX_CHARS, INSPECTION_RECORD_PREFIX, RECORD_MAX_CHARS, StorageFullError, createMirroredDraftStorage } from './draft-storage';
import { createInspectionOutbox, removeOwnerRecords } from './inspection-outbox';
import { MAX_COPY_CHARS } from './read-cache';
import { createMemoryStore, type KeyValueStore } from './storage';

/** Inspection records kept in AsyncStorage through an in-memory mirror, safe when Android closes the app (Stage 4 Task 4). */

const open = async (disk: KeyValueStore, server: ReturnType<typeof fakeInspectionServer>, o?: { recordMax?: number; allMax?: number }) => {
  const s = createMirroredDraftStorage(disk, o);
  await s.hydrate();
  return { s, o: createInspectionOutbox({ storage: s, api: server.api }) };
};

it('answers, a follow-up request and a drawn signature made offline survive the app being closed, and go once, in order, when back online (Review Focus 1, 4)', async () => {
  const disk = createMemoryStore();
  const server = fakeInspectionServer({ detail: DETAIL });
  server.offline = true;
  const first = await open(disk, server);
  first.o.remember('u1', DETAIL);
  first.o.saveAnswer('u1', 'i1', { itemId: 'a', result: 'PASS', reading: null, note: null });
  first.o.saveAnswer('u1', 'i1', { itemId: 'p', result: 'PASS', reading: '162.5', note: 'Gauge 2' });
  first.o.queueFollowUps('u1', 'i1', ['p'], undefined);
  first.o.queueFinish('u1', 'i1', [SIG_DRAWN]);
  expect((await first.o.flush('u1', 'i1')).state).toBe('offline');
  await first.s.settled(); // Android closes the app here
  server.offline = false;
  const again = await open(disk, server);
  expect(again.o.view('u1', 'i1')).toMatchObject({ pending: { answers: 2, finish: true, followUps: 1 }, counts: { failed: 1 }, locked: true });
  // Back online (the app tries at once when the signal is back, so it doesn't wait out the retry).
  expect((await again.o.flush('u1', 'i1', { force: true })).state).toBe('sent');
  expect((await again.o.flush('u1', 'i1')).state).toBe('sent');
  expect(server.calls.map((c) => c.kind)).toEqual(['answer', 'follow-ups', 'finish']);
  expect(server.followUpTasks('i1')).toEqual(['p']);
  expect(server.signaturesOf('i1')).toEqual([expect.objectContaining({ method: 'DRAWN', image: SIG_DRAWN.image })]);
});

it('a follow-up request whose reply was lost is asked again, and the server still makes one task', async () => {
  const server = fakeInspectionServer({ detail: DETAIL });
  const { o } = await open(createMemoryStore(), server);
  o.remember('u1', DETAIL);
  o.saveAnswer('u1', 'i1', { itemId: 'a', result: 'FAIL', reading: null, note: null });
  o.queueFollowUps('u1', 'i1', ['a'], null);
  server.loseNextReply = 'follow-ups';
  expect((await o.flush('u1', 'i1')).state).toBe('offline');
  expect((await o.flush('u1', 'i1', { force: true })).state).toBe('sent');
  expect(server.followUpTasks('i1')).toEqual(['a']);
  expect(o.view('u1', 'i1')!.followUpReport).toEqual([{ itemId: 'a', status: 'exists', taskKey: expect.any(String) }]);
});

it('a record past what Android can read back is kept in the app and the screen is told (Review Focus 6)', async () => {
  const roomy = await open(createMemoryStore(), fakeInspectionServer());
  roomy.o.remember('u1', DETAIL);
  const size = roomy.s.get('mico360.inspection.u1.i1')!.length;
  const tight = await open(createMemoryStore(), fakeInspectionServer(), { recordMax: size + 200 });
  tight.o.remember('u1', DETAIL);
  expect(tight.o.saveAnswer('u1', 'i1', { itemId: 'a', result: 'FAIL', reading: null, note: 'x'.repeat(400) })).toEqual({ persisted: false });
  expect(tight.o.view('u1', 'i1')).toMatchObject({ persisted: false, pending: { answers: 1 } });
});

it('all records together stay under their share of the phone’s storage', async () => {
  const s = createMirroredDraftStorage(createMemoryStore(), { allMax: 10 });
  await s.hydrate();
  s.set('mico360.inspection.u1.i1', 'abcdef');
  s.set('mico360.inspection.u1.i1', 'abcdefgh'); // replacing a record counts its new size only
  expect(() => s.set('mico360.inspection.u1.i2', 'abc')).toThrow(StorageFullError);
  s.remove('mico360.inspection.u1.i1');
  s.set('mico360.inspection.u1.i2', 'abc');
  expect(s.keys()).toEqual(['mico360.inspection.u1.i2']);
  expect(new StorageFullError().name).toBe('QuotaExceededError');
  expect([INSPECTION_RECORD_PREFIX, RECORD_MAX_CHARS, ALL_RECORDS_MAX_CHARS]).toEqual(['mico360.inspection.', MAX_COPY_CHARS, 2_400_000]);
});

it('writes of one record land in order, the last one winning', async () => {
  const disk = createMemoryStore();
  const slowFirst = {
    ...disk,
    setItem: vi.fn(async (k: string, v: string) => {
      if (v === 'A') await new Promise((r) => setTimeout(r, 20));
      return disk.setItem(k, v);
    }),
  };
  const s = createMirroredDraftStorage(slowFirst);
  await s.hydrate();
  s.set('mico360.inspection.u1.i1', 'A');
  await Promise.resolve(); // the slow write of A has started
  s.set('mico360.inspection.u1.i1', 'B');
  await s.settled();
  expect(await disk.getItem('mico360.inspection.u1.i1')).toBe('B');
  s.set('mico360.inspection.u1.i1', 'A');
  s.remove('mico360.inspection.u1.i1');
  await s.settled();
  expect(await disk.getItem('mico360.inspection.u1.i1')).toBeNull();
});

it('a failed write is tried again with the next write', async () => {
  const disk = createMemoryStore();
  let fail = true;
  const flaky = {
    ...disk,
    setItem: async (k: string, v: string) => {
      if (fail) {
        fail = false;
        throw new Error('disk');
      }
      return disk.setItem(k, v);
    },
  };
  const s = createMirroredDraftStorage(flaky);
  await s.hydrate();
  s.set('mico360.inspection.u1.i1', 'A');
  await s.settled().catch(() => undefined);
  expect(s.unwritten()).toEqual(['mico360.inspection.u1.i1']);
  s.set('mico360.inspection.u1.i2', 'C');
  await s.settled();
  expect(s.unwritten()).toEqual([]);
  expect(await disk.getItem('mico360.inspection.u1.i1')).toBe('A');
});

it('reads only inspection records', async () => {
  const disk = createMemoryStore({ 'mico360.cache.u1.x': '{}', 'mico360.inspection.u1.i9': '{"v":1}' });
  const s = createMirroredDraftStorage(disk);
  expect(s.isHydrated()).toBe(false);
  await s.hydrate();
  expect(s.isHydrated()).toBe(true);
  expect(s.keys()).toEqual(['mico360.inspection.u1.i9']);
  expect(s.get('mico360.cache.u1.x')).toBeNull();
});

it('a record kept on the phone is never overwritten by a write made before it was read (Final I1)', async () => {
  const [i1, i2, i3] = ['mico360.inspection.u1.i1', 'mico360.inspection.u1.i2', 'mico360.inspection.u1.i3'];
  const disk = createMemoryStore({ [i1]: '{"kept":1}', [i2]: '{"kept":2}' });
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const slow = { ...disk, getItem: async (k: string) => (await gate, disk.getItem(k)) };
  const s = createMirroredDraftStorage(slow);
  const reading = s.hydrate();
  s.set(i1, '{"fresh":1}');
  s.remove(i2);
  s.set(i3, '{"new":3}');
  expect(s.get(i1)).toBeNull(); // nothing is answered before the phone's records are read
  release();
  await reading;
  await s.settled();
  expect([s.get(i1), await disk.getItem(i1)]).toEqual(['{"kept":1}', '{"kept":1}']);
  expect([s.get(i2), await disk.getItem(i2)]).toEqual([null, null]);
  expect([s.get(i3), await disk.getItem(i3)]).toEqual(['{"new":3}', '{"new":3}']);
});

it('opening an inspection before the phone has read its records keeps the answers waiting there (Final I1)', async () => {
  const disk = createMemoryStore();
  const first = await open(disk, fakeInspectionServer());
  first.o.remember('u1', DETAIL);
  first.o.saveAnswer('u1', 'i1', { itemId: 'a', result: 'FAIL', reading: null, note: 'Loose' });
  await first.s.settled();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const slow = { ...disk, getItem: async (k: string) => (await gate, disk.getItem(k)) };
  const s = createMirroredDraftStorage(slow);
  const reading = s.hydrate();
  const o = createInspectionOutbox({ storage: s, api: fakeInspectionServer().api });
  o.remember('u1', DETAIL); // the screen read the inspection before the records were read
  release();
  await reading;
  expect(o.view('u1', 'i1')).toMatchObject({ pending: { answers: 1 } });
});

it('a record the phone can’t read back is skipped, the others are read', async () => {
  const disk = createMemoryStore({ 'mico360.inspection.u1.i1': 'one', 'mico360.inspection.u1.i2': 'two' });
  const s = createMirroredDraftStorage({ ...disk, getItem: async (k: string) => (k.endsWith('i1') ? Promise.reject(new Error('Row too big')) : disk.getItem(k)) });
  await s.hydrate();
  expect(s.keys()).toEqual(['mico360.inspection.u1.i2']);
});

it('removing a person’s records removes them from the phone too', async () => {
  const disk = createMemoryStore();
  const { s, o } = await open(disk, fakeInspectionServer());
  o.remember('u1', DETAIL);
  o.remember('u2', { ...DETAIL, id: 'i2' });
  removeOwnerRecords(s, 'u1');
  await s.settled();
  expect(await disk.keys()).toEqual(['mico360.inspection.u2.i2']);
});
