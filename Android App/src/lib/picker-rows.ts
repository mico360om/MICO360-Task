/**
 * What a long picker list shows (sheet-kit's InlinePicker): the options matching what is typed (in
 * the label or the hint), up to a limit — or all of them with no limit — and how many were left out,
 * so the list can say "Type to find more". A list like the time zones has no limit: every choice can
 * be reached by scrolling (6a review).
 */

/** The usual most rows shown at once (people, projects). */
export const PICKER_LIMIT = 60;

export function pickerRows<T extends { label: string; hint?: string }>(options: T[], query: string, limit: number | null): { shown: T[]; hidden: number } {
  const needle = query.trim().toLowerCase();
  const matching = needle ? options.filter((o) => `${o.label} ${o.hint ?? ''}`.toLowerCase().includes(needle)) : options;
  if (limit === null || matching.length <= limit) return { shown: matching, hidden: 0 };
  return { shown: matching.slice(0, limit), hidden: matching.length - limit };
}

/** The line under a list that leaves rows out (null when it shows them all). */
export function moreRowsText(hidden: number): string | null {
  return hidden > 0 ? `Type to find more (${hidden} not shown).` : null;
}
