import { describe, it, expect } from 'vitest';
import { parseClientBatch, parseCspReports } from './client-reports';

const ok = { kind: 'ERROR', detail: 'error', message: 'TypeError: x is undefined', stack: 'TypeError: x\n    at a (https://h/assets/a-Ab12Cd34.js:1:2)', page: '/board', count: 2, version: '1.22.4', screen: '1440x900' };

describe('parseClientBatch: what the page sends, checked report by report', () => {
  it('takes the JSON text the page sends (text/plain) or a parsed body', () => {
    expect(parseClientBatch(JSON.stringify({ reports: [ok] }))).toHaveLength(1);
    expect(parseClientBatch({ reports: [ok] })[0]).toMatchObject({ kind: 'ERROR', detail: 'error', page: '/board', count: 2, version: '1.22.4', screen: '1440x900' });
  });

  it('a bad report is dropped, the good ones kept; nonsense gives nothing (never a throw)', () => {
    expect(parseClientBatch({ reports: [ok, { kind: 'NOPE' }, { ...ok, count: -4 }, 42] })).toHaveLength(1);
    expect(parseClientBatch('not json')).toEqual([]);
    expect(parseClientBatch(null)).toEqual([]);
    expect(parseClientBatch({ reports: 'x' })).toEqual([]);
  });

  it('at most 20 reports a batch', () => {
    expect(parseClientBatch({ reports: Array.from({ length: 30 }, () => ok) })).toHaveLength(20);
  });

  it('only the details each kind can have', () => {
    expect(parseClientBatch({ reports: [{ ...ok, kind: 'SLOW', detail: 'boundary' }] })).toEqual([]);
    expect(parseClientBatch({ reports: [{ ...ok, kind: 'BLOCKED', detail: 'csp-report' }] })).toEqual([]); // only the browser's own report is that
    expect(parseClientBatch({ reports: [{ ...ok, kind: 'SERVER' }] })).toEqual([]); // never from a browser
  });

  it('reduces the page, the message, the stack and the request again (the server does not trust the page)', () => {
    const [r] = parseClientBatch({
      reports: [
        {
          ...ok,
          page: '/client/abcdefghijkl?x=1',
          message: 'failed for x@y.com at /reset?token=secret',
          stack: 'Error\n    at f (https://h/assets/a-Ab12Cd34.js?v=1:1:2)',
        },
      ],
    });
    expect(r!.page).toBe('/client/:token');
    expect(r!.message).toBe('failed for [email] at /reset');
    expect(r!.stack).toBe('Error\n    at f (https://h/assets/a-Ab12Cd34.js:1:2)');
    const [api] = parseClientBatch({ reports: [{ kind: 'SLOW', detail: 'api', value: 12000, page: '/', resource: 'GET /api/v1/projects/clx9z8y7w0000abcd1234efgh?x=1' }] });
    expect(api!.resource).toBe('GET /api/v1/projects/:id');
  });

  it('trims long text: a stack to 4 KB, a message to 500 characters', () => {
    const [r] = parseClientBatch({ reports: [{ ...ok, message: 'm'.repeat(1900), stack: 's'.repeat(8000) }] });
    expect(r!.message!.length).toBe(500);
    expect(r!.stack!.length).toBe(4096);
  });

  it('keeps out browser extensions, ResizeObserver notices and the browser’s empty “Script error.”', () => {
    expect(parseClientBatch({ reports: [{ ...ok, stack: 'Error\n    at x (chrome-extension://abc/content.js:1:1)' }] })).toEqual([]);
    expect(parseClientBatch({ reports: [{ ...ok, message: 'ResizeObserver loop completed with undelivered notifications.' }] })).toEqual([]);
    expect(parseClientBatch({ reports: [{ ...ok, message: 'Script error.' }] })).toEqual([]);
    expect(parseClientBatch({ reports: [{ kind: 'BLOCKED', detail: 'resource', page: '/', resource: 'moz-extension://x/a.js', tag: 'script' }] })).toEqual([]);
  });

  it('screen sizes and versions only in their shape; unknown fields dropped', () => {
    const [r] = parseClientBatch({ reports: [{ ...ok, screen: '<b>', version: '1.2.3; drop', token: 'abc', cookie: 'x' }] });
    expect(r!.screen).toBeNull();
    expect(r!.version).toBeNull();
    expect(r).not.toHaveProperty('token');
    expect(r).not.toHaveProperty('cookie');
  });

  // 1.23.3: a slow request says where its time went — the server's own time and its time in the
  // database, from the answer's Server-Timing.
  it('a slow request keeps the server’s time and its time in the database', () => {
    const slow = { kind: 'SLOW', detail: 'api', value: 10_200, page: '/', resource: 'GET /api/v1/tasks' };
    expect(parseClientBatch({ reports: [{ ...slow, serverMs: 9912.3, dbMs: 9700.1 }] })[0]).toMatchObject({ value: 10_200, serverMs: 9912.3, dbMs: 9700.1 });
    // Without the database's part (an answer that said only the server's time).
    expect(parseClientBatch({ reports: [{ ...slow, serverMs: 120 }] })[0]).toMatchObject({ serverMs: 120, dbMs: null });
    // The database's part is part of the server's: never more.
    expect(parseClientBatch({ reports: [{ ...slow, serverMs: 100, dbMs: 900 }] })[0]).toMatchObject({ serverMs: 100, dbMs: 100 });
    // An old page sends neither: the report is as before.
    const [old] = parseClientBatch({ reports: [slow] });
    expect(old).not.toHaveProperty('serverMs');
    expect(old).not.toHaveProperty('dbMs');
  });

  it('those times only on a slow request, and only as sensible numbers', () => {
    const slow = { kind: 'SLOW', detail: 'api', value: 10_200, page: '/', resource: 'GET /api/v1/tasks' };
    expect(parseClientBatch({ reports: [{ ...slow, serverMs: -1, dbMs: 5 }] })).toEqual([]);
    expect(parseClientBatch({ reports: [{ ...slow, serverMs: 'x' }] })).toEqual([]);
    expect(parseClientBatch({ reports: [{ ...slow, serverMs: 2e9 }] })).toEqual([]);
    // A database time without the server's says nothing.
    expect(parseClientBatch({ reports: [{ ...slow, dbMs: 5 }] })[0]).not.toHaveProperty('dbMs');
    for (const other of [{ kind: 'SLOW', detail: 'load', value: 9000, page: '/' }, ok]) {
      const [r] = parseClientBatch({ reports: [{ ...other, serverMs: 50, dbMs: 40 }] });
      expect(r).not.toHaveProperty('serverMs');
      expect(r).not.toHaveProperty('dbMs');
    }
  });
});

