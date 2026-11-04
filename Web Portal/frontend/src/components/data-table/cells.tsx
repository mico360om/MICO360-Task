import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { AnchoredPopover } from '../ui/AnchoredPopover';
import { Avatar } from '../ui/Avatar';
import { TOUCH_TALL } from '../../lib/touch';

/**
 * The Table view's quick-edit cells (1.23.0). A cell the person may change is a quiet control — words
 * that turn into a box, a chip with ▾ — and one they may not is plain words. Each hands its new value
 * to the table, which shows it at once and puts the old one back if the server refuses
 * (components/data-table/hooks useRowEdits).
 */

/** Words that are a control only on hover and focus (a title, a number of minutes). */
const QUIET =
  'max-w-full rounded-md px-1 -mx-1 text-start outline-none transition-colors hover:bg-ground focus-visible:bg-ground focus-visible:ring-2 focus-visible:ring-brand/40';
const BOX = 'w-full min-w-[8rem] rounded-md border border-brand bg-surface px-2 py-1 text-sm text-ink outline-none ring-2 ring-brand/20 [@media(pointer:coarse)]:min-h-11';

/** Esc in a cell's box closes only the box (not a dialog or panel around the page). */
function stop(e: KeyboardEvent) {
  e.stopPropagation();
}

/**
 * A title in place: a click (or Enter on it) makes it a box; Enter or leaving the box saves, Esc
 * puts it back, and an empty title is refused with `emptyMessage` beside it. For someone who may not
 * change it, the title opens the item (`onOpen`) or is just its words.
 */
export function TitleCell({
  value,
  what,
  editable,
  onSave,
  onOpen,
  openLabel,
  emptyMessage = 'It needs a title.',
  done = false,
  lead,
}: {
  value: string;
  /** What it is, for its names: "the title of MICO-12". */
  what: string;
  editable: boolean;
  onSave?: (next: string) => void;
  onOpen?: () => void;
  openLabel?: string;
  emptyMessage?: string;
  /** Finished: struck through and quieter. */
  done?: boolean;
  /** Before the words, outside the control (marks such as a milestone flag). */
  lead?: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [problem, setProblem] = useState<string | null>(null);
  const box = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const problemId = useId();
  const refocus = useRef(false);

  useEffect(() => {
    if (editing) {
      box.current?.focus();
      box.current?.select();
    }
  }, [editing]);
  useEffect(() => {
    if (!editing && refocus.current) {
      refocus.current = false;
      button.current?.focus();
    }
  }, [editing]);
  useEffect(() => {
    if (!problem || editing) return;
    const t = setTimeout(() => setProblem(null), 4000);
    return () => clearTimeout(t);
  }, [problem, editing]);

  const words = <span dir="auto" className={`break-words ${done ? 'text-ink-3 line-through' : 'text-ink'}`}>{value}</span>;

  if (!editable) {
    return (
      <span className="flex min-w-0 items-start gap-1.5">
        {lead}
        {onOpen ? (
          <button type="button" onClick={onOpen} aria-label={openLabel} className={`${QUIET} font-medium hover:text-brand ${TOUCH_TALL}`}>
            {words}
          </button>
        ) : (
          <span className="font-medium">{words}</span>
        )}
      </span>
    );
  }

  const finish = (save: boolean, viaKey: boolean) => {
    const next = draft.trim();
    if (save && next !== value.trim()) {
      if (!next) {
        if (viaKey) {
          setProblem(emptyMessage);
          return;
        }
        // Left empty: the old title stays, and why is said beside it.
        setProblem(emptyMessage);
        setDraft(value);
        setEditing(false);
        return;
      }
      onSave?.(next);
    }
    setProblem(null);
    refocus.current = viaKey;
    setEditing(false);
  };

  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="flex min-w-0 items-start gap-1.5">
        {lead}
        {editing ? (
          <input
            ref={box}
            dir="auto"
            aria-label={what.charAt(0).toUpperCase() + what.slice(1)}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? problemId : undefined}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                finish(true, true);
              } else if (e.key === 'Escape') {
                stop(e);
                setDraft(value);
                setProblem(null);
                refocus.current = true;
                setEditing(false);
              }
            }}
            onBlur={() => finish(true, false)}
            className={BOX}
          />
        ) : (
          <button
            ref={button}
            type="button"
            title="Click to change"
            aria-label={`Change ${what}: ${value}`}
            onClick={() => {
              setDraft(value);
              setEditing(true);
            }}
            className={`${QUIET} cursor-text font-medium ${TOUCH_TALL}`}
          >
            {words}
          </button>
        )}
      </span>
      {problem ? (
        <span id={problemId} role="alert" className="text-xs font-medium text-danger">
          {problem}
        </span>
      ) : null}
    </span>
  );
}

