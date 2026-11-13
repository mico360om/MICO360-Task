import { PrismaClient } from '@prisma/client';
import { withSaveRetries } from '../../src/lib/save-retry';

/**
 * The DB tests' Prisma client, as the server's own (src/lib/prisma.ts): with the 1.23.29 save-retry layer, so a
 * save conflict (MariaDB's 1020 under snapshot isolation, a deadlock) is tried again exactly as on the live
 * site. A test whose writes race each other on a plain client would see conflicts the live server never shows
 * (task-move's three concurrent moves flaked on MariaDB 11.8.9 that way).
 */
export function testPrisma(url: string | undefined = process.env.TEST_DATABASE_URL): PrismaClient {
  return withSaveRetries(new PrismaClient({ datasources: { db: { url } } }));
}
