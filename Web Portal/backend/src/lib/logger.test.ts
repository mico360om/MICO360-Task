import { describe, it, expect } from 'vitest';
import { createLogger } from './logger';

function capture() {
  const lines: string[] = [];
  return { write: (s: string) => lines.push(s), lines };
}

describe('createLogger', () => {
  it('emits a single JSON line per log call with level, time, service and message', () => {
    const out = capture();
    const log = createLogger({ service: 'api', sink: out.write });
    log.info('server started');
    expect(out.lines).toHaveLength(1);
    const entry = JSON.parse(out.lines[0]!);
    expect(entry.level).toBe('info');
    expect(entry.service).toBe('api');
    expect(entry.msg).toBe('server started');
    expect(typeof entry.time).toBe('string');
    expect(Number.isNaN(Date.parse(entry.time))).toBe(false);
  });

  it('merges structured context fields', () => {
    const out = capture();
    const log = createLogger({ service: 'api', sink: out.write });
    log.warn('slow query', { ms: 1200, route: '/tasks' });
    const entry = JSON.parse(out.lines[0]!);
    expect(entry.level).toBe('warn');
    expect(entry.ms).toBe(1200);
    expect(entry.route).toBe('/tasks');
  });

  it('serializes an Error with its message and stack', () => {
    const out = capture();
    const log = createLogger({ service: 'api', sink: out.write });
    log.error('boom', { err: new Error('kaboom') });
    const entry = JSON.parse(out.lines[0]!);
    expect(entry.level).toBe('error');
    expect(entry.err.message).toBe('kaboom');
    expect(entry.err.stack).toContain('kaboom');
  });

  it('respects the minimum level', () => {
    const out = capture();
    const log = createLogger({ service: 'api', sink: out.write, level: 'warn' });
    log.debug('noisy');
    log.info('also noisy');
    log.warn('kept');
    expect(out.lines).toHaveLength(1);
    expect(JSON.parse(out.lines[0]!).msg).toBe('kept');
  });
});
