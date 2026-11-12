/** 1.24 The words of the admins' Guest contacts page (the shared GUEST_WORDS hold the rest). */

/** "On 3 tasks", "On 1 task", "Not on any task" (Recycle Bin tasks count, as the server counts them). */
export function onTasksText(n: number): string {
  if (n <= 0) return 'Not on any task';
  return `On ${n} ${n === 1 ? 'task' : 'tasks'}`;
}

/** "1 guest ticked", "3 guests ticked". */
export const tickedText = (n: number) => `${n} ${n === 1 ? 'guest' : 'guests'} ticked`;

/** "Merged into Ahmed (OXY), 3 tasks updated." */
export const mergedText = (label: string, tasks: number) => `Merged into ${label}, ${tasks} ${tasks === 1 ? 'task' : 'tasks'} updated.`;

/** The server's own words when guests of two companies are sent together, and what to do. */
export const MIXED_COMPANIES = 'Only guests on the same company’s list can be merged. Tick guests of one company.';
export const TICK_TWO = 'Tick two or more guests of one company to merge them.';
