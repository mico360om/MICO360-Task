import { Prisma, type PrismaClient } from '@prisma/client';
import { ValidationError } from '../../lib/http-errors';

/**
 * Training Center (R16): departments on the server (users.departmentId) get a field in User Management —
 * pick one or type a new name — so training can be assigned to a department. A name is found ignoring
 * case (the database's collation; the name is unique), else made.
 */
export interface Departments {
  /** Every department, A–Z. */
  list(): Promise<{ id: string; name: string }[]>;
  /** The department with this name (any case), made when there is none. */
  findOrCreate(name: string): Promise<{ id: string; name: string }>;
}

/** The longest department name the API takes (the column is wider; MariaDB non-strict would cut silently). */
export const DEPARTMENT_NAME_MAX = 80;

/** Trimmed, inner spaces folded; null when nothing is left. */
export function cleanDepartmentName(raw: string | null | undefined): string | null {
  const name = String(raw ?? '').replace(/\s+/g, ' ').trim();
  return name || null;
}

export function createPrismaDepartments(prisma: Pick<PrismaClient, 'department'>): Departments {
  const select = { id: true, name: true } as const;
  return {
    async list() {
      return prisma.department.findMany({ select, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
    },
    async findOrCreate(raw) {
      const name = cleanDepartmentName(raw);
      if (!name) throw new ValidationError('A department needs a name.', { field: 'departmentName' });
      if ([...name].length > DEPARTMENT_NAME_MAX) throw new ValidationError(`A department name has at most ${DEPARTMENT_NAME_MAX} characters.`, { field: 'departmentName' });
      const found = await prisma.department.findFirst({ where: { name }, select });
      if (found) return found;
      try {
        return await prisma.department.create({ data: { name }, select });
      } catch (err) {
        // Made by another request at the same moment: the one now there is it.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          const again = await prisma.department.findFirst({ where: { name }, select });
          if (again) return again;
        }
        throw err;
      }
    },
  };
}
