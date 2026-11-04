import { describe, it, expect } from 'vitest';
import { pagePattern, redactText, normalizeMessage, isExtensionSource } from './error-redact';

describe('pagePattern: an address with its secrets reduced to a pattern', () => {
  it('drops the query string and the hash', () => {
    expect(pagePattern('/reset?token=abc123secret&welcome=1')).toBe('/reset');
    expect(pagePattern('/login?code=999999#x')).toBe('/login');
    expect(pagePattern('/board#col-2')).toBe('/board');
  });

  it('a client share link keeps only its pattern', () => {
    expect(pagePattern('/client/k3J9xq2LmPz8wQ7r')).toBe('/client/:token');
    expect(pagePattern('/client/short')).toBe('/client/:token');
    expect(pagePattern('/client/k3J9xq2LmPz8wQ7r/minutes/abc')).toBe('/client/:token');
  });

  it('reset, welcome and sign-in links with a token in the path', () => {
    expect(pagePattern('/reset/9f8e7d6c5b4a')).toBe('/reset/:token');
    expect(pagePattern('/welcome/abc')).toBe('/welcome/:token');
    expect(pagePattern('/login/abcdef')).toBe('/login/:token');
  });

  it('long or token-like segments become :id, ordinary words and short numbers stay', () => {
    expect(pagePattern('/projects/clx9z8y7w0000abcd1234efgh')).toBe('/projects/:id');
    expect(pagePattern('/meetings/3f2b8c1e-9a4d-4e2b-8f7a-1c2d3e4f5a6b')).toBe('/meetings/:id');
    expect(pagePattern('/inspections/ab12cd34ef56')).toBe('/inspections/:id');
    expect(pagePattern('/projects')).toBe('/projects');
    expect(pagePattern('/admin/error-log')).toBe('/admin/error-log');
    expect(pagePattern('/board/123')).toBe('/board/123');
    expect(pagePattern('/tasks/MICO-142')).toBe('/tasks/MICO-142');
  });

  it('a full address keeps its path only; nonsense becomes /', () => {
    expect(pagePattern('https://task.mico360.com/client/abcdef?x=1')).toBe('/client/:token');
    expect(pagePattern('')).toBe('/');
    expect(pagePattern('not a path')).toBe('/');
  });
});

describe('redactText: messages and stacks lose secrets', () => {
  it('addresses lose their query and hash; the site’s own paths become patterns', () => {
    expect(redactText('Failed to load https://task.mico360.com/assets/a-1.js?v=2#x')).toBe('Failed to load https://task.mico360.com/assets/a-1.js');
    expect(redactText('GET https://task.mico360.com/client/abcdefghij failed')).toBe('GET https://task.mico360.com/client/:token failed');
    expect(redactText('see /reset?token=s3cr3t-value now')).toBe('see /reset now');
  });

  it('tokens, bearer headers, JWTs and emails are masked', () => {
    expect(redactText('Bearer abc.def.ghi')).toBe('Bearer [token]');
    expect(redactText('jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sIgNaTuRe_x-y is bad')).toBe('jwt [token] is bad');
    expect(redactText('key A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7 leaked')).toBe('key [token] leaked');
    expect(redactText('No account for khurram@prolens-team.com')).toBe('No account for [email]');
  });

  it('data addresses are shortened', () => {
    expect(redactText('img data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA== broke')).toBe('img data:image/png;… broke');
  });

  it('keeps stack frames readable (hashed chunk names are not tokens)', () => {
    const frame = '    at BoardPage (https://task.mico360.com/assets/BoardPage-B3x9kQ2a.js:1:2345)';
    expect(redactText(frame)).toBe(frame);
    // A frame of a file loaded with a query: the query goes, the line and column stay.
    expect(redactText('    at f (https://h/assets/a.js?v=secret:1:2)')).toBe('    at f (https://h/assets/a.js:1:2)');
  });

  it('caps very long text', () => {
    expect(redactText('x'.repeat(10_000), 100).length).toBe(100);
  });
});

describe('normalizeMessage: the same error with different numbers and ids is one', () => {
  it('numbers, ids and quoted values are normalised', () => {
    expect(normalizeMessage('Task 1234 not found')).toBe(normalizeMessage('Task 98 not found'));
    expect(normalizeMessage('Request failed (500)')).toBe('Request failed (0)');
    expect(normalizeMessage('project clx9z8y7w0000abcd1234efgh missing')).toBe('project :id missing');
    expect(normalizeMessage('  spaced   out ')).toBe('spaced out');
  });

  it('the text of the error otherwise stays', () => {
    expect(normalizeMessage("Cannot read properties of undefined (reading 'title')")).toBe("Cannot read properties of undefined (reading 'title')");
  });
});

describe('isExtensionSource', () => {
  it('names browser extensions', () => {
    expect(isExtensionSource('chrome-extension://abc/content.js')).toBe(true);
    expect(isExtensionSource('moz-extension://abc/x.js')).toBe(true);
    expect(isExtensionSource('safari-extension://abc/x.js')).toBe(true);
    expect(isExtensionSource('safari-web-extension://abc/x.js')).toBe(true);
    expect(isExtensionSource('https://task.mico360.com/assets/x.js')).toBe(false);
    expect(isExtensionSource(undefined)).toBe(false);
  });
});

// Review (1.22.4): the server runs these on what anyone may send (16 KB a batch) — fast on hostile text.
describe('hostile text', () => {
  it('16 KB built to make the patterns backtrack is reduced in a few milliseconds', () => {
    const inputs = ['eyJ-'.repeat(4096), 'a'.repeat(16384), 'x@a.a.'.repeat(2730), 'http://'.repeat(2340), '/a?'.repeat(5461), `${'a'.repeat(8000)}@${'b.'.repeat(4000)}`, 'Bearer '.repeat(2340), 'data:a/b;'.repeat(1820)];
    for (const text of inputs) {
      const t = performance.now();
      redactText(text);
      normalizeMessage(text);
      pagePattern(text);
      expect(performance.now() - t, text.slice(0, 12)).toBeLessThan(30);
    }
  });
});
