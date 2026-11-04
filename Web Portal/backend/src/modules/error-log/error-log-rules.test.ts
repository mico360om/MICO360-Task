import { describe, it, expect } from 'vitest';
import { comesBack, describeReport, fingerprintOf, isNewerVersion, kindsFor, sinceFor } from './error-log-rules';

describe('isNewerVersion', () => {
  it('compares release versions', () => {
    expect(isNewerVersion('1.22.4', '1.22.3')).toBe(true);
    expect(isNewerVersion('1.23.0', '1.22.10')).toBe(true);
    expect(isNewerVersion('1.22.10', '1.22.9')).toBe(true);
    expect(isNewerVersion('1.22.3', '1.22.3')).toBe(false);
    expect(isNewerVersion('1.22.2', '1.22.3')).toBe(false);
    expect(isNewerVersion('2.0.0', '1.99.99')).toBe(true);
  });
  it('anything that isn’t a version is never newer', () => {
    expect(isNewerVersion('dev', '1.0.0')).toBe(false);
    expect(isNewerVersion(null, '1.0.0')).toBe(false);
    expect(isNewerVersion('1.0.0', null)).toBe(false);
  });
});

describe('comesBack: a fixed error shows again only when it happens in a newer version', () => {
  const fixedAt = new Date('2026-11-05T10:00:00Z');
  it('a newer version brings it back; the same or an older version (a tab still open) does not', () => {
    expect(comesBack({ fixedInVersion: '1.22.4', fixedAt }, { version: '1.22.5', at: new Date('2026-11-06T00:00:00Z') })).toBe(true);
    expect(comesBack({ fixedInVersion: '1.22.4', fixedAt }, { version: '1.22.4', at: new Date('2026-11-06T00:00:00Z') })).toBe(false);
    expect(comesBack({ fixedInVersion: '1.22.4', fixedAt }, { version: '1.22.3', at: new Date('2026-11-06T00:00:00Z') })).toBe(false);
  });
  it('fixed without a known version: any later occurrence brings it back', () => {
    expect(comesBack({ fixedInVersion: null, fixedAt }, { version: null, at: new Date('2026-11-05T11:00:00Z') })).toBe(true);
    expect(comesBack({ fixedInVersion: null, fixedAt }, { version: null, at: new Date('2026-11-05T09:00:00Z') })).toBe(false);
  });
});

describe('kindsFor and sinceFor: the page’s filters', () => {
  it('Errors include network problems', () => {
    expect(kindsFor('all')).toBeNull();
    expect(kindsFor('errors')).toEqual(['ERROR', 'NETWORK']);
    expect(kindsFor('blocked')).toEqual(['BLOCKED']);
    expect(kindsFor('slow')).toEqual(['SLOW']);
    expect(kindsFor('server')).toEqual(['SERVER']);
  });
  it('Today starts at midnight in the company time zone; 7 and 30 days count back from now', () => {
    const now = new Date('2026-11-05T06:30:00Z'); // 10:30 in Muscat
    expect(sinceFor('today', now, 'Asia/Muscat').toISOString()).toBe('2026-11-04T20:00:00.000Z');
    expect(sinceFor('7d', now, 'Asia/Muscat').toISOString()).toBe('2026-10-29T06:30:00.000Z');
    expect(sinceFor('30d', now, 'Asia/Muscat').toISOString()).toBe('2026-10-06T06:30:00.000Z');
  });
});

