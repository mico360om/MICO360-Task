import type { ReactNode } from 'react';

/** The view icons: a list, a table, a board. */
export const VIEW_ICONS: Record<'list' | 'table' | 'board', ReactNode> = {
  list: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  table: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 10h18M3 15h18M9 10v10" />
    </>
  ),
  board: (
    <>
      <rect x="3" y="4" width="5" height="16" rx="1.5" />
      <rect x="10" y="4" width="5" height="11" rx="1.5" />
      <rect x="17" y="4" width="4" height="7" rx="1.5" />
    </>
  ),
};

/**
 * "List | Table", "Board | Table" (1.23.0): one choice of how a page shows its items — each a button
 * that says which it is and whether it is the one shown (aria-pressed). From a small tablet the words
 * are shown beside the icons; on a phone, the icons (with their names).
 */
export function ViewSwitch<V extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: V;
  onChange: (v: V) => void;
  options: { value: V; label: string; icon: ReactNode }[];
  /** The group's name ("Show tasks as"). */
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex flex-none items-center rounded-xl border border-line bg-surface p-0.5 [@media(pointer:coarse)]:p-0">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            aria-label={`${o.label} view`}
            title={`${o.label} view`}
            onClick={() => onChange(o.value)}
            className={`inline-flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-semibold transition-colors [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:min-w-11 ${on ? 'bg-brand text-white shadow-sm' : 'text-ink-2 hover:bg-ground hover:text-ink'}`}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {o.icon}
            </svg>
            <span aria-hidden="true" className="max-sm:hidden">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