describe('parseCspReports: what the browser itself sends for the security policy', () => {
  it('report-uri (application/csp-report)', () => {
    const body = {
      'csp-report': {
        'document-uri': 'https://task.mico360.com/client/abcdefghijkl?x=1',
        'blocked-uri': 'https://evil.example/x.js?token=1',
        'effective-directive': 'script-src-elem',
        'violated-directive': 'script-src-elem',
        disposition: 'enforce',
      },
    };
    expect(parseCspReports(JSON.stringify(body))).toEqual([
      expect.objectContaining({ kind: 'BLOCKED', detail: 'csp-report', page: '/client/:token', resource: 'https://evil.example/x.js', directive: 'script-src-elem', count: 1 }),
    ]);
  });

  it('the Reporting API (application/reports+json): only csp-violation entries', () => {
    const body = [
      { type: 'csp-violation', url: 'https://task.mico360.com/board', body: { documentURL: 'https://task.mico360.com/board', blockedURL: 'inline', effectiveDirective: 'script-src-elem', disposition: 'enforce' } },
      { type: 'deprecation', body: {} },
    ];
    expect(parseCspReports(body)).toEqual([expect.objectContaining({ detail: 'csp-report', page: '/board', resource: 'inline', directive: 'script-src-elem' })]);
  });

  it('leaves out extensions, upgrade-insecure-requests noise and nonsense', () => {
    const r = (blocked: string, directive = 'script-src-elem', source?: string) => ({ 'csp-report': { 'document-uri': 'https://t/x', 'blocked-uri': blocked, 'effective-directive': directive, 'source-file': source } });
    expect(parseCspReports(r('chrome-extension://abc/x.js'))).toEqual([]);
    expect(parseCspReports(r('inline', 'script-src-elem', 'moz-extension://abc/x.js'))).toEqual([]);
    expect(parseCspReports(r('http://task.mico360.com/x.png', 'img-src'))).toEqual([]);
    expect(parseCspReports(r('https://t/a', 'upgrade-insecure-requests'))).toEqual([]);
    expect(parseCspReports('nope')).toEqual([]);
    expect(parseCspReports({ 'csp-report': 'x' })).toEqual([]);
    expect(parseCspReports(Array.from({ length: 50 }, () => ({ type: 'csp-violation', body: { documentURL: 'https://t/', blockedURL: 'eval', effectiveDirective: 'script-src' } })))).toHaveLength(20);
  });
});
