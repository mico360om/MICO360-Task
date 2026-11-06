import { describe, expect, it } from 'vitest';
import { accountableManagerId, projectRisks, RISK_IDLE_DAYS, type RiskFacts } from './risks';

const facts = (over: Partial<RiskFacts> = {}): RiskFacts => ({
  status: 'ACTIVE',
  ownerId: 'owner',
  managerId: 'boss',
  managerMemberIds: ['mm1'],
  lateMilestones: [],
  milestonesAtRisk: [],
  workload: null,
  blockedLong: [],
  overdue: [],
  unassignedSoon: [],
  idleDays: 0,
  lastActivityDay: '2026-11-20',
  ...over,
});
const t = (id: string, assigneeIds: string[] = []) => ({ id, key: id.toUpperCase(), title: `Task ${id}`, assigneeIds });

describe('who is accountable for the project (the project manager)', () => {
  it('the named manager, else the first MANAGER member, else the owner', () => {
    expect(accountableManagerId(facts())).toBe('boss');
    expect(accountableManagerId(facts({ managerId: null }))).toBe('mm1');
    expect(accountableManagerId(facts({ managerId: null, managerMemberIds: [] }))).toBe('owner');
    expect(accountableManagerId(facts({ managerId: null, managerMemberIds: [], ownerId: null }))).toBeNull();
  });
});

