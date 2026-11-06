import { PrismaClient } from '@prisma/client';
import { withPoolDefaults } from './db-pool';
import { trackDatabaseTime } from './request-timing';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * The server's one Prisma client. 1.23.2: with a steady pool — connection_limit=10&pool_timeout=20 when
 * DATABASE_URL sets no connection_limit (lib/db-pool; a value in the URL is never changed). 1.23.3: each
 * request's time in the database is measured (lib/request-timing — the answer's Server-Timing).
 */
const url = withPoolDefaults(process.env.DATABASE_URL);
export const prisma = trackDatabaseTime(globalForPrisma.prisma ?? (url ? new PrismaClient({ datasources: { db: { url } } }) : new PrismaClient()));

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
