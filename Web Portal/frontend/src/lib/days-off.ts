import { dayOffReason, shiftDay, type WorkCalendar } from './working-days';

/** A run of days off in a row: from `start`, `days` long, named by its holidays (else "Weekend"). */
export interface DaysOffRun {
  start: string;
  days: number;
  label: string;
  /** It has a holiday in it (not only the weekend). */
  holiday: boolean;
}

/** The days off from `from` to `to` (both included) as runs — the Timeline shades each once. */
export function daysOffRuns(from: string, to: string, cal: WorkCalendar): DaysOffRun[] {
  const runs: DaysOffRun[] = [];
  let open: { start: string; days: number; names: string[] } | null = null;
  const close = () => {
    if (open) runs.push({ start: open.start, days: open.days, label: open.names.length ? open.names.join(', ') : 'Weekend', holiday: open.names.length > 0 });
    open = null;
  };
  for (let d = from; d <= to; d = shiftDay(d, 1)) {
    const why = dayOffReason(d, cal);
    if (!why) {
      close();
      continue;
    }
    if (!open) open = { start: d, days: 0, names: [] };
    open.days++;
    if (why.kind === 'holiday' && !open.names.includes(why.name)) open.names.push(why.name);
  }
  close();
  return runs;
}
