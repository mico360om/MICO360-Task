import { categoryStyle } from '../CategoryChip';
import { CATEGORY_WORDS } from '../../lib/task-categories';
import { TOUCH_TALL } from '../../lib/touch';

/** A category as the picker lists it (a project's category, or one a task carries). */
export interface PickableCategory {
  id: string;
  name: string;
  color: string;
  position?: number;
  retired?: boolean;
}

/**
 * 1.24 Pick a task's categories from its project's list: each a toggle in its own colour (a square
 * swatch, a tick when picked), in the project's order. A retired category isn't offered — except one
 * the task already has (`kept`), shown marked "retired" so it can stay or be taken off.
 */
export function CategoryPicker({
  categories,
  value,
  onChange,
  kept = [],
  label = CATEGORY_WORDS.pick,
  labelledBy,
  describedBy,
  invalid,
  required,
  disabled = false,
}: {
  categories: PickableCategory[];
  value: string[];
  onChange: (ids: string[]) => void;
  /** Retired categories already on the task: still listed. */
  kept?: string[];
  label?: string;
  labelledBy?: string;
  describedBy?: string;
  invalid?: boolean;
  required?: boolean;
  disabled?: boolean;
}) {
  const ordered = [...categories].sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.name.localeCompare(b.name, 'en'));
  const shown = ordered.filter((c) => !c.retired || kept.includes(c.id) || value.includes(c.id));
  const toggle = (id: string) => {
    const next = value.includes(id) ? value.filter((x) => x !== id) : [...value, id];
    // Always in the project's order.
    onChange(ordered.map((c) => c.id).filter((x) => next.includes(x)));
  };
  return (
    <div
      role="group"
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      aria-required={required || undefined}
      className="flex flex-wrap gap-1.5"
    >
      {shown.length === 0 ? <p className="text-sm text-ink-3">{CATEGORY_WORDS.none}</p> : null}
      {shown.map((c) => {
        const on = value.includes(c.id);
        const name = c.retired ? `${c.name} (${CATEGORY_WORDS.retired})` : c.name;
        return (
          <button
            key={c.id}
            type="button"
            aria-pressed={on}
            aria-label={name}
            title={name}
            disabled={disabled}
            onClick={() => toggle(c.id)}
            style={categoryStyle(c.color)}
            className={`inline-flex h-8 max-w-full items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors disabled:opacity-60 ${TOUCH_TALL} ${
              on ? 'cat-chip border-transparent ring-1 ring-current' : 'border-line bg-surface text-ink-2 hover:border-ink-3 hover:text-ink'
            }`}
          >
            {on ? (
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            ) : (
              <span aria-hidden="true" className="cat-swatch h-2.5 w-2.5 flex-none rounded-[2px]" />
            )}
            <span aria-hidden="true" dir="auto" className="truncate">
              {c.name}
            </span>
            {c.retired ? (
              <span aria-hidden="true" className="flex-none text-[10px] font-normal opacity-80">
                {CATEGORY_WORDS.retired}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
