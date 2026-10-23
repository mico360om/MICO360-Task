import { describe, it, expect } from 'vitest';
import { renderEmail, escapeHtml } from './email-layout';

describe('escapeHtml', () => {
  it('escapes HTML-significant characters', () => {
    expect(escapeHtml('<script>"&\'</script>')).toBe('&lt;script&gt;&quot;&amp;&#39;&lt;/script&gt;');
  });
});

describe('renderEmail — layout', () => {
  const base = () =>
    renderEmail({
      preheader: 'Preview text here',
      heading: 'Test heading',
      blocks: [
        { kind: 'text', text: 'A paragraph.' },
        { kind: 'button', label: 'Do it', href: 'https://app.test/go' },
      ],
    });

  it('is a complete, valid HTML email document', () => {
    const { html } = base();
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<html lang="en" dir="ltr"');
    expect(html).toContain('MICO360 Tasks'); // product name in header/title
    expect(html).toContain('Test heading');
  });

  it('supports light + dark mode', () => {
    const { html } = base();
    expect(html).toContain('name="color-scheme" content="light dark"');
    expect(html).toContain('name="supported-color-schemes"');
    expect(html).toContain('@media (prefers-color-scheme:dark)');
  });

  it('is responsive for mobile clients', () => {
    expect(base().html).toContain('@media (max-width:620px)');
  });

  it('fills the reading pane up to 720 px and the whole width of a phone (Outlook gets a fixed 720)', () => {
    const { html } = base();
    expect(html).toMatch(/class="email-container" style="width:100%;max-width:720px/);
    expect(html).toContain('<!--[if mso]><table role="presentation" width="720" align="center"');
    expect(html).not.toContain('width:600px');
  });

  it('has a slim header: no tagline, and an optional note on the right (the date) that phones hide', () => {
    expect(base().html).not.toContain('Project &amp; task management for teams');
    const { html } = renderEmail({ preheader: 'x', heading: 'h', blocks: [], headerNote: 'Friday 23 October' });
    expect(html).toMatch(/class="email-head-note"[^>]*>Friday 23 October</);
    expect(html).toContain('.email-head-note{display:none!important}');
    expect(base().html).not.toMatch(/class="email-head-note"/);
  });

  it('includes a hidden preheader for the inbox preview', () => {
    const { html } = base();
    expect(html).toContain('Preview text here');
    expect(html).toMatch(/display:none;max-height:0/);
  });

  it('renders a branded footer with contact, address, legal + copyright', () => {
    const { html } = base();
    expect(html).toContain('info@mico360.example'); // contact
    expect(html).toContain('Oman'); // company address
    expect(html).toMatch(/©\s*\d{4}\s*MICO360/); // copyright
    expect(html.toLowerCase()).toContain('confidential'); // disclaimer
  });

  it('renders a bulletproof CTA button with the given link', () => {
    const { html } = base();
    expect(html).toContain('href="https://app.test/go"');
    expect(html).toContain('Do it');
  });

  it('escapes user-supplied content to prevent HTML injection', () => {
    const { html } = renderEmail({
      preheader: 'x',
      heading: 'Hi <img src=x onerror=alert(1)>',
      blocks: [{ kind: 'text', text: '<b>bold</b> & <script>evil()</script>' }],
    });
    expect(html).not.toContain('<img src=x onerror');
    expect(html).not.toContain('<script>evil()');
    expect(html).toContain('&lt;script&gt;evil()');
  });

  it('neutralizes dangerous button URLs (javascript:)', () => {
    const { html } = renderEmail({
      preheader: 'x',
      heading: 'h',
      blocks: [{ kind: 'button', label: 'click', href: 'javascript:alert(1)' }],
    });
    expect(html).not.toContain('javascript:alert');
    expect(html).toContain('href="#"');
  });

  it('produces a readable plain-text alternative', () => {
    const { text } = base();
    expect(text).toContain('Test heading');
    expect(text).toContain('A paragraph.');
    expect(text).toContain('Do it: https://app.test/go');
    expect(text).toContain('info@mico360.example');
  });

  it('renders every block kind', () => {
    const { html, text } = renderEmail({
      preheader: 'x',
      heading: 'All blocks',
      blocks: [
        { kind: 'code', code: '482913' },
        { kind: 'details', rows: [['Task', 'Ship it'], ['Ref', 'MICO-9']] },
        { kind: 'callout', text: 'Heads up', tone: 'warning' },
        { kind: 'list', items: ['one', 'two'] },
        { kind: 'divider' },
      ],
    });
    expect(html).toContain('482913');
    expect(html).toContain('Ship it');
    expect(html).toContain('Heads up');
    expect(html).toContain('<li');
    expect(text).toContain('Ship it');
    expect(text).toContain('482913');
  });

  it('honours a locale (dir + translated chrome)', () => {
    const { html } = renderEmail({ preheader: 'x', heading: 'h', blocks: [], locale: 'ar' });
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('تواصل مع الدعم'); // Arabic "contact support"
  });

  it('renders a hosted logo image when configured', () => {
    const { html } = renderEmail({
      preheader: 'x',
      heading: 'h',
      blocks: [],
      brand: { logoUrl: 'https://cdn.test/logo-w.png' },
    });
    expect(html).toContain('<img src="https://cdn.test/logo-w.png"');
    expect(html).toContain('alt="MICO360 Tasks"');
  });

  it('shows the logo as a wordmark, at its own proportions (not squeezed into a square), sized for the slim header', () => {
    const { html } = renderEmail({ preheader: 'x', heading: 'h', blocks: [], brand: { logoUrl: 'https://cdn.test/email-logo.png' } });
    const img = html.match(/<img src="https:\/\/cdn.test\/email-logo.png"[^>]*>/)?.[0] ?? '';
    expect(img).toContain('width="64"');
    expect(img).toContain('height="30"');
    expect(img).toContain('width:64px;height:30px');
  });

  it('applies brand overrides', () => {
    const { html } = renderEmail({
      preheader: 'x',
      heading: 'h',
      blocks: [],
      brand: { productName: 'Acme Tasks', supportEmail: 'help@acme.test' },
    });
    expect(html).toContain('Acme Tasks');
    expect(html).toContain('help@acme.test');
  });
});

describe('renderEmail — labels and a project with its tasks', () => {
  const model = (project: Partial<import('./email-layout').EmailProjectCard> = {}) =>
    renderEmail({
      preheader: 'p',
      heading: 'Your tasks',
      blocks: [
        { kind: 'chips', items: [{ text: '1 overdue', tone: 'danger' }, { text: '3 with no due date', tone: 'muted' }] },
        {
          kind: 'project',
          project: {
            name: 'Rig & Co',
            href: 'https://task.example/projects/p1',
            color: '#3A6EA5',
            imageUrl: null,
            details: ['RIG', 'No. 2026-014', 'Client: <Acme>'],
            chips: [{ text: 'Active', tone: 'success' }, { text: '2 tasks for you', tone: 'neutral' }],
            ...project,
          },
          items: [
            { title: 'Fix <the> pump', href: 'https://task.example/my-tasks?task=t1', key: 'RIG-4', chips: [{ text: '2 days overdue', tone: 'danger' }, { text: 'High priority', tone: 'warning' }, { text: 'In Progress', tone: 'outline' }] },
            { title: 'Sneaky', href: 'javascript:alert(1)', key: 'RIG-5', chips: [] },
          ],
        },
      ],
    });

  it('shows a row of labels, each in its colour', () => {
    const { html, text } = model();
    expect(html).toMatch(/background:#FBEDEA;color:#8f2f20[^"]*">1 overdue</);
    expect(html).toContain('>3 with no due date<');
    expect(text).toContain('1 overdue · 3 with no due date');
  });

  it('heads the project with its initials on its colour, its name, details, labels and a link, escaped', () => {
    const { html } = model();
    expect(html).toMatch(/background:#3A6EA5[^"]*">RC</);
    expect(html).toContain('border-top:4px solid #3A6EA5');
    expect(html).toContain('Rig &amp; Co');
    expect(html).toContain('RIG · No. 2026-014 · Client: &lt;Acme&gt;');
    expect(html).toContain('>Active<');
    expect(html).toMatch(/href="https:\/\/task.example\/projects\/p1"[^>]*>Open project ›</);
  });

  it('shows the project’s picture when it has one email clients can load, and never an unsafe colour', () => {
    expect(model({ imageUrl: 'https://api.example/uploads/rig.png' }).html).toContain('<img src="https://api.example/uploads/rig.png" alt="Rig &amp; Co" width="42" height="42"');
    expect(model({ imageUrl: 'javascript:alert(1)' }).html).not.toContain('javascript:alert(1)"');
    const odd = model({ color: 'red;background:url(x)' }).html;
    expect(odd).not.toContain('url(x)');
    expect(odd).toContain('border-top:4px solid #A83326');
  });

  it('lists each task with its title as a link, its key, its labels and an Open button, escaped', () => {
    const { html } = model();
    expect(html).toMatch(/href="https:\/\/task.example\/my-tasks\?task=t1"[^>]*>Fix &lt;the&gt; pump</);
    expect(html).toContain('>RIG-4<');
    expect(html).toContain('>2 days overdue<');
    expect(html).toMatch(/border:1px solid #D9D0CC[^"]*">In Progress</);
    expect(html).toMatch(/href="https:\/\/task.example\/my-tasks\?task=t1"[^>]*>Open ›</);
    expect(html).not.toContain('javascript:');
  });

  it('in dark mode, the Open links turn light and the lines between tasks dark, so both stay readable', () => {
    const { html } = model();
    expect(html).toContain('.email-link{color:#F0A79B!important;border-color:#F0A79B!important}');
    expect(html).toContain('.email-card{border-top-color:#3A312E!important}');
    expect(html).toContain('.email-proj{background:#26211F!important;border-bottom-color:#3A312E!important}'); // its coloured top stripe stays
    expect(html).toContain('.email-proj tr{background:transparent!important}');
    expect(html).not.toContain('.email-proj{border-color');
    expect(html.match(/class="email-link"/g)).toHaveLength(3); // Open project, and Open on each task
  });

  it('has a plain-text version with the project, its link, and every task with its labels and link', () => {
    const { text } = model();
    expect(text).toContain('RIG & CO — RIG · No. 2026-014 · Client: <Acme>');
    expect(text).toContain('Active · 2 tasks for you');
    expect(text).toContain('https://task.example/projects/p1');
    expect(text).toContain('- Fix <the> pump (RIG-4) — 2 days overdue · High priority · In Progress');
    expect(text).toContain('  https://task.example/my-tasks?task=t1');
    expect(text).toContain('- Sneaky (RIG-5)');
  });
});
