export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LoggerOptions {
  service: string;
  level?: LogLevel;
  /** Where a line is written (defaults to stdout); injectable for tests. */
  sink?: (line: string) => void;
}

export type LogContext = Record<string, unknown>;

function serialize(value: unknown): unknown {
  if (value instanceof Error) {
    return { message: value.message, stack: value.stack, name: value.name };
  }
  return value;
}

/** Minimal structured (JSON-lines) logger for aggregation (T19.1). */
export function createLogger({ service, level = 'info', sink }: LoggerOptions) {
  const write = sink ?? ((line: string) => process.stdout.write(`${line}\n`));
  const min = ORDER[level];

  function log(lvl: LogLevel, msg: string, ctx?: LogContext): void {
    if (ORDER[lvl] < min) return;
    const entry: Record<string, unknown> = { level: lvl, time: new Date().toISOString(), service, msg };
    if (ctx) for (const [k, v] of Object.entries(ctx)) entry[k] = serialize(v);
    write(JSON.stringify(entry));
  }

  return {
    debug: (msg: string, ctx?: LogContext) => log('debug', msg, ctx),
    info: (msg: string, ctx?: LogContext) => log('info', msg, ctx),
    warn: (msg: string, ctx?: LogContext) => log('warn', msg, ctx),
    error: (msg: string, ctx?: LogContext) => log('error', msg, ctx),
  };
}

export type Logger = ReturnType<typeof createLogger>;
