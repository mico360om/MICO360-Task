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
    expect(base().html).toContain('@media (max-width:600px)');
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

  it('shows the logo as a wordmark, at its own proportions (not squeezed into a square)', () => {
    const { html } = renderEmail({ preheader: 'x', heading: 'h', blocks: [], brand: { logoUrl: 'https://cdn.test/email-logo.png' } });
    const img = html.match(/<img src="https:\/\/cdn.test\/email-logo.png"[^>]*>/)?.[0] ?? '';
    expect(img).toContain('width="94"');
    expect(img).toContain('height="44"');
    expect(img).toContain('width:94px;height:44px');
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

describe('renderEmail — a list of tasks', () => {
  const model = () =>
    renderEmail({
      preheader: 'p',
      heading: 'Your tasks',
      blocks: [
        {
          kind: 'tasks',
          heading: 'Overdue',
          tone: 'danger',
          items: [
            { title: 'Fix <the> pump', href: 'https://task.example/my-tasks?task=t1', key: 'RIG-4', project: 'Rig & Co', facts: ['High priority', 'Due Mon 19 Oct', 'In Progress'], flag: { text: '2 days overdue', tone: 'danger' } },
            { title: 'Sneaky', href: 'javascript:alert(1)', key: 'RIG-5', project: 'Rig', facts: [] },
          ],
        },
      ],
    });

  it('shows each task as a link with its key, project, facts and flag, escaped', () => {
    const { html } = model();
    expect(html).toContain('Overdue');
    expect(html).toContain('href="https://task.example/my-tasks?task=t1"');
    expect(html).toContain('Fix &lt;the&gt; pump');
    expect(html).toContain('RIG-4 · Rig &amp; Co');
    expect(html).toContain('High priority · Due Mon 19 Oct · In Progress');
    expect(html).toContain('2 days overdue');
    expect(html).not.toContain('javascript:');
  });

  it('has a plain-text version with every task and its link', () => {
    const { text } = model();
    expect(text).toContain('OVERDUE (2)');
    expect(text).toContain('- Fix <the> pump (RIG-4, Rig & Co) — High priority · Due Mon 19 Oct · In Progress — 2 days overdue');
    expect(text).toContain('  https://task.example/my-tasks?task=t1');
  });
});
