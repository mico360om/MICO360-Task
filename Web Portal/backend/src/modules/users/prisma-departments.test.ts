import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { cleanDepartmentName, createPrismaDepartments, DEPARTMENT_NAME_MAX } from './prisma-departments';

/** A stand-in for prisma.department: names compared ignoring case (the database's collation). */
function fakePrisma(opts: { raceOnce?: boolean } = {}) {
  const rows: { id: string; name: string }[] = [];
  let race = opts.raceOnce ?? false;
  const department = {
    async findMany() {
      return [...rows].sort((a, b) => a.name.localeCompare(b.name));
    },
    async findFirst({ where }: { where: { name: string } }) {
      return rows.find((r) => r.name.toLowerCase() === where.name.toLowerCase()) ?? null;
    },
    async create({ data }: { data: { name: string } }) {
      if (race) {
        // Someone else made it a moment ago (another request): the unique index refuses this one.
        race = false;
        rows.push({ id: 'theirs', name: data.name.toUpperCase() });
        throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'x' });
      }
      const row = { id: `d${rows.length + 1}`, name: data.name };
      rows.push(row);
      return row;
    },
  };
  return { prisma: { department } as never, rows };
}

describe('Departments (User Management’s Department field)', () => {
  it('a name is trimmed, spaces folded; empty is no department', () => {
    expect(cleanDepartmentName('  Site   works ')).toBe('Site works');
    expect(cleanDepartmentName('   ')).toBeNull();
    expect(cleanDepartmentName(null)).toBeNull();
    expect(DEPARTMENT_NAME_MAX).toBe(80);
  });

  it('finds a department by name ignoring case, else makes it; lists them A–Z', async () => {
    const { prisma } = fakePrisma();
    const d = createPrismaDepartments(prisma);
    const sales = await d.findOrCreate(' Sales ');
    expect(sales).toEqual({ id: 'd1', name: 'Sales' });
    expect(await d.findOrCreate('SALES')).toEqual(sales);
    await d.findOrCreate('Engineering');
    expect((await d.list()).map((x) => x.name)).toEqual(['Engineering', 'Sales']);
  });

  it('made by someone else at the same moment: the one already there is used', async () => {
    const { prisma } = fakePrisma({ raceOnce: true });
    expect(await createPrismaDepartments(prisma).findOrCreate('Finance')).toEqual({ id: 'theirs', name: 'FINANCE' });
  });

  it('refuses an empty or too long name', async () => {
    const d = createPrismaDepartments(fakePrisma().prisma);
    await expect(d.findOrCreate('  ')).rejects.toMatchObject({ status: 400 });
    await expect(d.findOrCreate('x'.repeat(81))).rejects.toMatchObject({ status: 400 });
  });
});