describe('automatic risks, each with an explanation and who is accountable (owner answer 2)', () => {
  it('nothing wrong: no risks', () => {
    expect(projectRisks(facts())).toEqual([]);
  });

  it('a late milestone: red, its assignees accountable — else the project manager', () => {
    const [r] = projectRisks(facts({ lateMilestones: [{ ...t('m1', ['sara']), title: 'Handover', daysLate: 3, due: '2026-11-17' }] }));
    expect(r).toEqual({ code: 'MILESTONE_LATE', level: 'RED', title: 'Milestone “Handover” is 3 days late', detail: 'It was due 17 Nov and isn’t finished.', accountable: ['sara'], taskIds: ['m1'] });
    expect(projectRisks(facts({ lateMilestones: [{ ...t('m1'), title: 'Handover', daysLate: 1, due: '2026-11-19' }] }))[0]!.accountable).toEqual(['boss']);
  });

  it('a milestone at risk: amber, its assignees accountable — else the project manager', () => {
    const [r] = projectRisks(facts({ milestonesAtRisk: [{ ...t('m2', ['omar']), title: 'Design freeze', daysLeft: 3, open: 4, total: 6 }] }));
    expect(r).toEqual({
      code: 'MILESTONE_AT_RISK',
      level: 'AMBER',
      title: 'Milestone “Design freeze” is at risk',
      detail: 'Due in 3 days with 4 of 6 linked tasks still open.',
      accountable: ['omar'],
      taskIds: ['m2'],
    });
    expect(projectRisks(facts({ milestonesAtRisk: [{ ...t('m2'), title: 'X', daysLeft: 0, open: 1, total: 1 }] }))[0]).toMatchObject({ detail: 'Due today with 1 of 1 linked task still open.', accountable: ['boss'] });
  });

  it('one person holding 40%+ of the open work: the project manager is accountable', () => {
    const [r] = projectRisks(facts({ workload: { userId: 'omar', count: 9, openTotal: 15, pct: 60 } }), (id) => (id === 'omar' ? 'Omar Ahmed' : id));
    expect(r).toEqual({ code: 'WORKLOAD', level: 'AMBER', title: 'Omar Ahmed holds 60% of the open work', detail: '9 of 15 open tasks are assigned to them.', accountable: ['boss'], taskIds: [] });
  });

  it('tasks blocked over 7 days: their assignees (else the project manager); red from five', () => {
    const [r] = projectRisks(facts({ blockedLong: [{ ...t('a', ['sara']), days: 9 }, { ...t('b', ['omar', 'sara']), days: 12 }] }));
    expect(r).toEqual({ code: 'BLOCKED', level: 'AMBER', title: '2 tasks blocked for over 7 days', detail: 'The longest, B, has been held up 12 days.', accountable: ['omar', 'sara'], taskIds: ['b', 'a'] });
    expect(projectRisks(facts({ blockedLong: [{ ...t('a'), days: 8 }] }))[0]).toMatchObject({ title: '1 task blocked for over 7 days', detail: 'A has been held up 8 days.', accountable: ['boss'] });
    const five = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ ...t(id), days: 10 }));
    expect(projectRisks(facts({ blockedLong: five }))[0]).toMatchObject({ code: 'BLOCKED', level: 'RED' });
  });

  it('3+ tasks overdue 7+ days: red, their assignees and the manager accountable', () => {
    const overdue = [{ ...t('a', ['sara']), daysLate: 7 }, { ...t('b', ['omar']), daysLate: 21 }, { ...t('c'), daysLate: 9 }, { ...t('d', ['zara']), daysLate: 2 }];
    const [r] = projectRisks(facts({ overdue }));
    expect(r).toEqual({
      code: 'OVERDUE',
      level: 'RED',
      title: '3 tasks overdue by 7 days or more',
      detail: 'The oldest, B, is 21 days late.',
      accountable: ['omar', 'sara', 'boss'],
      taskIds: ['b', 'c', 'a'],
    });
    // Two that late (and others less late) are no risk of this kind.
    expect(projectRisks(facts({ overdue: overdue.slice(0, 2) }))).toEqual([]);
  });

  it('unassigned tasks due within 7 days: the project manager', () => {
    const [r] = projectRisks(facts({ unassignedSoon: [{ ...t('x'), daysLeft: 2 }, { ...t('y'), daysLeft: -1 }] }));
    expect(r).toEqual({
      code: 'UNASSIGNED',
      level: 'AMBER',
      title: '2 tasks due within 7 days have no one assigned',
      detail: 'Y is 1 day late; X is due in 2 days.',
      accountable: ['boss'],
      taskIds: ['y', 'x'],
    });
    expect(projectRisks(facts({ unassignedSoon: [{ ...t('x'), daysLeft: 0 }] }))[0]).toMatchObject({ title: '1 task due within 7 days has no one assigned', detail: 'X is due today.' });
  });

  it(`no activity for ${RISK_IDLE_DAYS}+ days: the project owner`, () => {
    expect(projectRisks(facts({ idleDays: 9 }))).toEqual([]);
    const [r] = projectRisks(facts({ idleDays: 12, lastActivityDay: '2026-11-08' }));
    expect(r).toEqual({ code: 'NO_ACTIVITY', level: 'AMBER', title: 'No activity for 12 days', detail: 'Nothing in the project has changed since 8 Nov.', accountable: ['owner'], taskIds: [] });
    expect(projectRisks(facts({ idleDays: 12, ownerId: null }))[0]!.accountable).toEqual(['boss']);
    // Review I2: only an ACTIVE project is expected to move (as the health rule judges it).
    for (const status of ['PLANNING', 'ON_HOLD', 'COMPLETED', 'ARCHIVED'] as const) expect(projectRisks(facts({ idleDays: 30, status }))).toEqual([]);
  });

  it('worst first: the red risks, then the amber ones, each in the rule’s order', () => {
    const risks = projectRisks(
      facts({
        idleDays: 15,
        unassignedSoon: [{ ...t('x'), daysLeft: 2 }],
        overdue: ['a', 'b', 'c'].map((id) => ({ ...t(id), daysLate: 8 })),
        milestonesAtRisk: [{ ...t('m2'), title: 'B', daysLeft: 3, open: 2, total: 2 }],
        lateMilestones: [{ ...t('m1'), title: 'A', daysLate: 2, due: '2026-11-18' }],
        workload: { userId: 'omar', count: 9, openTotal: 15, pct: 60 },
        blockedLong: [{ ...t('k'), days: 9 }],
      }),
    );
    expect(risks.map((r) => r.code)).toEqual(['MILESTONE_LATE', 'OVERDUE', 'MILESTONE_AT_RISK', 'WORKLOAD', 'BLOCKED', 'UNASSIGNED', 'NO_ACTIVITY']);
  });
});
