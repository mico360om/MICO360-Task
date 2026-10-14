import { describe, it, expect } from 'vitest';
import { agendaTiming, primaryAction, responseSummary } from './meeting-flow';

describe('primaryAction', () => {
  it('offers the next step of the meeting to whoever manages it', () => {
    expect(primaryAction({ status: 'DRAFT', invitesSentAt: null }, true)).toBe('schedule');
    expect(primaryAction({ status: 'SCHEDULED', invitesSentAt: null }, true)).toBe('invite');
    expect(primaryAction({ status: 'SCHEDULED', invitesSentAt: '2026-10-01T00:00:00Z' }, true)).toBe('start');
    expect(primaryAction({ status: 'IN_PROGRESS', invitesSentAt: null }, true)).toBe('end');
    expect(primaryAction({ status: 'COMPLETED', invitesSentAt: null }, true)).toBe('email-minutes');
    expect(primaryAction({ status: 'CANCELLED', invitesSentAt: null }, true)).toBe('duplicate');
  });

  it('gives everyone else the minutes once the meeting is over, and nothing before', () => {
    expect(primaryAction({ status: 'COMPLETED', invitesSentAt: null }, false)).toBe('export-minutes');
    expect(primaryAction({ status: 'SCHEDULED', invitesSentAt: null }, false)).toBeNull();
  });
});

describe('agendaTiming', () => {
  it('totals planned minutes against the meeting length', () => {
    const items = [{ expectedMinutes: 20 }, { expectedMinutes: null }, { expectedMinutes: 25 }];
    expect(agendaTiming(items, '2026-10-01T06:00:00Z', '2026-10-01T07:00:00Z')).toEqual({ planned: 45, length: 60, over: 0, unplanned: 1 });
    expect(agendaTiming(items, '2026-10-01T06:00:00Z', '2026-10-01T06:30:00Z')).toEqual({ planned: 45, length: 30, over: 15, unplanned: 1 });
    expect(agendaTiming([], '2026-10-01T06:00:00Z', null)).toEqual({ planned: 0, length: null, over: 0, unplanned: 0 });
  });
});

describe('responseSummary', () => {
  it('counts answers to the invitation', () => {
    const s = responseSummary([{ response: 'ACCEPTED' }, { response: 'DECLINED' }, { response: 'PENDING' }, {}, { response: 'TENTATIVE' }, { response: 'ACCEPTED' }]);
    expect(s).toEqual({ ACCEPTED: 2, TENTATIVE: 1, DECLINED: 1, PENDING: 2 });
  });
});
