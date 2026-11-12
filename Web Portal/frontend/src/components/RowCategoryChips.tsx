import { CategoryChips, type CategoryChipData } from './CategoryChip';
import type { RowDensity } from '../lib/task-categories';

/**
 * 1.24 A list row's categories (My Tasks' List, a project's Tasks tab): beside the title on one line —
 * at most 45% of the room, the chips' names cut short before the title is (a phone: on their own line
 * under the title) — or, Detailed, every chip on a line of their own under the title.
 */
export function RowCategoryChips({ categories, density, className = '' }: { categories: CategoryChipData[] | null | undefined; density: RowDensity; className?: string }) {
  if (!categories?.length) return null;
  const fit =
    density === 'detailed'
      ? 'basis-full'
      : 'min-w-0 shrink !flex-nowrap max-sm:basis-full sm:max-w-[45%] [&_[data-category-chip]]:min-w-0 [&_[data-category-chip]]:shrink';
  return <CategoryChips categories={categories} density={density} className={`${fit} ${className}`} />;
}
