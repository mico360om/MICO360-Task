import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_SCHEDULES,
  DEFAULT_POLICY,
  KIND_TYPES,
  POLICY_KINDS,
  REMINDER_KINDS,
  channelsFor,
  channelsForType,
  legacyMutedView,
  mergeLegacyMuted,
  normalizePolicy,
  normalizeSchedule,
  overdueStepAt,
  policyKindOfType,
  scheduleOffsets,
  type ChannelPrefs,
} from './policy';

describe('policy kinds', () => {
  it('maps every notice type to at most one kind', () => {
    const seen = new Map<string, string>();
    for (const k of POLICY_KINDS) for (const t of KIND_TYPES[k]) {
      expect(seen.has(t), `${t} is in ${seen.get(t)} and ${k}`).toBe(false);
      seen.set(t, k);
    }
    expect(policyKindOfType('TASK_OVERDUE')).toBe('overdue');
    expect(policyKindOfType('CHAT_MENTION')).toBe('mentions');
    expect(policyKindOfType('TASK_ESCALATION_ADMIN')).toBe('escalationAdmin');
    expect(policyKindOfType('MICO_AI_ANSWER')).toBeNull();
  });

  it('the reminder kinds are the planner’s own', () => {
    expect([...REMINDER_KINDS]).toEqual(['dueSoon', 'overdue', 'escalation', 'escalationAdmin', 'approvalWaiting', 'inactivity']);
  });
});

describe('company policy defaults and cleaning', () => {
  it('defaults carry today’s rules over: escalation after 3 days, every reminder on, email only for step 2 and mentions', () => {
    expect(DEFAULT_POLICY.escalation).toEqual({ step1Days: 3, step2Days: 5, admins: true, userIds: [] });
    expect(DEFAULT_POLICY.approvals).toEqual({ step1Days: 2, step2Days: 5 });
    expect(DEFAULT_POLICY.inactivity).toEqual({ assigneeDays: 5, managerDays: 10 });
    expect(Object.values(DEFAULT_POLICY.remindersOn).every(Boolean)).toBe(true);
    expect(DEFAULT_POLICY.quietHours).toEqual({ mode: 'workingHours', start: '18:00', end: '07:00', meetings: true, mentions: true });
    for (const k of POLICY_KINDS) expect(DEFAULT_POLICY.channels[k].email, k).toBe(k === 'escalationAdmin' || k === 'mentions');
    // Only kinds nobody could turn off before are required at first (nothing comes back on).
    expect(DEFAULT_POLICY.required).toEqual(['escalation', 'escalationAdmin', 'approvalWaiting']);
  });

  it('cleans stored or sent JSON: unknown keys dropped, numbers bounded, step 2 people unique', () => {
    const p = normalizePolicy({
      escalation: { step1Days: 0, step2Days: 999, admins: false, userIds: ['u1', 'u1', 7, ''] },
      approvals: { step1Days: 4 },
      inactivity: { assigneeDays: 12, managerDays: 6 },
      remindersOn: { inactivity: false, nonsense: true },
      required: ['overdue', 'overdue', 'nonsense'],
      quietHours: { mode: 'custom', start: '21:00', end: '6:00', meetings: false },
      channels: { overdue: { email: true }, nonsense: { bell: false } },
      extra: 1,
    });
    expect(p.escalation).toEqual({ step1Days: 1, step2Days: 60, admins: false, userIds: ['u1'] });
    expect(p.approvals).toEqual({ step1Days: 4, step2Days: 5 });
    // The manager's step can't come before the assignees'.
    expect(p.inactivity).toEqual({ assigneeDays: 12, managerDays: 12 });
    expect(p.remindersOn.inactivity).toBe(false);
    expect(p.remindersOn.overdue).toBe(true);
    expect(p.required).toEqual(['overdue']);
    expect(p.quietHours).toEqual({ mode: 'custom', start: '21:00', end: '06:00', meetings: false, mentions: true });
    expect(p.channels.overdue).toEqual({ bell: true, push: true, email: true });
    expect(p).not.toHaveProperty('extra');
    expect(normalizePolicy(null)).toEqual(DEFAULT_POLICY);
  });
});

describe('reminder schedules', () => {
  it('Standard and Critical are as the owner described them', () => {
    expect(BUILT_IN_SCHEDULES.STANDARD).toEqual({ name: 'Standard', steps: { before: [2], onDue: true, after: [1], repeatEvery: 2 } });
    expect(BUILT_IN_SCHEDULES.CRITICAL).toEqual({ name: 'Critical', steps: { before: [5, 2, 1], onDue: true, after: [], repeatEvery: 1 } });
  });

  it('cleans steps: whole working days 1–30, once each, latest first before the due day', () => {
    expect(normalizeSchedule({ before: [1, 5, 5, 0, 40, 2.5], onDue: 'yes', after: [3, 1], repeatEvery: 0 })).toEqual({ before: [5, 1], onDue: false, after: [1, 3], repeatEvery: null });
  });

  it('offsets: before the due day negative, the due day 0, the explicit days after positive', () => {
    expect(scheduleOffsets(BUILT_IN_SCHEDULES.STANDARD.steps)).toEqual([-2, 0, 1]);
    expect(scheduleOffsets(BUILT_IN_SCHEDULES.CRITICAL.steps)).toEqual([-5, -2, -1, 0]);
  });

  it('the overdue step reached after N working days: explicit days, then every R working days', () => {
    const std = BUILT_IN_SCHEDULES.STANDARD.steps; // 1 day after, then every 2
    expect([0, 1, 2, 3, 4, 5, 6, 9].map((n) => overdueStepAt(std, n))).toEqual([null, 1, 1, 3, 3, 5, 5, 9]);
    const crit = BUILT_IN_SCHEDULES.CRITICAL.steps; // every day overdue
    expect([1, 2, 7].map((n) => overdueStepAt(crit, n))).toEqual([1, 2, 7]);
    const once = { before: [], onDue: true, after: [2], repeatEvery: null };
    expect([1, 2, 10].map((n) => overdueStepAt(once, n))).toEqual([null, 2, 2]);
  });
});

