import { describe, it, expect } from 'vitest';
import { auditMinutesMovedAway } from './client-view-events';

describe('minutes taken off a client page because their meeting moved', () => {
  it('are written to the audit log as hidden, with the reason and both projects', async () => {
    const lines: unknown[] = [];
    const hook = auditMinutesMovedAway({ record: async (e) => void lines.push(e) });
    hook({ meetingId: 'm1', fromProjectId: 'pA', toProjectId: 'pB' });
    await new Promise((r) => setTimeout(r, 0));
    expect(lines).toEqual([
      { userId: null, ip: null, module: 'client-view', action: 'client-view.minutes.hidden', entityId: 'm1', newValue: { reason: 'moved', fromProjectId: 'pA', toProjectId: 'pB' } },
    ]);
  });

  it('a failing audit write never breaks the move', async () => {
    const hook = auditMinutesMovedAway({ record: async () => Promise.reject(new Error('audit table away')) });
    expect(() => hook({ meetingId: 'm1', fromProjectId: 'pA', toProjectId: null })).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });
});
