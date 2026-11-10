import { CATEGORY_WORDS } from '../lib/task-categories';

/**
 * 1.24 "Needs a category": a task whose project asks every task for a category, and that has none (a
 * save from the app, or an older task). A small mark in words — a dashed outline, never a status colour.
 */
export function NeedsCategoryMark({ className = '' }: { className?: string }) {
  return (
    <span
      data-needs-category
      title={`${CATEGORY_WORDS.needs}: its project asks every task for one.`}
      className={`inline-flex max-w-full items-center gap-1 self-start rounded border border-dashed border-ink-3/60 px-1.5 py-0.5 text-[11px] font-medium leading-4 text-ink-2 ${className}`}
    >
      <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none text-warning">
        <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" />
        <circle cx="7.5" cy="7.5" r="1.2" fill="currentColor" />
      </svg>
      <span className="truncate">{CATEGORY_WORDS.needs}</span>
    </span>
  );
}