/** Planned minutes in place ("15 min"): a click makes it a number box; empty means none. */
export function MinutesCell({ value, what, editable, onSave }: { value: number | null; what: string; editable: boolean; onSave: (next: number | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const box = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (editing) {
      box.current?.focus();
      box.current?.select();
    } else if (refocus.current) {
      refocus.current = false;
      button.current?.focus();
    }
  }, [editing]);
  const text = value != null ? `${value} min` : '—';
  if (!editable) return <span className="whitespace-nowrap text-ink-2">{text}</span>;

  const finish = (save: boolean, viaKey: boolean) => {
    if (save) {
      const n = draft.trim() === '' ? null : Math.max(0, Math.min(600, Math.round(Number(draft))));
      if (n === null || Number.isFinite(n)) {
        if (n !== value) onSave(n);
      }
    }
    refocus.current = viaKey;
    setEditing(false);
  };
  return editing ? (
    <input
      ref={box}
      type="number"
      inputMode="numeric"
      min={0}
      max={600}
      aria-label={what.charAt(0).toUpperCase() + what.slice(1)}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          finish(true, true);
        } else if (e.key === 'Escape') {
          stop(e);
          finish(false, true);
        }
      }}
      onBlur={() => finish(true, false)}
      className={`${BOX} !min-w-[4.5rem] max-w-[6rem]`}
    />
  ) : (
    <button
      ref={button}
      type="button"
      title="Click to change"
      aria-label={`Change ${what}: ${value != null ? `${value} min` : 'none'}`}
      onClick={() => {
        setDraft(value != null ? String(value) : '');
        setEditing(true);
      }}
      className={`${QUIET} whitespace-nowrap text-ink-2 ${TOUCH_TALL}`}
    >
      {text}
    </button>
  );
}

export interface CellPerson {
  id: string;
  name: string;
  avatarUrl?: string | null;
}

/** Faces (and the name, for one person): who is on it. */
function Faces({ chosen }: { chosen: CellPerson[] }) {
  if (chosen.length === 0) return <span className="text-ink-3">Unassigned</span>;
  const names = chosen.map((p) => p.name).join(', ');
  if (chosen.length === 1) {
    const p = chosen[0]!;
    return (
      <span className="flex min-w-0 items-center gap-1.5">
        <span aria-hidden="true" className="flex">
          <Avatar name={p.name} src={p.avatarUrl} size="sm" />
        </span>
        <span dir="auto" className="truncate text-ink">{p.name}</span>
      </span>
    );
  }
  const shown = chosen.slice(0, 3);
  return (
    <span className="flex items-center" title={names}>
      <span aria-hidden="true" className="flex -space-x-1.5">
        {shown.map((p) => <Avatar key={p.id} name={p.name} src={p.avatarUrl} size="sm" />)}
        {chosen.length > 3 ? <span className="grid h-6 w-6 place-items-center rounded-full border border-line bg-ground text-[10px] font-semibold text-ink-2">+{chosen.length - 3}</span> : null}
      </span>
      <span className="sr-only">{names}</span>
    </span>
  );
}

/**
 * Several people in place (a task's assignees): the faces, and a list of the project's people to tick
 * on and off — each tick saved at once. `people` null: still on its way (`onActivate` asks for it).
 */
export function PeopleCell({
  what,
  chosen,
  editable,
  people,
  onActivate,
  onToggle,
}: {
  /** "MICO-12": the trigger is "People on MICO-12: …". */
  what: string;
  chosen: CellPerson[];
  editable: boolean;
  people: CellPerson[] | null;
  onActivate: () => void;
  onToggle: (person: CellPerson, on: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const headingId = useId();
  if (!editable) return <Faces chosen={chosen} />;
  const names = chosen.length ? chosen.map((p) => p.name).join(', ') : 'Unassigned';
  const ids = new Set(chosen.map((p) => p.id));
  // Someone on it who has since left the project's team stays in the list, to be taken off.
  const list = people ? [...people, ...chosen.filter((c) => !people.some((p) => p.id === c.id))] : null;
  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-label={`People on ${what}: ${names}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onPointerEnter={onActivate}
        onFocus={onActivate}
        onClick={() => {
          onActivate();
          setOpen((o) => !o);
        }}
        className={`${QUIET} inline-flex items-center gap-1 ${TOUCH_TALL}`}
      >
        <Faces chosen={chosen} />
        <span aria-hidden className="text-[10px] text-ink-3 opacity-0 transition-opacity group-hover/row:opacity-70 [@media(pointer:coarse)]:opacity-70">▾</span>
      </button>
      {open ? (
        <AnchoredPopover anchor={anchor} labelledBy={headingId} onClose={() => setOpen(false)} className="w-64 rounded-xl border border-line bg-surface p-2 shadow-lift">
          <p id={headingId} data-popover-heading tabIndex={-1} className="px-2 pb-1 pt-0.5 text-xs font-semibold uppercase tracking-wide text-ink-3 outline-none">
            People on {what}
          </p>
          {list === null ? (
            <p role="status" className="px-2 py-1.5 text-sm text-ink-2">Loading…</p>
          ) : list.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-ink-2">No one is on this project’s team.</p>
          ) : (
            <div className="max-h-64 overflow-y-auto">
              {list.map((p) => (
                <label key={p.id} className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-ink hover:bg-ground ${TOUCH_TALL}`}>
                  <input type="checkbox" data-popover-action checked={ids.has(p.id)} onChange={(e) => onToggle(p, e.target.checked)} className="h-4 w-4 accent-brand" />
                  <span aria-hidden="true" className="flex">
                    <Avatar name={p.name} src={p.avatarUrl} size="sm" />
                  </span>
                  <span dir="auto" className="truncate">{p.name}</span>
                </label>
              ))}
            </div>
          )}
        </AnchoredPopover>
      ) : null}
    </>
  );
}
