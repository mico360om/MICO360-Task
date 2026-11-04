import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { PAGE_SIZE, nextSort, sortRows, type SortDir, type SortState, type SortValue } from '../../lib/data-table';
import { AnchoredPopover } from '../ui/AnchoredPopover';
import { TOUCH_TALL } from '../../lib/touch';

/**
 * The shared table of the Table view (1.23.0) — tasks on the project page, My Tasks and the Board,
 * and a meeting's topics with their action items. A header click sorts (ascending, descending, then
 * the page's own order); optional columns are shown or hidden from "Columns"; a hundred rows are
 * drawn at a time ("Show 100 more"). From 768px the table scrolls inside its box with the header
 * kept in view; on a phone the box scrolls sideways under the pinned title column, so the page itself
 * never does. The cells are the caller's (quick-edit controls, components/data-table/cells).
 */

export interface DataColumn<Row> {
  id: string;
  /** The header's words (the Columns menu's too). */
  label: string;
  /** The words only for screen readers (the Open column). */
  hideLabel?: boolean;
  /** The header cell's own contents instead of the words. */
  header?: ReactNode;
  cell: (row: Row) => ReactNode;
  sortable?: boolean;
  /** The way a first click sorts (default ascending). */
  firstDir?: SortDir;
  /** Shown or hidden from the Columns menu; `defaultShown: false` — hidden at first. */
  optional?: boolean;
  defaultShown?: boolean;
  /**
   * Pinned at the start while a phone scrolls the table sideways. The first pinned column sits at the
   * edge; a second one after it assumes the first is the 2.75rem select column (`w-11`).
   */
  pin?: boolean;
  /** Not drawn on a phone (its facts are in a pinned cell there). */
  phoneHidden?: boolean;
  /** The row's header cell (the title): `<th scope="row">`. */
  rowHeader?: boolean;
  /** Width and alignment, for the header and the cells. */
  className?: string;
}

export interface DataSection<Row> {
  key: string;
  /** The group's heading row's cells (`<th>`/`<td>`s), e.g. a meeting topic with its own quick edits. */
  head?: ReactNode;
  rows: Row[];
  /** Folded: only its heading row. */
  collapsed?: boolean;
  /** A class for the heading row. */
  headClassName?: string;
}

export interface DataTableProps<Row> {
  /** The table's name (its caption and its scrolling region's). */
  label: string;
  columns: DataColumn<Row>[];
  /** The rows in the page's order — or `sections`, groups each sorted on its own. */
  rows?: Row[];
  sections?: DataSection<Row>[];
  rowKey: (row: Row) => string;
  sort: SortState | null;
  onSort: (next: SortState | null) => void;
  /** What a row sorts by. Absent: the page has put the rows in order itself (My Tasks' Sort menu). */
  sortValue?: (row: Row, column: string) => SortValue;
  /** The optional columns shown. */
  shown: string[];
  onShownChange: (ids: string[]) => void;
  /** The filter bar, a count… — before the Columns menu, above the table. */
  toolbar?: ReactNode;
  /** Messages above the table (a refused save, "sent for approval"). */
  notice?: ReactNode;
  /** Instead of the table when there are no rows. */
  empty?: ReactNode;
  rowClassName?: (row: Row) => string;
  /** A row's own attributes (e.g. data-task-key). */
  rowProps?: (row: Row) => Record<string, string | undefined>;
}

/** A pinned cell on a phone: it stays at the start while the rest scrolls under it. */
const PIN_FIRST = 'max-md:sticky max-md:start-0 max-md:z-[2] max-md:bg-surface';
const PIN_SECOND = 'max-md:sticky max-md:start-11 max-md:z-[2] max-md:bg-surface';
const PIN_EDGE = 'max-md:shadow-[1px_0_0_rgb(var(--c-line))]';
/** A group heading row's first cell, pinned like the title column (its background is the caller's). */
export const PINNED_HEAD_CELL = `max-md:sticky max-md:start-0 max-md:z-[2] ${PIN_EDGE}`;
/** A cell's usual padding and line (for a group heading row's own cells). */
export const CELL = 'border-b border-line px-3 py-1.5 align-middle';

