import type { CSSProperties } from 'react';
import { categoryChips, categoryTones, type RowDensity } from '../lib/task-categories';

export interface CategoryChipData {
  id: string;
  name: string;
  color: string;
  retired?: boolean;
}

/** The colour of a category as CSS variables for both themes (index.css `.cat-chip` picks the one in use). */
export function categoryStyle(color: string): CSSProperties {
  const t = categoryTones(color);
  return {
    '--cat-light-fill': t.light.fill,
    '--cat-light-text': t.light.text,
    '--cat-light-soft': t.light.soft,
    '--cat-dark-fill': t.dark.fill,
    '--cat-dark-text': t.dark.text,
    '--cat-dark-soft': t.dark.soft,
  } as CSSProperties;
}

/**
 * 1.24 One task category as a small chip: its name in its colour on its tint, after a square swatch (a
 * status has a round dot — the two never look alike). `data-category-chip` lets tests and pages find it.
 */
export function CategoryChip({ category, className = '' }: { category: CategoryChipData; className?: string }) {
  return (
    <span
      data-category-chip={category.id}
      role="img"
      aria-label={`Category: ${category.name}${category.retired ? ' (retired)' : ''}`}
      title={category.retired ? `${category.name} (retired)` : category.name}
      style={categoryStyle(category.color)}
      className={`cat-chip inline-flex max-w-[12rem] shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium leading-4 ${category.retired ? 'opacity-80' : ''} ${className}`}
    >
      <span aria-hidden="true" className="cat-swatch h-2 w-2 flex-none rounded-[2px]" />
      <span aria-hidden="true" className="truncate">{category.name}</span>
    </span>
  );
}

/** A task's categories on a card or row: Compact 1, Comfortable 2, Detailed all — then "+N" naming the rest. */
export function CategoryChips({ categories, density, className = '' }: { categories: CategoryChipData[] | null | undefined; density: RowDensity; className?: string }) {
  const { shown, more } = categoryChips(categories, density);
  if (shown.length === 0) return null;
  const rest = (categories ?? []).slice(shown.length).map((c) => c.name);
  return (
    <span className={`inline-flex min-w-0 flex-wrap items-center gap-1 ${className}`} data-category-chips="">
      {shown.map((c) => (
        <CategoryChip key={c.id} category={c} />
      ))}
      {more > 0 ? (
        <span title={rest.join(', ')} aria-label={`and ${more} more: ${rest.join(', ')}`} className="rounded bg-ground px-1.5 py-0.5 text-[11px] leading-4 text-ink-2">
          +{more}
        </span>
      ) : null}
    </span>
  );
}
