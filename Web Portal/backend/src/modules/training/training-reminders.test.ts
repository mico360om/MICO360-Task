import { describe, expect, it } from 'vitest';
import { planTrainingReminders, REMINDER_KEY_PREFIX, type ReminderCertificate, type ReminderEnrolment } from './training-reminders';

// Sunday-to-Thursday week (Oman); 2026-11-11 is a Wednesday.
const cal = { workingDays: [0, 1, 2, 3, 4], holidays: [] };
const rules = () => ({ calendar: cal, step1Days: 3, step2Days: 5 });
const E = (o: Partial<ReminderEnrolment> = {}): ReminderEnrolment => ({
  enrolmentId: 'e1',
  userId: 'ana',
  learnerName: 'Ana Alpha',
  courseId: 'c1',
  courseTitle: 'Tasks basics',
  client: false,
  mandatory: true,
  dueDay: '2026-11-15',
  status: 'IN_PROGRESS',
  companyId: 'A',
  reportsToId: 'boss',
  trainingManagerIds: ['tm1', 'tm2'],
  adminIds: ['adm'],
  ...o,
});
const plan = (today: string, enrolments: ReminderEnrolment[], certificates: ReminderCertificate[] = []) =>
  planTrainingReminders({ enrolments, certificates, today, rulesOf: rules });
const keys = (out: ReturnType<typeof plan>) => out.map((n) => `${n.key} → ${n.userId}`);

describe('R13 due soon', () => {
  it('2 working days before the due day, and on the due morning', () => {
    // Due Sunday 15 Nov: 2 working days before = Wednesday 11 Nov (Thu 12 is the 1st).
    expect(keys(plan('2026-11-10', [E()]))).toEqual([]);
    expect(keys(plan('2026-11-11', [E()]))).toEqual([`${REMINDER_KEY_PREFIX}TRAINING_DUE_SOON:e1:b2-2026-11-15 → ana`]);
    expect(keys(plan('2026-11-12', [E()]))).toEqual([`${REMINDER_KEY_PREFIX}TRAINING_DUE_SOON:e1:b2-2026-11-15 → ana`]);
    expect(keys(plan('2026-11-15', [E()]))).toEqual([`${REMINDER_KEY_PREFIX}TRAINING_DUE_SOON:e1:d-2026-11-15 → ana`]);
    const n = plan('2026-11-15', [E()])[0]!;
    expect(n).toMatchObject({ type: 'TRAINING_DUE_SOON', title: 'Training due today: Tasks basics', entityType: 'training-course', entityId: 'c1' });
  });

  it('nothing for finished training, no due day, or a client (badges only)', () => {
    expect(plan('2026-11-15', [E({ status: 'COMPLETED' })])).toEqual([]);
    expect(plan('2026-11-15', [E({ dueDay: null })])).toEqual([]);
    expect(plan('2026-11-15', [E({ client: true })])).toEqual([]);
  });
});

