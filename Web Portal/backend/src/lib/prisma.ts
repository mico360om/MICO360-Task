import { PrismaClient } from '@prisma/client';
import { withPoolDefaults } from './db-pool';
import { createLogger } from './logger';
import { trackDatabaseTime } from './request-timing';
import { withSaveRetries } from './save-retry';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * The server's one Prisma client. 1.23.2: with a steady pool — connection_limit=10&pool_timeout=20 when
 * DATABASE_URL sets no connection_limit (lib/db-pool; a value in the URL is never changed). 1.23.3: each
 * request's time in the database is measured (lib/request-timing — the answer's Server-Timing).
 * 1.23.29: a save conflict (MariaDB's 1020, a deadlock) is tried again (lib/save-retry) — added LAST, inside
 * the timing, so the timing counts every try; its one line per conflicted save goes to the server's log.
 */
const url = withPoolDefaults(process.env.DATABASE_URL);
const log = createLogger({ service: 'mico360-api', level: 'info' });
export const prisma = withSaveRetries(trackDatabaseTime(globalForPrisma.prisma ?? (url ? new PrismaClient({ datasources: { db: { url } } }) : new PrismaClient())), {
  logger: log,
});

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