describe('a person’s channels for a kind', () => {
  const policy = DEFAULT_POLICY;

  it('defaults come from the company; a required kind keeps its bell and push on', () => {
    expect(channelsFor({ muted: [] }, 'overdue', policy)).toEqual({ bell: true, push: true, email: false, required: false });
    const req = { ...policy, required: ['overdue' as const] };
    expect(channelsFor({ muted: ['TASK_OVERDUE'], channels: { overdue: { bell: false, push: false } } }, 'overdue', req)).toEqual({ bell: true, push: true, email: false, required: true });
  });

  it('review I1/I2: chat @mentions never email by default; muting MENTION alone (older apps) keeps mention emails off', () => {
    expect(channelsForType({ muted: [] }, 'MENTION', policy)!.email).toBe(true);
    expect(channelsForType({ muted: [] }, 'CHAT_MENTION', policy)!.email).toBe(false);
    expect(channelsForType({ muted: [], channels: { mentions: { email: true } } }, 'CHAT_MENTION', policy)!.email).toBe(true);
    const oldApp = { muted: ['MENTION'] };
    expect(channelsForType(oldApp, 'MENTION', policy)).toMatchObject({ bell: false, email: false });
    expect(channelsFor(oldApp, 'mentions', policy)).toMatchObject({ bell: false, email: false });
    // Chat mentions keep their bell (never switchable before).
    expect(channelsForType(oldApp, 'CHAT_MENTION', policy)!.bell).toBe(true);
  });

  it('a type muted before keeps the bell, push and email off (nothing comes back on)', () => {
    expect(channelsFor({ muted: ['MENTION', 'CHAT_MENTION'] }, 'mentions', policy)).toEqual({ bell: false, push: false, email: false, required: false });
    // …unless the person chose email for it since.
    expect(channelsFor({ muted: ['MENTION', 'CHAT_MENTION'], channels: { mentions: { email: true } } }, 'mentions', policy).email).toBe(true);
  });

  it('push needs the bell (it is the bell’s copy on the phone); email is its own choice', () => {
    expect(channelsFor({ muted: [], channels: { comments: { bell: false, push: true, email: true } } }, 'comments', policy)).toEqual({ bell: false, push: false, email: true, required: false });
  });

  it('a company default of off holds until the person turns it on', () => {
    const off = { ...policy, channels: { ...policy.channels, status: { bell: false, push: false, email: false } } };
    expect(channelsFor({ muted: [] }, 'status', off).bell).toBe(false);
    expect(channelsFor({ muted: [], channels: { status: { bell: true } } }, 'status', off)).toEqual({ bell: true, push: false, email: false, required: false });
  });
});

describe('older apps’ muted list', () => {
  const policy = { ...DEFAULT_POLICY, channels: { ...DEFAULT_POLICY.channels, status: { bell: false, push: true, email: false } } };

  it('reads as every type whose bell is off, required kinds never in it', () => {
    const view = legacyMutedView({ muted: ['TASK_COMMENT', 'TASK_ESCALATION'], channels: { overdue: { bell: false } } }, policy);
    expect(view.sort()).toEqual(['TASK_COMMENT', 'TASK_OVERDUE', 'TASK_STATUS'].sort());
  });

  it('a save from an older app: a type taken off the list turns that kind’s bell on; a kind all on the list turns it off', () => {
    const before: ChannelPrefs = { muted: ['TASK_COMMENT'], channels: { status: { bell: false } } };
    const after = mergeLegacyMuted(before, ['TASK_COMMENT', 'TASK_DUE_SOON'], policy);
    expect(after.muted.sort()).toEqual(['TASK_COMMENT', 'TASK_DUE_SOON']);
    expect(after.channels?.dueSoon?.bell).toBe(false);
    expect(after.channels?.status?.bell).toBe(true);
    // Unchanged ones stay as they were (comments: muted by the list).
    expect(channelsFor(after, 'comments', policy).bell).toBe(false);
  });

  it('review I5: the website turned Mentions off; Android (MENTION only) turns it back on', () => {
    const webOff: ChannelPrefs = { muted: ['MENTION', 'CHAT_MENTION'], channels: { mentions: { bell: false } } };
    const view = legacyMutedView(webOff, policy);
    expect(view).toEqual(expect.arrayContaining(['MENTION', 'CHAT_MENTION']));
    const after = mergeLegacyMuted(webOff, view.filter((t) => t !== 'MENTION'), policy);
    expect(channelsForType(after, 'MENTION', policy)!.bell).toBe(true);
    expect(legacyMutedView(after, policy)).not.toContain('MENTION');
  });

  it('review M6: sending back what was shown pins nothing (a company default stays the company’s)', () => {
    const prefs: ChannelPrefs = { muted: [] };
    const after = mergeLegacyMuted(prefs, legacyMutedView(prefs, policy), policy);
    expect(after.muted).toEqual([]);
    expect(after.channels?.status).toBeUndefined();
  });

  it('a required kind’s old mutes (not shown to older apps) are kept as they were', () => {
    const req = { ...policy, required: ['overdue' as const] };
    const after = mergeLegacyMuted({ muted: ['TASK_OVERDUE'] }, [], req);
    expect(after.muted).toEqual(['TASK_OVERDUE']);
  });
});
