import { randomBytes } from 'node:crypto';

const COUNTER_SPAN = 36 ** 4;
let counter = Math.floor(Math.random() * COUNTER_SPAN);

/**
 * A new row id in the style of the ids Prisma gives (`cuid()`: 25 characters, 'c' then lower-case
 * letters and digits), for rows written in bulk (`createMany` returns no ids on MySQL, so the rows
 * that refer to them — checklist items, assignees — need them up front). The time, a counter and
 * random bits: unique across processes, roughly in creation order.
 */
export function newRowId(): string {
  counter = (counter + 1) % COUNTER_SPAN;
  const time = Date.now().toString(36).padStart(8, '0').slice(-8);
  const count = counter.toString(36).padStart(4, '0');
  const random = BigInt(`0x${randomBytes(8).toString('hex')}`).toString(36).padStart(12, '0').slice(-12);
  return `c${time}${count}${random}`;
}
