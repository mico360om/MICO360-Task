import { describe, it, expect } from 'vitest';
import {
  otpCodeEmail,
  taskAssignedEmail,
  passwordResetEmail,
  welcomeEmail,
  accountActivationEmail,
  invitationEmail,
  approvalEmail,
  rejectionEmail,
  reminderEmail,
  workflowNotificationEmail,
  reportReadyEmail,
  alertEmail,
  mentionEmail,
  passwordChangedEmail,
  accountLockedEmail,
  genericNotificationEmail,
} from './email-templates';

describe('email templates (existing signatures preserved)', () => {
  it('otpCodeEmail includes the code and a code-related subject', () => {
    const e = otpCodeEmail('123456');
    expect(e.subject).toMatch(/code/i);
    expect(e.html).toContain('123456');
    expect(e.text).toContain('123456'); // plain-text alternative too
  });

  it('taskAssignedEmail includes the task key', () => {
    const e = taskAssignedEmail('Prepare report', 'MICO-1');
    expect(e.subject).toContain('MICO-1');
    expect(e.html).toContain('MICO-1');
  });

  it('passwordResetEmail includes the reset link', () => {
    const e = passwordResetEmail('https://app/reset?t=abc');
    expect(e.html).toContain('https://app/reset?t=abc');
  });

  it('welcomeEmail greets the user', () => {
    expect(welcomeEmail('ada').html).toContain('ada');
  });
});

describe('new notification templates', () => {
  it('accountActivationEmail has an activate CTA + link', () => {
    const e = accountActivationEmail('omar', 'https://app/activate?t=1');
    expect(e.subject).toMatch(/activate/i);
    expect(e.html).toContain('https://app/activate?t=1');
    expect(e.html).toContain('omar');
  });

  it('invitationEmail shows inviter, workspace, role + accept link', () => {
    const e = invitationEmail({ inviterName: 'Ada', orgName: 'MICO360', role: 'Member', acceptLink: 'https://app/invite?t=1' });
    expect(e.subject).toContain('Ada');
    expect(e.html).toContain('MICO360');
    expect(e.html).toContain('Member');
    expect(e.html).toContain('https://app/invite?t=1');
  });

  it('approvalEmail marks the item approved', () => {
    const e = approvalEmail({ itemName: 'Q4 Report', itemType: 'Report', approverName: 'Sara', link: 'https://app/x' });
    expect(e.subject).toMatch(/approved/i);
    expect(e.html).toContain('Q4 Report');
    expect(e.html).toContain('Sara');
  });

  it('rejectionEmail includes a reason when given', () => {
    const e = rejectionEmail({ itemName: 'Budget', itemType: 'Request', reason: 'Out of scope', link: 'https://app/x' });
    expect(e.html).toContain('Out of scope');
    expect(e.subject).toContain('Budget');
  });

  it('reminderEmail includes the due date + task', () => {
    const e = reminderEmail({ taskTitle: 'Ship it', taskKey: 'MICO-9', dueDate: 'Sep 10', link: 'https://app/x' });
    expect(e.subject).toContain('MICO-9');
    expect(e.html).toContain('Sep 10');
    expect(e.html).toContain('Ship it');
  });

  it('mentionEmail includes who mentioned + the snippet', () => {
    const e = mentionEmail({ mentionedBy: 'Ada', taskTitle: 'Ship it', taskKey: 'MICO-9', snippet: 'can you review?', link: 'https://app/x' });
    expect(e.subject).toContain('Ada');
    expect(e.html).toContain('can you review?');
  });

  it('workflowNotificationEmail renders message, details + action', () => {
    const e = workflowNotificationEmail({
      title: 'Task moved to Done',
      message: 'MICO-9 was completed.',
      details: [['Task', 'Ship it'], ['Status', 'Done']],
      actionLabel: 'View',
      actionLink: 'https://app/x',
    });
    expect(e.subject).toBe('Task moved to Done');
    expect(e.html).toContain('Done');
    expect(e.html).toContain('https://app/x');
  });

  it('reportReadyEmail includes report name, period + download link', () => {
    const e = reportReadyEmail({ reportName: 'Project Performance', period: 'September', downloadLink: 'https://app/dl', summary: [['Total', '56']] });
    expect(e.subject).toContain('Project Performance');
    expect(e.html).toContain('September');
    expect(e.html).toContain('https://app/dl');
    expect(e.html).toContain('56');
  });

  it('alertEmail renders the message with a tone + optional action', () => {
    const e = alertEmail({ title: 'High load', message: 'CPU at 95%', tone: 'danger', actionLabel: 'Open dashboard', actionLink: 'https://app/x' });
    expect(e.subject).toMatch(/alert/i);
    expect(e.html).toContain('CPU at 95%');
  });

  it('passwordChangedEmail is a security confirmation', () => {
    const e = passwordChangedEmail('omar');
    expect(e.subject).toMatch(/password/i);
    expect(e.html).toContain('omar');
  });

  it('accountLockedEmail offers a reset/unlock link', () => {
    const e = accountLockedEmail('omar', 'https://app/reset');
    expect(e.subject).toMatch(/locked/i);
    expect(e.html).toContain('https://app/reset');
  });

  it('genericNotificationEmail is a branded catch-all', () => {
    const e = genericNotificationEmail({ heading: 'Something happened', message: 'Details here', actionLabel: 'See', actionLink: 'https://app/x' });
    expect(e.subject).toBe('Something happened');
    expect(e.html).toContain('Details here');
  });

  it('every template ships an HTML + non-empty text part', () => {
    const samples = [
      otpCodeEmail('1'),
      welcomeEmail('a'),
      passwordChangedEmail('a'),
      alertEmail({ title: 't', message: 'm' }),
      genericNotificationEmail({ heading: 'h', message: 'm' }),
    ];
    for (const e of samples) {
      expect(e.html.startsWith('<!DOCTYPE html>')).toBe(true);
      expect(e.text.length).toBeGreaterThan(20);
    }
  });
});
