import { useMemo } from 'react';
import type { ApiTask } from '../../api/tasks';
import type { ApiCategory } from '../../api/categories';
import { CategoryChip, categoryStyle, type CategoryChipData } from '../CategoryChip';
import { SectionCard } from './parts';
import { CATEGORY_WORDS } from '../../lib/task-categories';
import { isTaskDone } from '../../lib/due-display';
import { taskCategoryChoices } from '../../lib/guest-category-filter';
import { useProjectCategories } from '../../lib/useProjectCategories';

export interface CategoryBreakdown {
  /** Each category with its open tasks, in the project's order (a retired one only while open tasks have it). */
  rows: { category: CategoryChipData; count: number }[];
  /** Open tasks with no category. */
  none: number;
  /** Open tasks in all. */
  open: number;
}

/**
 * 1.24 The project page's "By category": its open tasks per category (a task with several counts under
 * each) and how many have none — from the project's list when it is known, else from the tasks' own.
 */
export function categoryBreakdown(tasks: ApiTask[], list: ApiCategory[] | null): CategoryBreakdown {
  const open = tasks.filter((t) => !isTaskDone(t));
  const counts = new Map<string, number>();
  let none = 0;
  for (const t of open) {
    if (!t.categories?.length) none += 1;
    for (const c of t.categories ?? []) counts.set(c.id, (counts.get(c.id) ?? 0) + 1);
  }
  const categories: CategoryChipData[] = list
    ? [...list].sort((a, b) => a.position - b.position).filter((c) => !c.retired || (counts.get(c.id) ?? 0) > 0)
    : taskCategoryChoices(tasks);
  return {
    rows: categories.map((c) => ({ category: { id: c.id, name: c.name, color: c.color, retired: Boolean(c.retired) }, count: counts.get(c.id) ?? 0 })),
    none,
    open: open.length,
  };
}

/** The "By category" card on the project's Overview: hidden when the project has no categories. */
export function ByCategoryCard({ projectId, tasks, ready }: { projectId: string; tasks: ApiTask[]; ready: boolean }) {
  // Undefined while the list loads: nothing yet (no jump from the tasks' own categories to the list's).
  const list = useProjectCategories(projectId);
  const b = useMemo(() => categoryBreakdown(tasks, list ? list.categories : null), [tasks, list]);
  if (list === undefined || b.rows.length === 0) return null;
  const pct = (n: number) => (b.open ? Math.round((n / b.open) * 100) : 0);
  return (
    <SectionCard id="pd-by-category" title={CATEGORY_WORDS.byCategory}>
      {!ready ? (
        <div className="skeleton h-20 rounded-lg" />
      ) : (
        <>
          <ul className="flex flex-col gap-2.5">
            {b.rows.map(({ category, count }) => (
              <li key={category.id} className="flex items-center gap-3">
                <span className="flex w-28 min-w-0 flex-none [&_[data-category-chip]]:max-w-full">
                  <CategoryChip category={category} />
                </span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-ground" aria-hidden="true">
                  <span className="cat-swatch block h-full rounded-full" style={{ ...categoryStyle(category.color), width: `${pct(count)}%` }} />
                </span>
                <span className="w-6 flex-none text-right text-sm font-semibold tabular-nums text-ink-2">{count}</span>
              </li>
            ))}
            <li className="flex items-center gap-3">
              <span className="w-28 flex-none truncate text-sm text-ink-2">{CATEGORY_WORDS.noneOnTask}</span>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-ground" aria-hidden="true">
                <span className="block h-full rounded-full bg-ink-3/50" style={{ width: `${pct(b.none)}%` }} />
              </span>
              <span className="w-6 flex-none text-right text-sm font-semibold tabular-nums text-ink-2">{b.none}</span>
            </li>
          </ul>
          <p className="mt-3 border-t border-line pt-3 text-xs text-ink-2">
            {b.open} open {b.open === 1 ? 'task' : 'tasks'} · a task with several categories counts under each
          </p>
        </>
      )}
    </SectionCard>
  );
}
