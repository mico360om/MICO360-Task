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
    expect(html).toContain('support@mico360.example'); // contact
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
    expect(text).toContain('support@mico360.example');
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
