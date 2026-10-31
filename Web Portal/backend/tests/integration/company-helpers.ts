import { readFileSync } from 'node:fs';
import type { PrismaClient } from '@prisma/client';
import { BACKFILL_SQL_PATH, DEFAULT_COMPANY } from '../../src/modules/companies/default-company';

/** The backfill migration's statements: `--` comment lines dropped, split on a `;` that ends a line. */
export function backfillStatements(): string[] {
  return readFileSync(BACKFILL_SQL_PATH, 'utf8')
    .split(/\r?\n/)
    .filter((line) => !/^\s*--/.test(line))
    .join('\n')
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Runs the companies backfill again: every person and project that has no company yet joins the
 * site's default company — what upgrading a one-company site does. The DB tests that predate
 * companies call it at the end of their setup, so today's team rule decides what they see.
 */
export async function runBackfill(prisma: PrismaClient): Promise<void> {
  for (const statement of backfillStatements()) await prisma.$executeRawUnsafe(statement);
}

/**
 * Companies, for the DB tests that predate them: puts these people and projects in one company —
 * the site's default company (as every person and project on a one-company site is, after the
 * backfill) — so today's team rule decides what they see, exactly as before. People get it as their
 * primary company when they have none; projects as their main company when they have none.
 * Nothing extra is left behind: the rows go when the people and projects are deleted.
 * Returns the company's id.
 */
export async function inOneCompany(prisma: PrismaClient, { userIds = [], projectIds = [] }: { userIds?: string[]; projectIds?: string[] }): Promise<string> {
  const companyId = DEFAULT_COMPANY.id;
  await prisma.company.upsert({ where: { id: companyId }, update: {}, create: { id: companyId, name: DEFAULT_COMPANY.name, code: DEFAULT_COMPANY.code } });
  if (userIds.length) {
    await prisma.companyMember.createMany({ data: userIds.map((userId) => ({ companyId, userId })), skipDuplicates: true });
    await prisma.user.updateMany({ where: { id: { in: userIds }, primaryCompanyId: null }, data: { primaryCompanyId: companyId } });
  }
  if (projectIds.length) {
    await prisma.projectCompany.createMany({ data: projectIds.map((projectId) => ({ companyId, projectId })), skipDuplicates: true });
    await prisma.project.updateMany({ where: { id: { in: projectIds }, mainCompanyId: null }, data: { mainCompanyId: companyId } });
  }
  return companyId;
}
