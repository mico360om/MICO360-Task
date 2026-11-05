/**
 * 1.23.1 — a database blip: the database couldn't be reached (P1001, P1002), took too long (P1008),
 * closed the connection (P1017), or had no free connection in time (P2024). On the live site these
 * came at deploy restarts and once for a minute; they are not a bug in a query. A request answers 503
 * with DATABASE_BUSY_MESSAGE (app.ts), a background job tries once more after a short wait
 * (lib/job-gate), and the Error log keeps one row per kind (error-log-service).
 */
export const CONNECTION_CODES: ReadonlySet<string> = new Set(['P1001', 'P1002', 'P1008', 'P1017', 'P2024']);

/** What the website shows (and the API answers, code DATABASE_BUSY) while the database is away. */
export const DATABASE_BUSY_MESSAGE = 'The database is busy — please try again in a moment.';

const PRISMA_ERRORS = new Set(['PrismaClientKnownRequestError', 'PrismaClientUnknownRequestError', 'PrismaClientInitializationError', 'PrismaClientRustPanicError']);

/** Prisma's words for one, when an error carries no code (the client starting up, the connector). */
const WORDS: [RegExp, string][] = [
  [/Can't reach database server/i, 'P1001'],
  [/database server was reached but timed out/i, 'P1002'],
  [/Server has closed the connection|Connection lost|connection reset/i, 'P1017'],
  [/Timed out fetching a new connection from the connection pool/i, 'P2024'],
];

/** The connection code of a Prisma error that is a database blip, or null for anything else. Never throws. */
export function databaseConnectionCode(err: unknown): string | null {
  try {
    if (!err || typeof err !== 'object') return null;
    const e = err as { name?: unknown; code?: unknown; errorCode?: unknown; message?: unknown };
    if (typeof e.name !== 'string' || !PRISMA_ERRORS.has(e.name)) return null;
    for (const c of [e.code, e.errorCode]) if (typeof c === 'string' && /^P\d{4}$/.test(c)) return CONNECTION_CODES.has(c) ? c : null;
    const text = typeof e.message === 'string' ? e.message.slice(0, 4000) : '';
    for (const [words, code] of WORDS) if (words.test(text)) return code;
    return null;
  } catch {
    return null;
  }
}
