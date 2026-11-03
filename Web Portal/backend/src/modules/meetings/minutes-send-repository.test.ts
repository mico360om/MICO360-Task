import { describe, it, expect } from 'vitest';
import { createMemoryMinutesSendRepository, suggestedAddresses, type MinutesSendRecord } from './minutes-send-repository';

const send = (over: Partial<MinutesSendRecord> = {}): Omit<MinutesSendRecord, 'id' | 'sentAt'> => ({
  meetingId: 'm1',
  sentById: 'u1',
  final: false,
  to: [{ email: 'ana@alpha.test', name: 'Ana Alpha', userId: 'u1', copy: 'shared' }],
  cc: [],
  results: [{ email: 'ana@alpha.test', ok: true }],
  ...over,
});

describe('the minutes sent log (memory)', () => {
  it('keeps each send and lists a meeting’s sends newest first', async () => {
    let t = Date.parse('2026-11-03T08:00:00Z');
    const repo = createMemoryMinutesSendRepository({ now: () => new Date((t += 60_000)) });
    const first = await repo.create(send());
    const second = await repo.create(send({ final: true, cc: [{ email: 'boss@outside.co', name: null, copy: 'shared' }] }));
    await repo.create(send({ meetingId: 'm2' }));
    expect(first).toMatchObject({ id: expect.any(String), meetingId: 'm1', sentAt: new Date('2026-11-03T08:01:00Z') });
    expect((await repo.listByMeeting('m1')).map((s) => s.id)).toEqual([second.id, first.id]);
    expect((await repo.listByMeeting('m1', 1)).map((s) => s.id)).toEqual([second.id]);
  });

  it('suggests the addresses used in earlier sends of the same project’s meetings (a meeting without a project: its own)', async () => {
    const projectOf: Record<string, string | null> = { m1: 'p1', m2: 'p1', m3: 'p2', m4: null };
    const repo = createMemoryMinutesSendRepository({ projectOf: async (id) => projectOf[id] ?? null });
    await repo.create(send({ meetingId: 'm2', cc: [{ email: 'client@outside.co', name: null, copy: 'shared' }] }));
    await repo.create(send({ meetingId: 'm3', cc: [{ email: 'other@p2.co', name: null, copy: 'shared' }] }));
    await repo.create(send({ meetingId: 'm4', cc: [{ email: 'own@m4.co', name: null, copy: 'shared' }] }));
    expect((await repo.recentAddresses('m1')).map((a) => a.email)).toEqual(['ana@alpha.test', 'client@outside.co']);
    expect((await repo.recentAddresses('m4')).map((a) => a.email)).toEqual(['ana@alpha.test', 'own@m4.co']);
  });
});

describe('suggestedAddresses', () => {
  const at = (iso: string) => new Date(iso);
  const row = (sentAt: string, to: MinutesSendRecord['to'], cc: MinutesSendRecord['cc'] = []): MinutesSendRecord => ({
    id: sentAt,
    meetingId: 'm1',
    sentById: 'u1',
    sentAt: at(sentAt),
    final: false,
    to,
    cc,
    results: [],
  });

  it('newest first, each address once (case aside), never someone sent their own copy (another company)', () => {
    const older = row('2026-11-01T08:00:00Z', [{ email: 'Ana@alpha.test', name: 'Ana Alpha', userId: 'u1', copy: 'shared' }, { email: 'bob@beta.test', name: 'Bob', userId: 'u9', copy: 'own' }]);
    const newer = row('2026-11-02T08:00:00Z', [{ email: 'ana@alpha.test', name: 'Ana Alpha', userId: 'u1', copy: 'shared' }], [{ email: 'client@outside.co', name: null, copy: 'shared' }]);
    expect(suggestedAddresses([newer, older])).toEqual([
      { email: 'ana@alpha.test', name: 'Ana Alpha', userId: 'u1' },
      { email: 'client@outside.co', name: null },
    ]);
  });

  it('keeps to the limit', () => {
    const many = row('2026-11-02T08:00:00Z', Array.from({ length: 30 }, (_, i) => ({ email: `p${i}@x.co`, name: null, copy: 'shared' as const })));
    expect(suggestedAddresses([many], 20)).toHaveLength(20);
  });

  it('skips anything malformed in an old row', () => {
    const odd = { ...row('2026-11-02T08:00:00Z', []), to: [{ nope: true }, null, { email: 42 }] as unknown as MinutesSendRecord['to'] };
    expect(suggestedAddresses([odd])).toEqual([]);
  });
});
