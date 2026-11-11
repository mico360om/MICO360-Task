import { addWorkingDays, daysBetween, workingDaysLate, type WorkCalendar } from '../../lib/working-days';
import { formatDay } from '../../lib/export-format';
import type { EnrolmentStatus, TrainingNoticeType } from './training-types';

/**
 * Training reminders (ruling R13), pure: what the hourly sweep sends through the Notification &
 * Scheduling engine today. Each notice has a key `np:tr:<type>:<enrolmentId>:<step>` recorded in
 * reminder_logs BEFORE it is sent (training-sweeps.ts), so each step goes once. Only the current step is
 * planned (a day the server missed is not sent late). Clients get none of these (badges only).
 *
 *   TRAINING_DUE_SOON   2 working days before the due day (b2) and on the due morning (d)
 *   TRAINING_OVERDUE    the learner 1 working day after, then every 2 working days (o1, o3, o5 …);
 *                       mandatory only: step 1 after the company's escalation.step1Days → Reports to, else
 *                       the Training managers of their companies, else administrators (e1); step 2 after
 *                       step2Days more → the Training managers, else administrators (e2) — once each
 *   TRAINING_EXPIRING   30 (x30) and 7 (x7) days before a certificate expires, and on expiry (x0: retake)
 */

export const REMINDER_KEY_PREFIX = 'np:tr:';

export interface ReminderEnrolment {
  enrolmentId: string;
  userId: string;
  learnerName: string;
  courseId: string;
  courseTitle: string;
  client: boolean;
  mandatory: boolean;
  /** The due day the person sees (an assignment's, a review's or a retake's). */
  dueDay: string | null;
  status: EnrolmentStatus;
  /** Whose working days and escalation numbers (the person's company); null: the site's. */
  companyId: string | null;
  /** An active staff account, or null. */
  reportsToId: string | null;
  /** The Training managers of the person's companies (active staff). */
  trainingManagerIds: readonly string[];
  adminIds: readonly string[];
}

export interface ReminderCertificate {
  certificateId: string;
  enrolmentId: string;
  userId: string;
  courseId: string;
  courseTitle: string;
  client: boolean;
  /** The site's day it expires. */
  expiresDay: string;
}

export interface ReminderRules {
  calendar: WorkCalendar;
  step1Days: number;
  step2Days: number;
}

export interface PlannedNotice {
  key: string;
  userId: string;
  type: TrainingNoticeType;
  title: string;
  body: string;
  entityType: 'training-course' | 'training-overdue';
  entityId: string;
}

const day = (key: string) => formatDay(key);
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

export function planTrainingReminders(i: { enrolments: readonly ReminderEnrolment[]; certificates: readonly ReminderCertificate[]; today: string; rulesOf: (companyId: string | null) => ReminderRules }): PlannedNotice[] {
  const out: PlannedNotice[] = [];
  const key = (type: TrainingNoticeType, enrolmentId: string, step: string) => `${REMINDER_KEY_PREFIX}${type}:${enrolmentId}:${step}`;
  for (const e of i.enrolments) {
    if (e.client || !e.dueDay || e.status === 'COMPLETED') continue;
    const rules = i.rulesOf(e.companyId);
    const due = e.dueDay;
    const learner = { userId: e.userId, entityType: 'training-course' as const, entityId: e.courseId };
    if (i.today === due) {
      out.push({ ...learner, key: key('TRAINING_DUE_SOON', e.enrolmentId, `d-${due}`), type: 'TRAINING_DUE_SOON', title: `Training due today: ${e.courseTitle}`, body: `Finish it today (${day(due)}).` });
      continue;
    }
    if (i.today < due) {
      if (i.today >= addWorkingDays(due, -2, rules.calendar)) {
        out.push({ ...learner, key: key('TRAINING_DUE_SOON', e.enrolmentId, `b2-${due}`), type: 'TRAINING_DUE_SOON', title: `Training due soon: ${e.courseTitle}`, body: `It is due ${day(due)}.` });
      }
      continue;
    }
    const late = workingDaysLate(due, i.today, rules.calendar);
    if (late < 1) continue;
    const step = 1 + 2 * Math.floor((late - 1) / 2);
    out.push({ ...learner, key: key('TRAINING_OVERDUE', e.enrolmentId, `o${step}-${due}`), type: 'TRAINING_OVERDUE', title: `Training overdue: ${e.courseTitle}`, body: `It was due ${day(due)} (${plural(late, 'working day')} ago).` });
    if (!e.mandatory) continue;
    const others = (ids: readonly string[]) => [...new Set(ids)].filter((id) => id !== e.userId);
    const tms = others(e.trainingManagerIds);
    const admins = others(e.adminIds);
    const escalate = (stepKey: string, to: string[]) => {
      for (const userId of to) {
        out.push({
          key: key('TRAINING_OVERDUE', e.enrolmentId, `${stepKey}-${due}`),
          userId,
          type: 'TRAINING_OVERDUE',
          title: `Overdue training: ${e.learnerName} — ${e.courseTitle}`,
          body: `${e.learnerName}’s mandatory training was due ${day(due)}: ${plural(late, 'working day')} late.`,
          entityType: 'training-overdue',
          entityId: e.courseId,
        });
      }
    };
    if (late >= rules.step1Days) {
      const boss = e.reportsToId && e.reportsToId !== e.userId ? [e.reportsToId] : [];
      escalate('e1', boss.length ? boss : tms.length ? tms : admins);
    }
    if (late >= rules.step1Days + rules.step2Days) escalate('e2', tms.length ? tms : admins);
  }
  for (const c of i.certificates) {
    if (c.client) continue;
    const left = daysBetween(i.today, c.expiresDay);
    const step = left <= 0 ? 'x0' : left <= 7 ? 'x7' : left <= 30 ? 'x30' : null;
    if (!step) continue;
    out.push({
      key: key('TRAINING_EXPIRING', c.enrolmentId, `${step}-${c.certificateId}`),
      userId: c.userId,
      type: 'TRAINING_EXPIRING',
      title: step === 'x0' ? `Certificate expired: ${c.courseTitle}` : `Certificate expires soon: ${c.courseTitle}`,
      body: step === 'x0' ? 'Take the course again to renew your certificate.' : `It expires ${day(c.expiresDay)}. Take the course again to renew it.`,
      entityType: 'training-course',
      entityId: c.courseId,
    });
  }
  return out;
}
