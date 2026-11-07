import { describe, it, expect } from 'vitest';
import { clientNoticeEmail } from './email-templates';

// 1.23.7 A client's notification email (a task ready for their sign-off, a new document shown to them):
// what it is about and a link into the Client portal — never a staff name — and where to switch it off.
describe('the client notice email', () => {
  const e = clientNoticeEmail({
    clientName: 'Fatma',
    projectName: 'Rig 7 Inspection',
    headline: 'Ready for your sign-off',
    lead: 'The project team has finished a task and asks you to sign it off:',
    item: 'RIG-4 Install pump',
    buttonLabel: 'Open the task',
    link: 'https://task.mico360.test/portal/projects/p1/tasks/t1',
    settingsLink: 'https://task.mico360.test/portal/settings',
  });

  it('says what it is about, with a link into the portal and how to switch these emails off', () => {
    expect(e.subject).toBe('Ready for your sign-off: RIG-4 Install pump');
    expect(e.text).toContain('Hi Fatma');
    expect(e.text).toContain('Rig 7 Inspection');
    expect(e.html).toContain('href="https://task.mico360.test/portal/projects/p1/tasks/t1"');
    expect(e.text).toContain('https://task.mico360.test/portal/settings');
    expect(e.text).toMatch(/turn these emails off/i);
  });

  it('escapes what it shows in the HTML', () => {
    const x = clientNoticeEmail({ clientName: '<b>F</b>', projectName: 'P', headline: 'New document', lead: 'L', item: '<script>alert(1)</script>.pdf', buttonLabel: 'Open', link: 'https://x.test/portal', settingsLink: 'https://x.test/portal/settings' });
    expect(x.html).not.toContain('<script>alert(1)</script>');
    expect(x.html).not.toContain('<b>F</b>');
  });
});
