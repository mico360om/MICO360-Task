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
  meetingMinutesEmail,
} from './email-templates';

describe('email templates (existing signatures preserved)', () => {
  it('otpCodeEmail includes the code and a code-related subject', () => {
    const e = otpCodeEmail('123456');
    expect(e.subject).toMatch(/code/i);
    expect(e.html).toContain('123456');
    expect(e.text).toContain('123456'); // plain-text alternative too
  });

  it('otpCodeEmail states how long the code lasts (the server’s setting, not a fixed 10 minutes)', () => {
    expect(otpCodeEmail('123456').text).toContain('It expires in 10 minutes.');
    expect(otpCodeEmail('123456', { expiresInMinutes: 15 }).text).toContain('It expires in 15 minutes.');
    expect(otpCodeEmail('123456', { expiresInMinutes: 15 }).html).toContain('It expires in 15 minutes.');
    expect(otpCodeEmail('123456', { expiresInMinutes: 1 }).text).toContain('It expires in 1 minute.');
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

});

describe('welcomeEmail (an administrator welcomes a person: set your password)', () => {
  const brand = { appUrl: 'https://task.mico360.test', supportEmail: 'help@mico360.test', productName: 'MICO360 Tasks' };
  const params = {
    firstName: 'Sara',
    username: 'sara.k',
    setPasswordLink: 'https://task.mico360.test/reset?token=abc123&welcome=1',
    expiresInDays: 7,
    androidAppUrl: 'https://task.mico360.test/downloads/MICO360-Tasks.apk',
    extensionUrl: 'https://task.mico360.test/downloads/MICO360-Tasks-Chrome-Extension.zip',
  };

  it('greets them by name and gives their username, the site, the Set your password button and how long it works', () => {
    const e = welcomeEmail(params, { brand });
    expect(e.subject).toBe('Welcome to MICO360 Tasks: set your password');
    for (const out of [e.html, e.text]) {
      expect(out).toContain('Hi Sara, your MICO360 Tasks account is ready. Set your password, then sign in with your username or email address.');
      expect(out).toContain('sara.k');
      expect(out).toContain('https://task.mico360.test');
      expect(out).toContain('This link works once and expires in 7 days. If it has expired, choose “Forgot password?” on the sign-in page, or ask your administrator to send a new one.');
      expect(out).toContain('help@mico360.test');
    }
    expect(e.html).toMatch(/<a href="https:\/\/task\.mico360\.test\/reset\?token=abc123&amp;welcome=1"[^>]*>Set your password<\/a>/);
    expect(e.text).toContain('Set your password: https://task.mico360.test/reset?token=abc123&welcome=1');
    expect(e.text).toContain('  - Your username: sara.k');
    expect(e.text).toContain('  - Site: https://task.mico360.test');
  });

  it('offers the Android app and the Chrome extension, with how to install the extension', () => {
    const e = welcomeEmail(params, { brand });
    expect(e.html).toContain('>Android app</a>');
    expect(e.html).toContain('href="https://task.mico360.test/downloads/MICO360-Tasks.apk"');
    expect(e.html).toContain('>Chrome extension</a>');
    expect(e.text).toContain('  - Android app: https://task.mico360.test/downloads/MICO360-Tasks.apk');
    expect(e.text).toContain('  - Chrome extension: https://task.mico360.test/downloads/MICO360-Tasks-Chrome-Extension.zip');
    expect(e.text).toContain('To install the extension: unzip it, open chrome://extensions, turn on Developer mode, then choose Load unpacked and pick the unzipped folder.');
  });

  it('leaves out an app the site doesn’t offer (no dead links)', () => {
    const none = welcomeEmail({ ...params, androidAppUrl: null, extensionUrl: null }, { brand });
    expect(none.text).not.toMatch(/Android app|Chrome extension|Get the apps/);
    const androidOnly = welcomeEmail({ ...params, extensionUrl: null }, { brand });
    expect(androidOnly.text).toContain('Android app');
    expect(androidOnly.text).not.toMatch(/Chrome extension|chrome:\/\/extensions/);
  });

  it('never contains a password, and escapes the name', () => {
    const e = welcomeEmail({ ...params, firstName: '<script>x</script>' }, { brand });
    expect(e.html).not.toContain('<script>x</script>');
    expect(e.html).toContain('&lt;script&gt;');
    expect(`${e.html} ${e.text}`).not.toMatch(/temporary password|temp password|password is/i);
  });

  it('greets them by username when no first name is known', () => {
    expect(welcomeEmail({ ...params, firstName: ' ' }, { brand }).text).toContain('Hi sara.k, your MICO360 Tasks account is ready.');
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

  it('genericNotificationEmail renders line items as a list, one per line (digest)', () => {
    const e = genericNotificationEmail({ heading: 'Your task digest', message: 'You have 2 tasks.', items: ['MOB-1 Fix login (overdue)', 'MOB-2 تجهيز العرض (due today)'] });
    expect(e.html).toMatch(/<(ul|li|table)[\s>]/);
    expect(e.html).toContain('MOB-1 Fix login (overdue)');
    expect(e.html).toContain('تجهيز العرض');
    const textLines = e.text.split('\n');
    expect(textLines.some((l) => l.includes('MOB-1 Fix login'))).toBe(true);
    expect(textLines.some((l) => l.includes('MOB-2'))).toBe(true);
    expect(textLines.find((l) => l.includes('MOB-1'))).not.toContain('MOB-2');
  });

  it('every template ships an HTML + non-empty text part', () => {
    const samples = [
      otpCodeEmail('1'),
      welcomeEmail({ firstName: 'A', username: 'a', setPasswordLink: 'https://x/reset?token=t&welcome=1', expiresInDays: 7 }),
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

describe('minutes email — the project’s identity', () => {
  const params = { title: 'Weekly review', whenLabel: 'Tue 14 Oct 2026, 10:00', organizerName: 'Aisha Khan', projectName: 'Falcon CRM', link: 'https://app.test/meetings/m1' };
  const opts = { brand: { logoUrl: 'https://api.test/email-assets/email-logo.png' } };

  it('is headed by the project’s picture and name instead of the product logo', () => {
    const e = meetingMinutesEmail({ ...params, project: { name: 'Falcon CRM', imageUrl: 'https://api.test/uploads/projects/falcon.png', color: '#0F766E' } }, opts);
    expect(e.html).toContain('<img src="https://api.test/uploads/projects/falcon.png"');
    expect(e.html).toContain('alt="Falcon CRM"');
    expect(e.html).toContain('Minutes of Meeting');
    expect(e.html).not.toContain('email-logo.png');
  });

  it('shows the project’s initials on its colour when it has no picture', () => {
    const e = meetingMinutesEmail({ ...params, project: { name: 'Falcon CRM', imageUrl: null, color: '#0F766E' } }, opts);
    expect(e.html).toContain('>FC<');
    expect(e.html).toContain('background:#0F766E');
    expect(e.html).not.toContain('email-logo.png');
  });

  it('keeps an Arabic project name in its own direction (digits and Latin parts stay in place)', () => {
    const e = meetingMinutesEmail({ ...params, projectName: 'مشروع الإطلاق 817ab4', project: { name: 'مشروع الإطلاق 817ab4', imageUrl: null, color: null } }, opts);
    expect(e.html).toMatch(/<div dir="auto"[^>]*>مشروع الإطلاق 817ab4<\/div>/);
    // The same in the details table.
    expect(e.html).toMatch(/<td dir="auto"[^>]*>مشروع الإطلاق 817ab4<\/td>/);
  });

  it('keeps the product logo for a meeting without a project', () => {
    expect(meetingMinutesEmail(params, opts).html).toContain('<img src="https://api.test/email-assets/email-logo.png"');
  });

  it('never lets a project name, picture address or colour break out of the header', () => {
    const e = meetingMinutesEmail({ ...params, project: { name: '<b>X</b> "y"', imageUrl: 'javascript:alert(1)', color: 'red;background:url(x)' } }, opts);
    expect(e.html).not.toContain('<b>X</b>');
    expect(e.html).toContain('&lt;b&gt;X&lt;/b&gt;');
    expect(e.html).not.toContain('javascript:');
    expect(e.html).not.toContain('url(x)');
  });
});
