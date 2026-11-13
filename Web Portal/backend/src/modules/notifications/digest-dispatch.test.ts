import { describe, it, expect } from 'vitest';
import { sendDigests } from './digest-dispatch';
import type { UserDigest } from './notification-digest';

// Review fix #28 (13 Nov 2026): the morning bell digest is sent first and only then marked as sent (as
// every other sweep does), and one person's failure no longer stops the digests of everyone after them.
const digest = (userId: string): UserDigest => ({
  userId,
  overdue: [{ key: 'P1-1', title: 'Pour slab', dueDate: '2026-11-12' }],
  dueToday: [{ key: 'P1-2', title: 'Order steel', dueDate: '2026-11-13' }],
});
function harness(opts: { failNotify?: string[]; failMark?: string[]; marked?: string[]; prefs?: Record<string, unknown> } = {}) {
  const marks = new Set(opts.marked ?? []);
  const steps: string[] = [];
  const errors: string[] = [];
  const deps = {
    day: '2026-11-13',
    prefsOf: (userId: string) => (userId === 'gone' ? undefined : (opts.prefs?.[userId] ?? null)),
    store: {
      has: async (key: string) => marks.has(key),
      add: async (key: string) => {
        if (opts.failMark?.some((u) => key.includes(u))) throw new Error('db blip');
        steps.push(`mark ${key}`);
        marks.add(key);
      },
    },
    notify: async (n: { userId: string; title: string; body: string; type: string; entityType: string; entityId: string }) => {
      if (opts.failNotify?.includes(n.userId)) throw new Error('db blip');
      steps.push(`notify ${n.userId} ${n.type} ${n.entityType}:${n.entityId} | ${n.title} | ${n.body.replace(/\n/g, ' / ')}`);
    },
    onError: (_err: unknown, userId: string) => void errors.push(userId),
  };
  return { deps, steps, errors, marks };
}

describe('sendDigests', () => {
  it('sends each person’s digest, THEN marks it sent for the day (same words as before)', async () => {
    const h = harness();
    expect(await sendDigests([digest('u1')], h.deps)).toBe(1);
    expect(h.steps).toEqual([
      'notify u1 TASK_DIGEST digest:2026-11-13 | Your daily digest — 1 overdue · 1 due today | • P1-1 Pour slab (overdue, due 2026-11-12) / • P1-2 Order steel (due today)',
      'mark digest:u1:2026-11-13',
    ]);
  });

  it('a notice that fails is not marked (the next hourly run sends it), and the people after it still get theirs', async () => {
    const h = harness({ failNotify: ['u1'] });
    expect(await sendDigests([digest('u1'), digest('u2'), digest('u3')], h.deps)).toBe(2);
    expect(h.errors).toEqual(['u1']);
    expect(h.marks.has('digest:u1:2026-11-13')).toBe(false);
    expect([...h.marks].sort()).toEqual(['digest:u2:2026-11-13', 'digest:u3:2026-11-13']);
  });

  it('a mark that fails after the notice went is logged and the rest go on', async () => {
    const h = harness({ failMark: ['u2'] });
    expect(await sendDigests([digest('u1'), digest('u2'), digest('u3')], h.deps)).toBe(3);
    expect(h.errors).toEqual(['u2']);
    expect(h.steps.filter((s) => s.startsWith('notify')).length).toBe(3);
  });

  it('once a day: someone already marked today is skipped; a muted digest and a person not in the audience aren’t written', async () => {
    const h = harness({ marked: ['digest:u1:2026-11-13'], prefs: { u2: { muted: ['TASK_DIGEST'] } } });
    expect(await sendDigests([digest('u1'), digest('u2'), digest('gone'), digest('u3')], h.deps)).toBe(1);
    expect(h.steps).toEqual([expect.stringMatching(/^notify u3 /), 'mark digest:u3:2026-11-13']);
  });
});
