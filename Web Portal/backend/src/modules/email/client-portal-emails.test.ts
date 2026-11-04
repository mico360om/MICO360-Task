import { describe, it, expect } from 'vitest';
import { clientReplyEmail } from './email-templates';

// 1.23 A team reply marked "Visible to client" on a client's comment: the reply, never the writer's name.
describe('the client reply email', () => {
  const e = clientReplyEmail({
    clientName: 'Fatma',
    projectName: 'Rig 7 Inspection',
    taskKey: 'RIG-4',
    taskTitle: 'Install pump',
    reply: 'We will replace the seal on Monday.\nThanks for flagging it.',
    link: 'https://task.mico360.test/portal/projects/p1/tasks/t1',
  });

  it('says which task, carries the reply and a link to the task in the Client portal', () => {
    expect(e.subject).toBe('A reply on RIG-4 Install pump');
    expect(e.text).toContain('Hi Fatma');
    expect(e.text).toContain('We will replace the seal on Monday.');
    expect(e.html).toContain('href="https://task.mico360.test/portal/projects/p1/tasks/t1"');
    expect(e.text).toContain('Rig 7 Inspection');
  });

  it('escapes the reply in the HTML', () => {
    const x = clientReplyEmail({ clientName: 'F', projectName: 'P', taskKey: 'K-1', taskTitle: 'T', reply: '<script>alert(1)</script>', link: 'https://x.test/portal' });
    expect(x.html).not.toContain('<script>alert(1)</script>');
  });
});
