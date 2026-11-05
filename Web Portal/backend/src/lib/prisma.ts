import { PrismaClient } from '@prisma/client';
import { withPoolDefaults } from './db-pool';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * The server's one Prisma client. 1.23.2: with a steady pool — connection_limit=10&pool_timeout=20 when
 * DATABASE_URL sets no connection_limit (lib/db-pool; a value in the URL is never changed).
 */
const url = withPoolDefaults(process.env.DATABASE_URL);
export const prisma = globalForPrisma.prisma ?? (url ? new PrismaClient({ datasources: { db: { url } } }) : new PrismaClient());

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
