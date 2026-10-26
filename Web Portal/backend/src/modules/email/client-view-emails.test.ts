import { describe, it, expect } from 'vitest';
import { clientCodeEmail, clientInvitationEmail } from './email-templates';

const LINK = 'https://task.mico360.test/client/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';
const invite = (over: Partial<Parameters<typeof clientInvitationEmail>[0]> = {}) =>
  clientInvitationEmail({
    clientName: 'Fatma Al Harthy',
    sharedByName: 'Omar Ahmed',
    projectName: 'Rig 7 Inspection',
    projectDetails: ['RIG', 'Oman Drilling Co.'],
    projectImageUrl: 'https://task.mico360.test/uploads/p/rig.png',
    projectColor: '#1E6B8B',
    link: LINK,
    email: 'fatma@client.example',
    ...over,
  });

describe('the client invitation email', () => {
  it('says who shared which project: "{who} shared the project {name} with you"', () => {
    const e = invite();
    expect(e.subject).toBe('Omar Ahmed shared the project Rig 7 Inspection with you');
    expect(e.html).toContain('Omar Ahmed shared the project Rig 7 Inspection with you');
    expect(e.text).toContain('Omar Ahmed shared the project Rig 7 Inspection with you');
    expect(e.text).toContain('Hi Fatma Al Harthy');
  });

  it('carries the private link (button, the project card and the copy-paste fallback) in both versions', () => {
    const e = invite();
    expect(e.html).toContain(`href="${LINK}"`);
    expect(e.html).toContain('View the project');
    expect(e.text).toContain(LINK);
  });

  it('shows the project picture and its details', () => {
    const e = invite();
    expect(e.html).toContain('https://task.mico360.test/uploads/p/rig.png');
    expect(e.html).toContain('Oman Drilling Co.');
  });

  it('explains the emailed code: the link alone (a forwarded email) opens nothing', () => {
    const e = invite();
    expect(e.text).toContain('fatma@client.example');
    expect(e.text).toMatch(/one-time code/i);
    expect(e.text).toMatch(/forward/i);
  });

  it('says why it was sent (shared with them), not that they have an account', () => {
    const e = invite();
    expect(e.text).not.toMatch(/you have a .* account/i);
    expect(e.html).not.toMatch(/you have a .* account/i);
    expect(e.text).toContain('Omar Ahmed shared a project with you on MICO360 Tasks');
  });

  it('never carries a code, and escapes names and titles (no markup from a project name)', () => {
    const e = invite({ projectName: '<script>alert(1)</script>', sharedByName: 'Eve <b>' });
    expect(e.html).not.toContain('<script>alert(1)</script>');
    expect(e.html).toContain('&lt;script&gt;');
    expect(e.html).not.toContain('Eve <b>');
  });

  it('keeps Arabic names readable (dir=auto on the project name)', () => {
    const e = invite({ projectName: 'تفتيش الحفارة ٧' });
    expect(e.html).toContain('تفتيش الحفارة ٧');
    expect(e.html).toMatch(/dir="auto"[^>]*>تفتيش الحفارة ٧/);
  });
});

describe('the client code email', () => {
  const e = clientCodeEmail({ code: '482913', projectName: 'Rig 7 Inspection', expiresInMinutes: 10 });

  it('carries the code and its lifetime, for that project', () => {
    expect(e.html).toContain('482913');
    expect(e.text).toContain('482913');
    expect(e.text).toContain('It expires in 10 minutes.');
    expect(e.text).toContain('Rig 7 Inspection');
  });

  it('keeps the code out of the subject (the email log stores subjects)', () => {
    expect(e.subject).toBe('Your code to view Rig 7 Inspection');
    expect(e.subject).not.toContain('482913');
  });

  it('says why it was sent and that it can be ignored', () => {
    expect(e.text).toMatch(/didn’t ask for this code/i);
    expect(e.text).not.toMatch(/you have a .* account/i);
  });
});
