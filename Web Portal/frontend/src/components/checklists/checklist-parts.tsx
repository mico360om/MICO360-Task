import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Avatar } from '../ui/Avatar';
import { ComboPicker, type PickerOption } from '../task-drawer/combo-picker';
import { Sparkle } from '../task-drawer/properties';
import { failureMessage, useOwnEscape } from '../task-drawer/save-state';
import type { CLPerson } from '../../lib/checklist-tree';

/** 44px on a touch screen; compact with a mouse. */
export const ICON_BUTTON =
  'grid h-9 w-9 flex-none place-items-center rounded-lg text-ink-3 transition-colors hover:bg-ground hover:text-ink sm:h-8 sm:w-8 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11';

export const DotsIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
    <circle cx="5" cy="12" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="19" cy="12" r="1.8" />
  </svg>
);
export const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`transition-transform ${open ? '' : '-rotate-90 rtl:rotate-90'}`}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export interface MenuEntry {
  label: string;
  onSelect: () => void;
  danger?: boolean;
}

/**
 * A small "⋯" menu: the arrow keys move through it, Escape closes it back to its button (and only it,
 * not the panel or dialog around it), Tab or a press elsewhere closes it.
 */
export function ActionsMenu({ label, entries, className = '' }: { label: string; entries: MenuEntry[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useOwnEscape(
    wrap,
    () => {
      setOpen(false);
      trigger.current?.focus();
    },
    open,
  );
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  if (entries.length === 0) return null;
  const items = () => Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
  return (
    <div ref={wrap} className={`relative flex-none ${className}`}>
      <button ref={trigger} type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label={label} title={label} className={ICON_BUTTON}>
        <DotsIcon />
      </button>
      {open ? (
        <div
          ref={menu}
          role="menu"
          aria-label={label}
          onKeyDown={(e) => {
            const list = items();
            const at = list.indexOf(document.activeElement as HTMLElement);
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              const next = e.key === 'ArrowDown' ? (at + 1) % list.length : (at - 1 + list.length) % list.length;
              list[next]?.focus();
            } else if (e.key === 'Home' || e.key === 'End') {
              e.preventDefault();
              list[e.key === 'Home' ? 0 : list.length - 1]?.focus();
            } else if (e.key === 'Tab') {
              setOpen(false);
            }
          }}
          className="absolute end-0 top-full z-30 mt-1 w-48 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-lift animate-scale-in"
        >
          {entries.map((entry) => (
            <button
              key={entry.label}
              role="menuitem"
              type="button"
              tabIndex={-1}
              onClick={() => {
                setOpen(false);
                trigger.current?.focus();
                entry.onSelect();
              }}
              className={`flex w-full items-center px-3 py-2 text-start text-sm hover:bg-ground focus-visible:bg-ground focus-visible:outline-none sm:py-1.5 [@media(pointer:coarse)]:min-h-11 ${entry.danger ? 'text-danger' : 'text-ink'}`}
            >
              {entry.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const NONE = '__none__';

/** "Who is it for?": the task's team to pick from (typing narrows it), and "No one" when someone has it. */
export function AssignStrip({ text, people, current, onPick, onClose }: { text: string; people: CLPerson[]; current: string | null; onPick: (userId: string | null) => Promise<void>; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const q = query.trim().toLocaleLowerCase('en');
  const options: PickerOption[] = [
    ...(current && !q ? [{ id: NONE, label: 'No one' }] : []),
    ...people
      .filter((p) => !q || p.name.toLocaleLowerCase('en').includes(q))
      .map((p) => ({
        id: p.id,
        label: p.name,
        lead: (
          <span aria-hidden="true" className="contents">
            <Avatar name={p.name} src={p.avatarUrl ?? null} size="sm" />
          </span>
        ),
        trail: p.id === current ? <span className="text-xs text-ink-3">Now</span> : undefined,
      })),
  ];
  return (
    <div className="mt-1 rounded-lg border border-line bg-ground/50 p-2">
      <ComboPicker
        label={`Who is “${text}” for?`}
        placeholder="Type a name…"
        query={query}
        onQuery={setQuery}
        options={options}
        onPick={(id) => {
          setProblem(null);
          onPick(id === NONE ? null : id).catch((err: unknown) => setProblem(failureMessage(err, 'Couldn’t change who it’s for.')));
        }}
        emptyText="No one on the task’s team by that name."
        alwaysOpen
        inline
        autoFocus
        onClose={onClose}
      />
      {problem ? (
        <p role="alert" className="mt-1 text-xs font-medium text-danger">
          {problem}
        </p>
      ) : null}
      <button type="button" onClick={onClose} className="mt-1.5 h-9 rounded-lg px-2.5 text-xs font-medium text-ink-2 hover:bg-surface sm:h-8 [@media(pointer:coarse)]:h-11">
        Cancel
      </button>
    </div>
  );
}

/** An item's due date: a day, saved with Save (or Enter); "No due date" takes it off. */
export function DueStrip({ text, current, onSave, onClose }: { text: string; current: string | null; onSave: (day: string | null) => Promise<void>; onClose: () => void }) {
  const [value, setValue] = useState(current ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useOwnEscape(ref, onClose);
  useEffect(() => input.current?.focus(), []);
  async function save(day: string | null) {
    setSaving(true);
    setProblem(null);
    try {
      await onSave(day);
    } catch (err) {
      setProblem(failureMessage(err, 'Couldn’t save the due date.'));
    } finally {
      setSaving(false);
    }
  }
  return (
    <div ref={ref} role="group" aria-label={`Due date of “${text}”`} className="mt-1 flex flex-wrap items-center gap-1.5 rounded-lg border border-line bg-ground/50 p-2">
      <input
        ref={input}
        type="date"
        aria-label={`Due date for “${text}”`}
        value={value}
        disabled={saving}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            void save(value || null);
          }
        }}
        className="h-9 min-w-0 rounded-lg border border-line bg-surface px-2.5 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 [@media(pointer:coarse)]:h-11"
      />
      <button type="button" aria-label="Save the due date" disabled={saving} onClick={() => void save(value || null)} className="h-9 rounded-lg bg-brand px-3 text-xs font-semibold text-white hover:bg-brand-2 disabled:opacity-50 sm:h-8 [@media(pointer:coarse)]:h-11">
        Save
      </button>
      {current ? (
        <button type="button" disabled={saving} onClick={() => void save(null)} className="h-9 rounded-lg px-2.5 text-xs font-medium text-ink-2 hover:bg-surface sm:h-8 [@media(pointer:coarse)]:h-11">
          No due date
        </button>
      ) : null}
      <button type="button" onClick={onClose} className="h-9 rounded-lg px-2.5 text-xs font-medium text-ink-2 hover:bg-surface sm:h-8 [@media(pointer:coarse)]:h-11">
        Cancel
      </button>
      {problem ? (
        <p role="alert" className="basis-full text-xs font-medium text-danger">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

/** AI-suggested steps, all ticked to start with: the person decides which to add. */
export function SuggestionReview({ steps, onAdd, onDiscard }: { steps: string[]; onAdd: (chosen: string[]) => Promise<void>; onDiscard: () => void }) {
  const [chosen, setChosen] = useState<boolean[]>(() => steps.map(() => true));
  const [adding, setAdding] = useState(false);
  const picked = steps.filter((_, i) => chosen[i]);
  return (
    <div role="group" aria-label="Suggested steps" className="mb-2 rounded-xl border border-brand/30 bg-brand/5 p-3">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-brand">
        <Sparkle /> AI suggestions — choose which to add
      </p>
      <ul className="flex flex-col gap-1">
        {steps.map((step, i) => (
          <li key={`${i}-${step}`}>
            <label className="flex min-h-[36px] cursor-pointer items-center gap-2 rounded-md px-1 text-sm text-ink hover:bg-surface [@media(pointer:coarse)]:min-h-11">
              <input type="checkbox" checked={chosen[i] ?? false} onChange={() => setChosen((c) => c.map((v, j) => (j === i ? !v : v)))} className="h-4 w-4 flex-none accent-brand" />
              <span dir="auto">{step}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={picked.length === 0 || adding}
          onClick={async () => {
            setAdding(true);
            try {
              await onAdd(picked);
            } finally {
              setAdding(false);
            }
          }}
          className="h-9 rounded-lg bg-brand px-3 text-xs font-semibold text-white transition-colors hover:bg-brand-2 disabled:opacity-50 sm:h-8 [@media(pointer:coarse)]:h-11"
        >
          {adding ? 'Adding…' : `Add ${picked.length} ${picked.length === 1 ? 'step' : 'steps'}`}
        </button>
        <button type="button" onClick={onDiscard} disabled={adding} className="h-9 rounded-lg px-3 text-xs font-medium text-ink-2 hover:bg-surface sm:h-8 [@media(pointer:coarse)]:h-11">
          Discard
        </button>
      </div>
    </div>
  );
}

/** A thin bar and its words ("5/8"), the bar named for the checklist. */
export function ProgressBar({ label, done, total }: { label: string; done: number; total: number }): ReactNode {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-1.5 w-full overflow-hidden rounded-full bg-ground">
      <div className={`h-full rounded-full transition-all duration-500 ${pct === 100 ? 'bg-success' : 'bg-brand'}`} style={{ width: `${pct}%` }} />
    </div>
  );
}
