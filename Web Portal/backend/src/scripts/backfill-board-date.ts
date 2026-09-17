/**
 * One-time backfill for per-date boards: give every existing task a `boardDate`.
 *  - Completed tasks (DONE column or completedAt set) land on their completion day.
 *  - Open tasks land on today's board so they're visible immediately.
 * Idempotent: only touches rows where boardDate is still NULL. Run once after the migration:
 *   npx tsx src/scripts/backfill-board-date.ts
 */
import { PrismaClient } from '@prisma/client';
import { boardDateFromKey, boardDateKey } from '../modules/tasks/board-date';

const prisma = new PrismaClient();
const tz = process.env.COMPANY_TIMEZONE || 'Asia/Muscat';

async function main(): Promise<void> {
  const now = new Date();
  const todayAnchor = boardDateFromKey(boardDateKey(now, tz));

  const tasks = await prisma.task.findMany({
    where: { boardDate: null },
    select: { id: true, completedAt: true, createdAt: true, column: { select: { category: true } } },
  });

  let done = 0;
  let open = 0;
  for (const t of tasks) {
    const isDone = t.column?.category === 'DONE' || t.completedAt !== null;
    const anchor = isDone ? boardDateFromKey(boardDateKey(t.completedAt ?? t.createdAt, tz)) : todayAnchor;
    await prisma.task.update({ where: { id: t.id }, data: { boardDate: anchor } });
    if (isDone) done++;
    else open++;
  }

  console.log(JSON.stringify({ backfilled: tasks.length, open, done, todayKey: boardDateKey(now, tz), tz }));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
