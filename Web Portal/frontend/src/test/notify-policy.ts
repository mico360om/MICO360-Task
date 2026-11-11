import { POLICY_KINDS, type PersonPolicy, type PolicyKind } from '../api/notification-settings';

/** A person's company rules as GET /notifications/policy answers (tests): every kind on, the defaults. */
export function personPolicy(over: { required?: PolicyKind[]; off?: PolicyKind[]; current?: Partial<Record<PolicyKind, Partial<{ bell: boolean; push: boolean; email: boolean }>>> } = {}): PersonPolicy {
  return {
    companyId: 'c1',
    companyName: 'Prolens Projects LLC',
    timeZone: 'Asia/Muscat',
    personZone: 'Asia/Muscat',
    weekStart: 0,
    workingDays: [0, 1, 2, 3, 4],
    hours: { start: '08:00', end: '17:00' },
    quietHours: { mode: 'workingHours', start: '18:00', end: '07:00', meetings: true, mentions: true },
    kinds: POLICY_KINDS.map((key) => {
      const required = over.required?.includes(key) ?? false;
      const defaults = { bell: true, push: true, email: key === 'escalationAdmin' || key === 'mentions' };
      return {
        key,
        types: [],
        required,
        defaults,
        emailChannel: key !== 'meetings',
        on: !(over.off?.includes(key) ?? false),
        current: { ...defaults, ...(over.current?.[key] ?? {}), required },
      };
    }),
  };
}
