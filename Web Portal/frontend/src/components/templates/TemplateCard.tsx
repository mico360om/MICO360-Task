import type { ReactNode } from 'react';
import { ActionMenu, type ActionMenuItem } from '../meeting/ActionMenu';
import { Button } from '../ui/Button';

const ICON = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };

/** Drawn icons for templates (in the style of the meeting kit's). */
export const TemplateGlyph = {
  /** A board with a stack behind it: a project template. */
  project: (
    <svg {...ICON} width={20} height={20}>
      <rect x="6" y="3" width="15" height="14" rx="2" />
      <path d="M3 7v11a3 3 0 0 0 3 3h11" />
      <path d="M11 3v14M16 3v14" />
    </svg>
  ),
  /** A card with ticks behind it: a task template. */
  task: (
    <svg {...ICON} width={20} height={20}>
      <rect x="6" y="3" width="15" height="14" rx="2" />
      <path d="M3 7v11a3 3 0 0 0 3 3h11" />
      <path d="m9.5 10 2 2 4-4.5" />
    </svg>
  ),
  plus: (
    <svg {...ICON} width={16} height={16} strokeWidth={2.2}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  edit: (
    <svg {...ICON} width={15} height={15}>
      <path d="M4 20h4L19 9l-4-4L4 16z" />
      <path d="m13 7 4 4" />
    </svg>
  ),
  trash: (
    <svg {...ICON} width={15} height={15}>
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
    </svg>
  ),
  save: (
    <svg {...ICON} width={16} height={16}>
      <rect x="6" y="3" width="15" height="14" rx="2" />
      <path d="M3 7v11a3 3 0 0 0 3 3h11" />
      <path d="M13.5 7v6M10.5 10h6" />
    </svg>
  ),
};

/** A small rounded figure on a template card ("12 tasks"). */
export function Chip({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center rounded-full bg-ground px-2 py-0.5 text-xs font-medium text-ink-2">{children}</span>;
}

/**
 * A template on the Templates page: its kind's icon and name, a description, a few figures, who made
 * it, "Use template" and — for its maker and administrators — Edit and Delete in "⋯".
 */
export function TemplateCard({
  kind,
  name,
  description,
  chips,
  meta,
  onUse,
  useText = 'Use template',
  actions = [],
}: {
  kind: 'project' | 'task';
  name: string;
  description?: ReactNode;
  chips: ReactNode[];
  meta: ReactNode;
  onUse: () => void;
  useText?: string;
  actions?: ActionMenuItem[];
}) {
  return (
    <article className="card flex min-w-0 flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-brand/10 text-brand">{TemplateGlyph[kind]}</span>
        <div className="min-w-0 flex-1">
          <h3 dir="auto" className="break-words font-display text-base font-semibold leading-snug text-ink">{name}</h3>
          {description ? <p dir="auto" className="mt-0.5 line-clamp-2 text-sm text-ink-2">{description}</p> : null}
        </div>
        {actions.length ? <ActionMenu label={`More actions for ${name}`} items={actions} className="-me-1 -mt-1 flex-none" /> : null}
      </div>
      <div className="flex flex-wrap gap-1.5">{chips}</div>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
        <p className="min-w-0 text-xs text-ink-3">{meta}</p>
        {/* Its name starts with the words it shows (WCAG 2.5.3), then says which template. */}
        <Button size="sm" variant="secondary" onClick={onUse} aria-label={`${useText}: ${name}`} className="!min-h-[40px]">
          {useText}
        </Button>
      </div>
    </article>
  );
}

/** "12 tasks", "1 task". */
export const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
