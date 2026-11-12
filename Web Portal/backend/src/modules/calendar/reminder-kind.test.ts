import { describe, it, expect } from 'vitest';
import { DEFAULT_POLICY, POLICY_KINDS, REMINDER_KINDS, channelsForType, policyKindOfType } from '../notify-policy/policy';
import { decideDelivery } from '../notify-policy/delivery';
import { kindOfType } from '../notifications/notification-kinds';
import { TASK_REMINDER_TYPE } from './reminder-sweep';

describe('personal reminders are their own kind of notice (Settings → Notifications: "My reminders")', () => {
  it('TASK_REMINDER is the kind `reminders`: bell and phone push on, email off by default, never required, not a company reminder', () => {
    expect(TASK_REMINDER_TYPE).toBe('TASK_REMINDER');
    expect(POLICY_KINDS).toContain('reminders');
    expect(policyKindOfType('TASK_REMINDER')).toBe('reminders');
    expect(DEFAULT_POLICY.channels.reminders).toEqual({ bell: true, push: true, email: false });
    expect(DEFAULT_POLICY.required).not.toContain('reminders');
    expect((REMINDER_KINDS as readonly string[]).includes('reminders')).toBe(false);
    expect(channelsForType({ muted: [] }, 'TASK_REMINDER', DEFAULT_POLICY)).toEqual({ bell: true, push: true, email: false, required: false });
  });

  it('a person can switch it off or add email', () => {
    expect(channelsForType({ muted: [], channels: { reminders: { bell: false } } }, 'TASK_REMINDER', DEFAULT_POLICY)!.bell).toBe(false);
    expect(channelsForType({ muted: [], channels: { reminders: { email: true } } }, 'TASK_REMINDER', DEFAULT_POLICY)!.email).toBe(true);
  });

  it('follows quiet hours (owner 3: "per their settings and quiet hours"): the bell fills, the push waits for the morning', () => {
    const calendar = { workingDays: [0, 1, 2, 3, 4], holidays: [] };
    const ctx = { now: new Date('2026-11-11T18:00:00Z'), policy: DEFAULT_POLICY, calendar, hours: { start: '08:00', end: '17:00' }, companyZone: 'Asia/Muscat', personZone: 'Asia/Muscat' };
    const d = decideDelivery('TASK_REMINDER', { muted: [] }, ctx);
    expect(d.bell).toBe(true);
    expect(d.push).toBe('hold');
    expect(d.releaseAt).toEqual(new Date('2026-11-12T04:00:00Z'));
  });

  it('shows under the Notifications page’s Due chip', () => {
    expect(kindOfType('TASK_REMINDER')).toBe('due');
  });
});
