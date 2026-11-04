import type { LogContext, Logger } from './logger';

/** A logger whose error lines also go to the Error log, and which can name a background job. */
export type ErrorLogLogger = Logger & {
  /** The same logger for one background job: every line it writes says `job`, so the Error log shows the job's name. */
  job(name: string): Logger;
};

/**
 * The one wrapper around `logger.error` (1.22.4): each error line is written exactly as before and is
 * also handed to the Error log (`record`) — a failed request ("request failed" with its route), a
 * background job's failure (`job`), or another background step. Recording never throws and never
 * fails twice: an error raised while recording (even one the recorder logs itself) is not recorded.
 */
export function withErrorLog(base: Logger, record: (message: string, ctx?: LogContext) => void): ErrorLogLogger {
  let recording = false;
  const error = (message: string, ctx?: LogContext) => {
    base.error(message, ctx);
    if (recording) return;
    recording = true;
    try {
      record(message, ctx);
    } catch {
      // The line is written; the Error log just misses this one.
    } finally {
      recording = false;
    }
  };
  const forJob = (name: string): Logger => {
    const add = (ctx?: LogContext): LogContext => ({ ...(ctx ?? {}), job: name });
    return {
      debug: (m, c) => base.debug(m, add(c)),
      info: (m, c) => base.info(m, add(c)),
      warn: (m, c) => base.warn(m, add(c)),
      error: (m, c) => error(m, add(c)),
    };
  };
  return { debug: base.debug, info: base.info, warn: base.warn, error, job: forJob };
}
