import { TOUCH_TALL } from '../lib/touch';

export interface TaskKeyProps {
  /** The task's number (e.g. MICO-142). Nothing is shown without one. */
  value: string | null | undefined;
  /** `lg`: the task panel header, the height of the pills beside it. */
  size?: 'sm' | 'lg';
  /**
   * No vertical padding, so a one-line row keeps its height (the calendar month grid). `'compact'`:
   * a row of a list, table or board — no vertical padding only in compact rows (1.23.0, lib/density).
   */
  dense?: boolean | 'compact';
  className?: string;
}

/**
 * A task's number, the same way everywhere a task is shown in a list, card, row, header or popover
 * (1.22.3): the small grey mono chip the board cards have always had. It comes before the title,
 * never wraps or shrinks (a long code such as MICO360-10 once broke in two), and stays whole while
 * the title beside it truncates. In sentences — toasts, notices, PDFs, emails — the number is plain
 * text instead. `data-task-key` lets tests and the page find it.
 */
export function TaskKey({ value, size = 'sm', dense = false, className = '' }: TaskKeyProps) {
  if (!value) return null;
  const look = size === 'lg' ? 'rounded-md px-1.5 text-xs font-semibold' : 'rounded px-1.5 text-[11px]';
  return (
    <span
      data-task-key={value}
      dir="ltr"
      translate="no"
      className={`inline-block shrink-0 whitespace-nowrap bg-ground font-mono leading-4 text-ink-2 ${look} ${dense === true ? 'py-0' : dense === 'compact' ? 'py-0.5 compact:py-0' : 'py-0.5'} ${className}`}
    >
      {value}
    </span>
  );
}

/**
 * The number as the link to its task (Dashboard activity, the Activity page, My Action Items): the
 * chip inside a button that opens the task. With the task's title its name says which task it opens
 * ("Open MICO-9: Fix the pump"); in a sentence ("Ada updated MICO-9") its name is the number.
 */
export function TaskKeyButton({ value, title, onClick, className = '' }: { value: string; title?: string | null; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={title ? `Open ${value}: ${title}` : undefined}
      className={`group inline-flex flex-none items-center rounded ${TOUCH_TALL} ${className}`}
    >
      <TaskKey value={value} dense="compact" className="transition-colors group-hover:text-brand group-hover:underline group-focus-visible:text-brand" />
    </button>
  );
}

/**
 * A found task's number (top-bar search, the Search page) and, for a task that moved project, the
 * numbers it had: the chip, then "(was RIG-4)" in quieter words — its old number still finds it.
 */
export function FoundTaskKey({ value, former }: { value: string; former?: readonly string[] | null }) {
  return (
    <span className="inline-flex flex-none flex-wrap items-baseline gap-x-1">
      <TaskKey value={value} />
      {former && former.length > 0 ? <>{' '}<span className="whitespace-nowrap text-xs text-ink-3">(was {former.join(', ')})</span></> : null}
    </span>
  );
}

/** A number at the start of a notice's first line: "MICO-142 · ". */
const LEADING_KEY = /^[A-Z0-9]+-\d+(?: · |$)/;

/**
 * A notice's details without the number at the start, when the chip already shows it (the bell and
 * the Notifications page): "MICO-142 · Fix the pump" reads "Fix the pump" beside the MICO-142 chip.
 * An older number goes too — the chip shows the task's current one. Without a chip it is unchanged.
 */
export function bodyWithoutKey(body: string | null | undefined, chipKey: string | null | undefined): string {
  if (!body) return '';
  if (!chipKey) return body;
  return body.replace(LEADING_KEY, '');
}
