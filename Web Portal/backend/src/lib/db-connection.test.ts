import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import { databaseConnectionCode, DATABASE_BUSY_MESSAGE } from './db-connection';

const CLIENT = '5.22.0';

// 1.23.1 — the live site lost its database for a moment at each deploy restart (and once at 14:24):
// "Can't reach database server" (P1001) in the jobs and in two requests. Those are blips, not bugs.
describe('databaseConnectionCode: a database that couldn’t be reached, dropped the connection or had none free', () => {
  it('Prisma’s connection codes, from a request error or the client starting up', () => {
    expect(databaseConnectionCode(new Prisma.PrismaClientKnownRequestError("Can't reach database server at `x`:`3306`", { code: 'P1001', clientVersion: CLIENT }))).toBe('P1001');
    expect(databaseConnectionCode(new Prisma.PrismaClientKnownRequestError('Server has closed the connection.', { code: 'P1017', clientVersion: CLIENT }))).toBe('P1017');
    expect(databaseConnectionCode(new Prisma.PrismaClientKnownRequestError('Timed out fetching a new connection from the connection pool.', { code: 'P2024', clientVersion: CLIENT }))).toBe('P2024');
    expect(databaseConnectionCode(new Prisma.PrismaClientKnownRequestError('Operations timed out', { code: 'P1008', clientVersion: CLIENT }))).toBe('P1008');
    expect(databaseConnectionCode(new Prisma.PrismaClientInitializationError("Can't reach database server at `x`:`3306`", CLIENT, 'P1001'))).toBe('P1001');
    expect(databaseConnectionCode(new Prisma.PrismaClientInitializationError("Can't reach database server at `x`:`3306`", CLIENT))).toBe('P1001');
    expect(databaseConnectionCode(new Prisma.PrismaClientUnknownRequestError('Error in connector: Server has closed the connection.', { clientVersion: CLIENT }))).toBe('P1017');
  });

  it('any other error is none: a bad query, a duplicate, a plain error, nothing', () => {
    expect(databaseConnectionCode(new Prisma.PrismaClientKnownRequestError('Raw query failed.', { code: 'P2010', clientVersion: CLIENT, meta: { code: '1054' } }))).toBeNull();
    expect(databaseConnectionCode(new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: CLIENT }))).toBeNull();
    expect(databaseConnectionCode(new Error("Can't reach database server"))).toBeNull();
    expect(databaseConnectionCode({ code: 'P1001' })).toBeNull();
    expect(databaseConnectionCode(null)).toBeNull();
  });

  it('the words people see', () => {
    expect(DATABASE_BUSY_MESSAGE).toBe('The database is busy — please try again in a moment.');
  });
});
