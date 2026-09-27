import { describe, it, expect } from 'vitest';
import { corsOrigin, parseCorsOrigins } from './cors-origins';

function allows(option: ReturnType<typeof corsOrigin>, origin: string | undefined): Promise<boolean> {
  if (typeof option !== 'function') throw new Error('expected a matcher function');
  return new Promise((resolve, reject) => option(origin, (err, allow) => (err ? reject(err) : resolve(!!allow))));
}

describe('parseCorsOrigins', () => {
  it('splits, trims and drops blanks', () => {
    expect(parseCorsOrigins(' https://a.example , ,http://localhost:4000 ')).toEqual(['https://a.example', 'http://localhost:4000']);
  });
});

describe('corsOrigin', () => {
  it('passes a plain list through unchanged', () => {
    expect(corsOrigin(['https://task.mico360.com'])).toEqual(['https://task.mico360.com']);
  });

  it('matches exact origins and scheme wildcards such as chrome-extension://*', async () => {
    const option = corsOrigin(['http://localhost:4000', 'chrome-extension://*']);
    expect(await allows(option, 'http://localhost:4000')).toBe(true);
    expect(await allows(option, 'chrome-extension://abcdefghijklmnopabcdefghijklmnop')).toBe(true);
    expect(await allows(option, 'https://evil.example')).toBe(false);
    expect(await allows(option, 'http://localhost:5173')).toBe(false);
  });

  it('allows requests without an Origin header (same-origin or non-browser)', async () => {
    expect(await allows(corsOrigin(['chrome-extension://*']), undefined)).toBe(true);
  });

  it('never treats a bare * or a host pattern as a wildcard', async () => {
    const option = corsOrigin(['chrome-extension://*', 'https://*.example.com', '*']);
    expect(await allows(option, 'https://app.example.com')).toBe(false);
    expect(await allows(option, 'https://anything.test')).toBe(false);
  });
});
