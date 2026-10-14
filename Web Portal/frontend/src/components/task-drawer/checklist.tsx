import { useEffect, useRef, useState } from 'react';
import { moveItem } from '../../lib/list-order';
import { Sparkle } from './properties';
import { PencilIcon } from './inline-text';
import { failureMessage, useOwnEscape } from './save-state';

export interface DrawerChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

const iconButton =
  'grid h-9 w-9 flex-none place-items-center rounded-lg text-ink-3 transition-colors hover:bg-ground sm:h-7 sm:w-7';

/** One item's text, editable in place (Enter or leaving the box saves, Escape drops the edit). */
function ItemText({ item, onRename }: { item: DrawerChecklistItem; onRename?: (text: string) => Promise<void> | void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const active = useRef(false);
  const editing = draft !== null;
  useOwnEscape(inputRef, () => {
    active.current = false;
    setDraft(null);
    setProblem(null);
  }, editing);
  useEffect(() => {
    if (!editing) return;
    active.current = true;
    inputRef.current?.focus();
  }, [editing]);

  async function commit() {
    if (draft === null || !active.current) return;
    const text = draft.trim();
    if (!text || text === item.text) {
      active.current = false;
      setDraft(null);
      return;
    }
    try {
      await onRename?.(text);
      active.current = false;
      setDraft(null);
      setProblem(null);
    } catch (err) {
      setProblem(failureMessage(err));
    }
  }

  if (draft !== null) {
    return (
      <div className="min-w-0 flex-1">
        <input
          ref={inputRef}
          aria-label="Checklist item"
          dir="auto"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void commit();
            }
          }}
          onBlur={() => void commit()}
          className="h-9 w-full rounded-md border border-brand bg-surface px-2 text-sm text-ink outline-none ring-2 ring-brand/20 sm:h-8"
        />
        {problem ? (
          <p role="alert" className="mt-1 text-xs text-danger">
            {problem}
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <>
      <span dir="auto" className={`min-w-0 flex-1 break-words text-start text-sm ${item.done ? 'text-ink-3 line-through' : 'text-ink'}`}>
        {item.text}
      </span>
      {onRename ? (
        <button type="button" onClick={() => setDraft(item.text)} aria-label={`Edit “${item.text}”`} title="Edit" className={`${iconButton} hover:text-brand sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100`}>
          <PencilIcon />
        </button>
      ) : null}
    </>
  );
}

/** AI-suggested steps, all ticked to start with: the user decides which to add. */
function SuggestionReview({ steps, onAdd, onDiscard }: { steps: string[]; onAdd: (chosen: string[]) => Promise<void>; onDiscard: () => void }) {
  const [chosen, setChosen] = useState<boolean[]>(() => steps.map(() => true));
  const [adding, setAdding] = useState(false);
  const picked = steps.filter((_, i) => chosen[i]);
  return (
    <div role="group" aria-label="Suggested steps" className="mt-2 rounded-xl border border-brand/30 bg-brand/5 p-3">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-brand">
        <Sparkle /> AI suggestions — choose which to add
      </p>
      <ul className="flex flex-col gap-1">
        {steps.map((step, i) => (
          <li key={`${i}-${step}`}>
            <label className="flex min-h-[36px] cursor-pointer items-center gap-2 rounded-md px-1 text-sm text-ink hover:bg-surface">
              <input
                type="checkbox"
                checked={chosen[i] ?? false}
                onChange={() => setChosen((c) => c.map((v, j) => (j === i ? !v : v)))}
                className="h-4 w-4 flex-none accent-brand"
              />
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
          className="h-9 rounded-lg bg-brand px-3 text-xs font-semibold text-white transition-colors hover:bg-brand-2 disabled:opacity-50 sm:h-8"
        >
          {adding ? 'Adding…' : `Add ${picked.length} ${picked.length === 1 ? 'step' : 'steps'}`}
        </button>
        <button type="button" onClick={onDiscard} disabled={adding} className="h-9 rounded-lg px-3 text-xs font-medium text-ink-2 hover:bg-surface sm:h-8">
          Discard
        </button>
      </div>
    </div>
  );
}

/**
 * The checklist: progress, ticking items off, adding (Enter keeps the box ready; pasted lines become
 * separate items), editing, reordering (drag, or ↑/↓ on an item's handle) and AI-suggested steps
 * that are reviewed before any is added.
 */
export function ChecklistSection({
  items,
  onToggle,
  onAdd,
  onRename,
  onRemove,
  onReorder,
  onSuggest,
}: {
  items: DrawerChecklistItem[];
  onToggle?: (id: string, done: boolean) => Promise<void> | void;
  onAdd?: (text: string) => Promise<void> | void;
  onRename?: (id: string, text: string) => Promise<void> | void;
  onRemove?: (id: string) => void;
  onReorder?: (orderedIds: string[]) => Promise<void> | void;
  onSuggest?: () => Promise<string[] | void>;
}) {
  // The order and ticks shown: the server's, until a change is waiting to be saved — so a tick or a
  // move shows at once instead of after the round trip.
  const [order, setOrder] = useState<string[] | null>(null);
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  useEffect(() => {
    setOrder(null);
    setTicks({});
  }, [items]);
  const withTicks = items.map((i) => (i.id in ticks ? { ...i, done: ticks[i.id]! } : i));
  const byId = new Map(withTicks.map((i) => [i.id, i]));
  const shown = order ? order.map((id) => byId.get(id)).filter((i): i is DrawerChecklistItem => Boolean(i)) : withTicks;
  const done = withTicks.filter((i) => i.done).length;
  const pct = items.length ? Math.round((done / items.length) * 100) : 0;

  const [newItem, setNewItem] = useState('');
  const [adding, setAdding] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [moved, setMoved] = useState('');
  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const dragging = useRef<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const addRef = useRef<HTMLInputElement>(null);

  async function addAll(texts: string[]) {
    if (!onAdd) return;
    setProblem(null);
    for (const text of texts) {
      try {
        await onAdd(text);
      } catch (err) {
        setProblem(failureMessage(err, 'Couldn’t add the item.'));
        return false;
      }
    }
    return true;
  }
  async function addTyped() {
    const text = newItem.trim();
    if (!text || adding) return;
    setAdding(true);
    if (await addAll([text])) setNewItem('');
    setAdding(false);
    addRef.current?.focus();
  }
  async function reorder(ids: string[], announce?: string) {
    if (!onReorder) return;
    setOrder(ids);
    if (announce) setMoved(announce);
    try {
      await onReorder(ids);
    } catch (err) {
      setOrder(null);
      setProblem(failureMessage(err, 'Couldn’t reorder the checklist.'));
    }
  }
  function moveBy(id: string, delta: number) {
    const ids = shown.map((i) => i.id);
    const from = ids.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    const item = byId.get(id);
    void reorder(moveItem(ids, from, to), `“${item?.text ?? ''}” moved to position ${to + 1} of ${ids.length}.`);
  }
  async function suggest() {
    if (!onSuggest || suggesting) return;
    setSuggesting(true);
    setProblem(null);
    try {
      const steps = (await onSuggest()) ?? [];
      if (steps.length === 0) setProblem('The AI had no steps to suggest for this task.');
      else setSuggestions(steps);
    } catch (err) {
      setProblem(failureMessage(err, 'The AI suggestion failed.'));
    } finally {
      setSuggesting(false);
    }
  }

  return (
    <section aria-labelledby="task-checklist-heading">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 id="task-checklist-heading" className="eyebrow">
          Checklist
        </h3>
        {items.length > 0 ? <span className="text-xs font-medium text-ink-2">{`${done} of ${items.length} done`}</span> : null}
        {onSuggest && onAdd ? (
          <button
            type="button"
            onClick={() => void suggest()}
            disabled={suggesting}
            title="Let AI break this task into steps — you review them before any are added"
            className="ms-auto inline-flex h-9 items-center gap-1.5 rounded-lg border border-brand/30 bg-brand/5 px-2.5 text-xs font-semibold text-brand transition-colors hover:border-brand disabled:opacity-60 sm:h-8"
          >
            {suggesting ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-brand/30 border-t-brand" aria-hidden /> : <Sparkle />}
            {suggesting ? 'Thinking…' : 'Suggest steps'}
            <span className="rounded bg-brand px-1 py-px text-[9px] font-bold uppercase tracking-wide text-white">AI</span>
          </button>
        ) : null}
      </div>
      {items.length > 0 ? (
        <div className="mb-2 flex items-center gap-2">
          <div role="progressbar" aria-label="Checklist progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-1.5 flex-1 overflow-hidden rounded-full bg-ground">
            <div className={`h-full rounded-full transition-all duration-500 ${pct === 100 ? 'bg-success' : 'bg-brand'}`} style={{ width: `${pct}%` }} />
          </div>
          <span className="w-9 text-end text-xs font-semibold tabular-nums text-ink-2">{pct}%</span>
        </div>
      ) : null}
      {problem ? (
        <p role="alert" className="mb-2 rounded-md bg-danger-soft px-2.5 py-1.5 text-xs text-danger">
          {problem}
        </p>
      ) : null}
      {suggestions ? (
        <SuggestionReview
          steps={suggestions}
          onDiscard={() => setSuggestions(null)}
          onAdd={async (chosen) => {
            if (await addAll(chosen)) setSuggestions(null);
          }}
        />
      ) : null}
      <span aria-live="polite" className="sr-only">
        {moved}
      </span>
      {shown.length === 0 ? (
        <p className="py-1 text-sm text-ink-3">{onAdd ? 'No steps yet — break the work down below.' : 'No checklist items.'}</p>
      ) : (
        <ul className="flex flex-col">
          {shown.map((c) => (
            <li
              key={c.id}
              data-testid="checklist-item"
              draggable={Boolean(onReorder)}
              onDragStart={(e) => {
                dragging.current = c.id;
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', c.id);
              }}
              onDragOver={(e) => {
                if (!dragging.current) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                setDropTarget(c.id);
              }}
              onDragLeave={() => setDropTarget((t) => (t === c.id ? null : t))}
              onDrop={(e) => {
                e.preventDefault();
                const from = dragging.current;
                dragging.current = null;
                setDropTarget(null);
                if (!from || from === c.id) return;
                const ids = shown.map((i) => i.id);
                void reorder(moveItem(ids, ids.indexOf(from), ids.indexOf(c.id)));
              }}
              onDragEnd={() => {
                dragging.current = null;
                setDropTarget(null);
              }}
              className={`group flex items-center gap-1 rounded-lg px-1 transition-colors hover:bg-ground/70 ${dropTarget === c.id ? 'ring-2 ring-brand/40' : ''}`}
            >
              {onReorder ? (
                <button
                  type="button"
                  aria-label={`Reorder “${c.text}”`}
                  title="Drag, or use ↑ / ↓, to reorder"
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                      e.preventDefault();
                      moveBy(c.id, e.key === 'ArrowUp' ? -1 : 1);
                    }
                  }}
                  className={`${iconButton} cursor-grab text-ink-3 active:cursor-grabbing sm:opacity-40 sm:group-hover:opacity-100 sm:focus-visible:opacity-100`}
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
                    <circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" />
                  </svg>
                </button>
              ) : null}
              {onToggle ? (
                <label className="grid h-10 w-9 flex-none cursor-pointer place-items-center sm:h-9">
                  <input
                    type="checkbox"
                    checked={c.done}
                    aria-label={c.text}
                    onChange={() => {
                      const next = !c.done;
                      setTicks((t) => ({ ...t, [c.id]: next }));
                      setProblem(null);
                      Promise.resolve(onToggle(c.id, next)).catch((err) => {
                        // Not saved: put the tick back as it was.
                        setTicks((t) => Object.fromEntries(Object.entries(t).filter(([id]) => id !== c.id)));
                        setProblem(failureMessage(err, 'Couldn’t update the checklist.'));
                      });
                    }}
                    className="h-[18px] w-[18px] accent-brand"
                  />
                </label>
              ) : (
                <span aria-hidden="true" className="grid h-9 w-8 flex-none place-items-center text-ink-3">
                  {c.done ? '☑' : '☐'}
                </span>
              )}
              <ItemText item={c} onRename={onRename ? (text) => onRename(c.id, text) : undefined} />
              {onRemove ? (
                <button
                  type="button"
                  onClick={() => onRemove(c.id)}
                  aria-label={`Remove “${c.text}” from the checklist`}
                  title="Remove"
                  className={`${iconButton} hover:text-danger sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100`}
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {onAdd ? (
        <form
          className="mt-2 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void addTyped();
          }}
        >
          <input
            ref={addRef}
            dir="auto"
            aria-label="Add a checklist item"
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            onPaste={(e) => {
              const lines = e.clipboardData
                .getData('text')
                .split(/\r?\n/)
                .map((l) => l.trim())
                .filter(Boolean);
              if (lines.length < 2) return;
              // Several lines: one item each.
              e.preventDefault();
              void addAll(lines);
            }}
            placeholder="Add an item…"
            className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-sm text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-brand focus:ring-2 focus:ring-brand/20 sm:h-9"
          />
          <button
            type="submit"
            disabled={newItem.trim() === '' || adding}
            className="h-10 rounded-lg border border-line px-3 text-xs font-semibold text-brand transition-colors hover:border-brand disabled:opacity-50 sm:h-9"
          >
            Add item
          </button>
        </form>
      ) : null}
    </section>
  );
}
