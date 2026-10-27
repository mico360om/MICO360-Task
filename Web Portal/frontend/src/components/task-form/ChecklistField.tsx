import { useId, useState, type KeyboardEvent } from 'react';

/** The server keeps up to 191 characters per checklist item, and up to 100 items. */
export const CHECKLIST_ITEM_MAX = 191;
export const CHECKLIST_MAX = 100;

/**
 * A checklist being written (a new task's, or a template's): its items, each editable and removable,
 * and a box to add more — Enter adds (and never submits the form); several lines pasted at once
 * become several items.
 */
export function ChecklistField({ items, onChange, disabled = false }: { items: string[]; onChange: (items: string[]) => void; disabled?: boolean }) {
  const [adding, setAdding] = useState('');
  const hintId = useId();
  const full = items.length >= CHECKLIST_MAX;

  function add(text: string) {
    const lines = text.split(/\r?\n/).map((l) => l.trim().slice(0, CHECKLIST_ITEM_MAX)).filter(Boolean);
    if (lines.length === 0) return;
    onChange([...items, ...lines].slice(0, CHECKLIST_MAX));
    setAdding('');
  }

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    add(adding);
  };

  return (
    <div className="flex flex-col gap-1.5">
      {items.length ? (
        <ol aria-label="Checklist items" className="flex flex-col gap-1.5">
          {items.map((text, i) => (
            <li key={i} className="flex items-center gap-2">
              <span aria-hidden="true" className="h-4 w-4 flex-none rounded border border-ink-3/60" />
              <input
                value={text}
                dir="auto"
                maxLength={CHECKLIST_ITEM_MAX}
                disabled={disabled}
                aria-label={`Checklist item ${i + 1}`}
                onChange={(e) => onChange(items.map((t, j) => (j === i ? e.target.value : t)))}
                onBlur={(e) => {
                  if (!e.target.value.trim()) onChange(items.filter((_, j) => j !== i));
                }}
                className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-sm text-ink outline-none transition-colors hover:border-line focus:border-brand focus:ring-2 focus:ring-brand/20"
              />
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(items.filter((_, j) => j !== i))}
                aria-label={`Remove “${text || `item ${i + 1}`}” from the checklist`}
                className="grid h-9 w-9 flex-none place-items-center rounded-lg text-ink-3 transition-colors hover:bg-danger-soft hover:text-danger disabled:opacity-40"
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </li>
          ))}
        </ol>
      ) : null}
      <div className="flex items-center gap-2">
        <input
          value={adding}
          dir="auto"
          disabled={disabled || full}
          maxLength={CHECKLIST_ITEM_MAX * 20}
          aria-label="Add a checklist item"
          aria-describedby={hintId}
          placeholder={full ? `A checklist holds up to ${CHECKLIST_MAX} items` : 'Add an item and press Enter'}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={onKey}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData('text');
            if (!/\n/.test(pasted)) return;
            e.preventDefault();
            add(`${adding}${pasted}`);
          }}
          className="min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
        <button
          type="button"
          onClick={() => add(adding)}
          disabled={disabled || full || !adding.trim()}
          className="!min-h-[40px] flex-none rounded-xl border border-line px-3 text-sm font-semibold text-ink transition-colors hover:border-brand hover:text-brand disabled:opacity-40"
        >
          Add
        </button>
      </div>
      <p id={hintId} className="sr-only">Press Enter to add it. Pasting several lines adds one item per line.</p>
    </div>
  );
}
