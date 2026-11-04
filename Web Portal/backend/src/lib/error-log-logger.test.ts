import { describe, it, expect } from 'vitest';
import { createLogger } from './logger';
import { withErrorLog } from './error-log-logger';

function setup(record: (msg: string, ctx?: Record<string, unknown>) => void = () => {}) {
  const lines: Record<string, unknown>[] = [];
  const base = createLogger({ service: 't', level: 'debug', sink: (l) => lines.push(JSON.parse(l) as Record<string, unknown>) });
  const recorded: [string, Record<string, unknown> | undefined][] = [];
  const logger = withErrorLog(base, (msg, ctx) => {
    recorded.push([msg, ctx]);
    record(msg, ctx);
  });
  return { lines, recorded, logger };
}

describe('withErrorLog: every error line also goes to the Error log', () => {
  it('error lines are written as before and recorded; other levels are only written', () => {
    const { lines, recorded, logger } = setup();
    logger.info('hello', { a: 1 });
    logger.warn('careful');
    logger.error('request failed', { route: '/x', status: 500 });
    expect(lines.map((l) => [l.level, l.msg])).toEqual([['info', 'hello'], ['warn', 'careful'], ['error', 'request failed']]);
    expect(recorded).toEqual([['request failed', { route: '/x', status: 500 }]]);
  });

  it('a job’s logger names the job on every line it writes and records', () => {
    const { lines, recorded, logger } = setup();
    const job = logger.job('nightly-backup');
    job.info('started');
    job.error('nightly backup sweep failed', { err: new Error('ENOSPC') });
    expect(lines[0]).toMatchObject({ msg: 'started', job: 'nightly-backup' });
    expect(lines[1]).toMatchObject({ msg: 'nightly backup sweep failed', job: 'nightly-backup' });
    expect(recorded[0]![1]).toMatchObject({ job: 'nightly-backup' });
    expect(recorded[0]![1]!.err).toBeInstanceOf(Error);
    // The job's own context can't rename it.
    job.error('x', { job: 'other' });
    expect(recorded[1]![1]!.job).toBe('nightly-backup');
  });

  it('recording that throws is never a second failure: the line is written and nothing is thrown', () => {
    const { lines, logger } = setup(() => {
      throw new Error('store down');
    });
    expect(() => logger.error('boom')).not.toThrow();
    expect(() => logger.job('j').error('boom')).not.toThrow();
    expect(lines.filter((l) => l.level === 'error')).toHaveLength(2);
  });

  it('a recorder that logs an error itself does not loop', () => {
    let depth = 0;
    const lines: unknown[] = [];
    const base = createLogger({ service: 't', sink: (l) => lines.push(l) });
    const logger = withErrorLog(base, () => {
      depth += 1;
      if (depth < 5) logger.error('the recorder failed');
    });
    logger.error('first');
    expect(depth).toBe(1);
    expect(lines).toHaveLength(2);
  });
});