export function DataTable<Row>({
  label,
  columns,
  rows,
  sections,
  rowKey,
  sort,
  onSort,
  sortValue,
  shown,
  onShownChange,
  toolbar,
  notice,
  empty,
  rowClassName,
  rowProps,
}: DataTableProps<Row>) {
  const [limit, setLimit] = useState(PAGE_SIZE);
  const visible = useMemo(() => columns.filter((c) => !c.optional || shown.includes(c.id)), [columns, shown]);
  const optional = columns.filter((c) => c.optional);
  // Where each pinned column sits (the first at the edge, the next after the select column).
  // (A line after the last pinned one, where the scrolling cells slide under it.)
  const pinClass = useMemo(() => {
    const pinned = visible.filter((c) => c.pin);
    const m = new Map<string, string>();
    if (pinned[0]) m.set(pinned[0].id, pinned.length === 1 ? `${PIN_FIRST} ${PIN_EDGE}` : PIN_FIRST);
    if (pinned[1]) m.set(pinned[1].id, `${PIN_SECOND} ${PIN_EDGE}`);
    return m;
  }, [visible]);

  const groups: DataSection<Row>[] = useMemo(() => {
    const order = (list: Row[]) => (sortValue && sort ? sortRows(list, sort, sortValue) : list);
    return sections ? sections.map((s) => ({ ...s, rows: order(s.rows) })) : [{ key: '__all', rows: order(rows ?? []) }];
  }, [sections, rows, sort, sortValue]);
  const total = groups.reduce((n, g) => n + (g.collapsed ? 0 : g.rows.length), 0);
  const hasAny = sections ? sections.length > 0 : (rows ?? []).length > 0;

  // The first `limit` rows across the groups (a folded group draws only its heading).
  let budget = limit;
  const drawn = groups.map((g) => {
    if (g.collapsed) return { ...g, rows: [] as Row[] };
    const take = Math.max(0, Math.min(g.rows.length, budget));
    budget -= take;
    return { ...g, rows: g.rows.slice(0, take) };
  });
  const left = total - Math.min(total, limit);
  const next = Math.min(PAGE_SIZE, left);

  const cellClass = (c: DataColumn<Row>) => `px-3 py-1.5 align-middle ${c.phoneHidden ? 'max-md:hidden' : ''} ${pinClass.get(c.id) ?? ''} ${c.className ?? ''}`;

  return (
    <div>
      {toolbar || optional.length ? (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {toolbar}
          {optional.length ? (
            <div className="ms-auto">
              <ColumnsMenu columns={optional} shown={shown} onChange={onShownChange} />
            </div>
          ) : null}
        </div>
      ) : null}
      {notice}
      {!hasAny ? (
        empty ?? null
      ) : (
        <>
          <div role="region" aria-label={label} tabIndex={0} className="card overflow-x-auto outline-none focus-visible:ring-2 focus-visible:ring-brand/40 md:max-h-[calc(100dvh-7.5rem)] md:overflow-y-auto">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <caption className="sr-only">{label}</caption>
              <thead>
                <tr>
                  {visible.map((c) => {
                    const sorted = sort?.column === c.id ? sort.dir : null;
                    return (
                      <th
                        key={c.id}
                        scope="col"
                        aria-sort={sorted ? (sorted === 'asc' ? 'ascending' : 'descending') : undefined}
                        className={`border-b border-line bg-surface px-3 py-2 text-start text-xs font-semibold uppercase tracking-wide text-ink-2 md:sticky md:top-0 md:z-[3] ${cellClass(c)} max-md:z-[3]`}
                      >
                        {c.header ? (
                          c.header
                        ) : c.hideLabel ? (
                          <span className="sr-only">{c.label}</span>
                        ) : c.sortable ? (
                          <button
                            type="button"
                            title={`Sort by ${c.label}`}
                            onClick={() => onSort(nextSort(sort, c.id, c.firstDir))}
                            className={`-mx-1 inline-flex items-center gap-1 whitespace-nowrap rounded px-1 uppercase tracking-wide transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${sorted ? 'text-ink' : ''} ${TOUCH_TALL}`}
                          >
                            {c.label}
                            <SortMark dir={sorted} />
                          </button>
                        ) : (
                          <span className="whitespace-nowrap">{c.label}</span>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              {drawn.map((g) => (
                <tbody key={g.key}>
                  {g.head ? <tr className={g.headClassName ?? 'bg-ground/60'}>{g.head}</tr> : null}
                  {g.rows.map((row) => (
                    <tr key={rowKey(row)} {...(rowProps?.(row) ?? {})} className={`group/row transition-colors hover:bg-ground/50 ${rowClassName?.(row) ?? ''}`}>
                      {visible.map((c) =>
                        c.rowHeader ? (
                          <th key={c.id} scope="row" className={`border-b border-line text-start font-normal ${cellClass(c)}`}>
                            {c.cell(row)}
                          </th>
                        ) : (
                          <td key={c.id} className={`border-b border-line ${cellClass(c)}`}>
                            {c.cell(row)}
                          </td>
                        ),
                      )}
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
          {left > 0 ? (
            <div className="mt-2 flex justify-center">
              <button
                type="button"
                onClick={() => setLimit((l) => l + PAGE_SIZE)}
                className={`rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-semibold text-ink transition-colors hover:border-brand/40 hover:text-brand ${TOUCH_TALL}`}
              >
                {left > next ? `Show ${next} more (${left} left)` : `Show ${next} more`}
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function SortMark({ dir }: { dir: SortDir | null }) {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={dir ? 'text-brand' : 'text-ink-3 opacity-60'}>
      {dir === 'asc' ? <path d="m6 15 6-6 6 6" /> : dir === 'desc' ? <path d="m6 9 6 6 6-6" /> : <path d="m8 10 4-4 4 4M8 14l4 4 4-4" />}
    </svg>
  );
}

/** "Columns": the optional columns, each a tick box to show or hide it. */
function ColumnsMenu<Row>({ columns, shown, onChange }: { columns: DataColumn<Row>[]; shown: string[]; onChange: (ids: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const headingId = useId();
  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-sm font-medium text-ink transition-colors hover:border-brand/40 ${TOUCH_TALL}`}
      >
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M9 4v16M15 4v16" />
        </svg>
        Columns
      </button>
      {open ? (
        <AnchoredPopover anchor={anchor} labelledBy={headingId} onClose={() => setOpen(false)} className="w-56 rounded-xl border border-line bg-surface p-2 shadow-lift">
          <p id={headingId} data-popover-heading tabIndex={-1} className="px-2 pb-1 pt-0.5 text-xs font-semibold uppercase tracking-wide text-ink-3 outline-none">
            Show columns
          </p>
          {columns.map((c) => (
            <label key={c.id} className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-ink hover:bg-ground ${TOUCH_TALL}`}>
              <input
                type="checkbox"
                data-popover-action
                checked={shown.includes(c.id)}
                onChange={(e) => onChange(e.target.checked ? [...shown, c.id] : shown.filter((id) => id !== c.id))}
                className="h-4 w-4 accent-brand"
              />
              {c.label}
            </label>
          ))}
        </AnchoredPopover>
      ) : null}
    </>
  );
}