describe('describeReport: what a row says, and what it is grouped by', () => {
  it('an error: its own message; grouped by the message (numbers normalised), file and function', () => {
    const a = describeReport({ kind: 'ERROR', detail: 'error', message: 'Task 12 not found', top: { file: 'src/a.ts', fn: 'load' } });
    const b = describeReport({ kind: 'ERROR', detail: 'rejection', message: 'Task 98 not found', top: { file: 'src/a.ts', fn: 'load' } });
    expect(a.title).toBe('Task 12 not found');
    expect(a.key).toBe(b.key);
    expect(describeReport({ kind: 'ERROR', detail: 'error', message: 'Task 12 not found', top: { file: 'src/b.ts', fn: 'load' } }).key).not.toBe(a.key);
  });

  it('a site file that failed to load after a deploy: one row whatever the file’s hash', () => {
    const a = describeReport({ kind: 'ERROR', detail: 'chunk', message: 'Failed to fetch dynamically imported module: https://h/assets/BoardPage-B3x9kQ2a.js', top: null });
    const b = describeReport({ kind: 'ERROR', detail: 'chunk', message: 'Failed to fetch dynamically imported module: https://h/assets/BoardPage-Zz88Yy77.js', top: null });
    expect(a.key).toBe(b.key);
  });

  it('blocked: the directive and what was blocked (no query), the page’s event and the browser’s report alike', () => {
    const page = describeReport({ kind: 'BLOCKED', detail: 'csp', directive: 'script-src-elem', resource: 'https://evil.example/x.js' });
    const report = describeReport({ kind: 'BLOCKED', detail: 'csp-report', directive: 'script-src-elem', resource: 'https://evil.example/x.js' });
    expect(page.title).toBe('The security policy blocked script-src-elem: https://evil.example/x.js');
    expect(page.key).toBe(report.key);
    const file = describeReport({ kind: 'BLOCKED', detail: 'resource', resource: '/assets/index-Ab12Cd34.css', tag: 'link' });
    expect(file.title).toBe('A style file didn’t load: /assets/index-Ab12Cd34.css');
    expect(file.key).toBe(describeReport({ kind: 'BLOCKED', detail: 'resource', resource: '/assets/index-Qq11Ww22.css', tag: 'link' }).key);
  });

  it('slow: the number in the title, not in the grouping', () => {
    const a = describeReport({ kind: 'SLOW', detail: 'load', value: 9200, page: '/board' });
    expect(a.title).toBe('Slow page load: 9.2 s');
    expect(a.groupTitle).toBe('Slow page load');
    expect(a.key).toBe(describeReport({ kind: 'SLOW', detail: 'load', value: 12000, page: '/board' }).key);
    expect(a.key).not.toBe(describeReport({ kind: 'SLOW', detail: 'load', value: 9200, page: '/projects' }).key);
    expect(describeReport({ kind: 'SLOW', detail: 'lcp', value: 4500, page: '/' }).title).toBe('Slow to show the page: 4.5 s');
    expect(describeReport({ kind: 'SLOW', detail: 'inp', value: 820, page: '/' }).title).toBe('Slow to answer a click or key: 820 ms');
    expect(describeReport({ kind: 'SLOW', detail: 'cls', value: 0.314, page: '/' }).title).toBe('The page jumped around: 0.31');
    expect(describeReport({ kind: 'SLOW', detail: 'api', value: 12400, page: '/', resource: 'GET /api/v1/tasks/:id' }).title).toBe('Slow request: GET /api/v1/tasks/:id took 12.4 s');
  });

  it('network: one row per kind of problem', () => {
    const api = describeReport({ kind: 'NETWORK', detail: 'api', page: '/board', resource: 'GET /api/v1/tasks' });
    expect(api.title).toBe('A request didn’t reach the server (blocked on the way?)');
    expect(api.key).toBe(describeReport({ kind: 'NETWORK', detail: 'api', page: '/x', resource: 'POST /api/v1/y' }).key);
    expect(describeReport({ kind: 'NETWORK', detail: 'socket', page: '/board' }).title).toBe('The live connection couldn’t connect for over a minute');
  });

  it('server: grouped by the job or route, the message and the top frame', () => {
    const a = describeReport({ kind: 'SERVER', message: 'nightly backup sweep failed: ENOSPC', job: 'nightly-backup', top: { file: 'src/x.ts', fn: 'run' } });
    expect(a.title).toBe('nightly backup sweep failed: ENOSPC');
    expect(a.key).not.toBe(describeReport({ kind: 'SERVER', message: 'nightly backup sweep failed: ENOSPC', job: 'daily-task-emails', top: { file: 'src/x.ts', fn: 'run' } }).key);
  });

  it('the key is a sha-256 in hex', () => {
    expect(fingerprintOf(['a', 'b'])).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprintOf(['a', 'b'])).not.toBe(fingerprintOf(['ab', '']));
  });
});