describe('R13 overdue and escalation', () => {
  it('the learner: 1 working day after, then every 2 working days (only the current step)', () => {
    // Due Sun 15; Mon 16 = 1 late, Tue 17 = 2, Wed 18 = 3.
    expect(keys(plan('2026-11-16', [E()]))).toEqual([`${REMINDER_KEY_PREFIX}TRAINING_OVERDUE:e1:o1-2026-11-15 → ana`]);
    expect(keys(plan('2026-11-17', [E({ mandatory: false })]))).toEqual([`${REMINDER_KEY_PREFIX}TRAINING_OVERDUE:e1:o1-2026-11-15 → ana`]);
    expect(keys(plan('2026-11-18', [E({ mandatory: false })]))).toEqual([`${REMINDER_KEY_PREFIX}TRAINING_OVERDUE:e1:o3-2026-11-15 → ana`]);
  });

  it('mandatory: step 1 after the company’s step-1 days → Reports to; step 2 after step-2 more → the Training managers', () => {
    const at3 = plan('2026-11-18', [E()]);
    expect(keys(at3)).toEqual([`${REMINDER_KEY_PREFIX}TRAINING_OVERDUE:e1:o3-2026-11-15 → ana`, `${REMINDER_KEY_PREFIX}TRAINING_OVERDUE:e1:e1-2026-11-15 → boss`]);
    expect(at3[1]).toMatchObject({ title: 'Overdue training: Ana Alpha — Tasks basics', entityType: 'training-overdue', entityId: 'c1' });
    // 9 working days late (Thu 26 Nov; step 2 is due from 3 + 5 = 8): step 2 to both Training managers.
    const at8 = plan('2026-11-26', [E()]);
    expect(keys(at8)).toEqual([
      `${REMINDER_KEY_PREFIX}TRAINING_OVERDUE:e1:o9-2026-11-15 → ana`,
      `${REMINDER_KEY_PREFIX}TRAINING_OVERDUE:e1:e1-2026-11-15 → boss`,
      `${REMINDER_KEY_PREFIX}TRAINING_OVERDUE:e1:e2-2026-11-15 → tm1`,
      `${REMINDER_KEY_PREFIX}TRAINING_OVERDUE:e1:e2-2026-11-15 → tm2`,
    ]);
  });

  it('no Reports to: step 1 to the Training managers, else administrators; never the learner themselves', () => {
    expect(keys(plan('2026-11-18', [E({ reportsToId: null })])).slice(1)).toEqual([`${REMINDER_KEY_PREFIX}TRAINING_OVERDUE:e1:e1-2026-11-15 → tm1`, `${REMINDER_KEY_PREFIX}TRAINING_OVERDUE:e1:e1-2026-11-15 → tm2`]);
    expect(keys(plan('2026-11-18', [E({ reportsToId: null, trainingManagerIds: [] })])).slice(1)).toEqual([`${REMINDER_KEY_PREFIX}TRAINING_OVERDUE:e1:e1-2026-11-15 → adm`]);
    expect(keys(plan('2026-11-18', [E({ userId: 'tm1', reportsToId: null })])).slice(1)).toEqual([`${REMINDER_KEY_PREFIX}TRAINING_OVERDUE:e1:e1-2026-11-15 → tm2`]);
    // Optional training never escalates.
    expect(keys(plan('2026-11-26', [E({ mandatory: false })]))).toHaveLength(1);
  });

  it('the review and retake due days count too', () => {
    expect(keys(plan('2026-11-16', [E({ status: 'REVIEW' })]))).toHaveLength(1);
    expect(keys(plan('2026-11-16', [E({ status: 'RETAKE' })]))).toHaveLength(1);
  });
});

describe('R13 certificates expiring', () => {
  const C = (expires: string, o: Partial<ReminderCertificate> = {}): ReminderCertificate => ({
    certificateId: 'cert1',
    enrolmentId: 'e1',
    userId: 'ana',
    courseId: 'c1',
    courseTitle: 'Tasks basics',
    client: false,
    expiresDay: expires,
    ...o,
  });
  it('30 and 7 days before, and on expiry (only the current step)', () => {
    expect(keys(plan('2026-11-11', [], [C('2026-12-20')]))).toEqual([]);
    expect(keys(plan('2026-11-11', [], [C('2026-12-11')]))).toEqual([`${REMINDER_KEY_PREFIX}TRAINING_EXPIRING:e1:x30-cert1 → ana`]);
    expect(keys(plan('2026-11-11', [], [C('2026-11-18')]))).toEqual([`${REMINDER_KEY_PREFIX}TRAINING_EXPIRING:e1:x7-cert1 → ana`]);
    const gone = plan('2026-11-11', [], [C('2026-11-11')]);
    expect(keys(gone)).toEqual([`${REMINDER_KEY_PREFIX}TRAINING_EXPIRING:e1:x0-cert1 → ana`]);
    expect(gone[0]!.title).toBe('Certificate expired: Tasks basics');
    expect(plan('2026-11-11', [], [C('2026-11-18', { client: true })])).toEqual([]);
  });
});
