import { useId, type KeyboardEvent } from 'react';

/** The server keeps up to 191 characters per checklist item, and up to 100 items. */
export const CHECKLIST_ITEM_MAX = 191;
export const CHECKLIST_MAX = 100;

/** One checklist item being written. `id` is the row's own (stable) key, never sent anywhere. */
export interface ChecklistRow {
  id: string;
  text: string;
}

let rowSeq = 0;
export const newChecklistRow = (text: string): ChecklistRow => ({ id: `cl-${++rowSeq}`, text });
/** Rows for a list of item texts (a template's checklist). */
export const checklistRows = (texts: string[]): ChecklistRow[] => texts.map(newChecklistRow);

/** The items in some typed text: one per line, trimmed, empty lines left out. */
const linesOf = (text: string) => text.split(/\r?\n/).map((l) => l.trim().slice(0, CHECKLIST_ITEM_MAX)).filter(Boolean);

/**
 * The checklist as it is saved: its items' text, then whatever was typed in "Add an item" and not
 * added yet — so pressing Create (or Ctrl+Enter) never loses it.
 */
export function checklistTexts(rows: ChecklistRow[], pending = ''): string[] {
  return [...rows.map((r) => r.text.trim()).filter(Boolean), ...linesOf(pending)].slice(0, CHECKLIST_MAX);
}

/**
 * A checklist being written (a new task's, or a template's task's): its items, each editable and
 * removable, and a box to add more. Enter adds the typed item and never submits the form; Ctrl+Enter
 * is left to submit it (with the typed text: see checklistTexts). Leaving the box adds what was typed,
 * and several lines pasted at once become several items. The typed text lives with the form (`pending`),
 * so the form counts it as a change. Items have stable keys: ✕ always removes its own item, even when
 * an emptied item (which goes when it loses focus) disappears at the same moment.
 */
export function ChecklistField({
  rows,
  onChange,
  pending,
  onPendingChange,
  disabled = false,
}: {
  rows: ChecklistRow[];
  onChange: (rows: ChecklistRow[]) => void;
  pending: string;
  onPendingChange: (text: string) => void;
  disabled?: boolean;
}) {
  const hintId = useId();
  const full = rows.length >= CHECKLIST_MAX;

  function add(text: string) {
    const lines = linesOf(text);
    if (lines.length) onChange([...rows, ...lines.map(newChecklistRow)].slice(0, CHECKLIST_MAX));
    onPendingChange('');
  }

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || e.ctrlKey || e.metaKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    add(pending);
  };

  return (
    <div className="flex flex-col gap-1.5">
      {rows.length ? (
        <ol aria-label="Checklist items" className="flex flex-col gap-1.5">
          {rows.map((row, i) => (
            <li key={row.id} className="flex items-center gap-2">
              <span aria-hidden="true" className="h-4 w-4 flex-none rounded border border-ink-3/60" />
              <input
                value={row.text}
                dir="auto"
                maxLength={CHECKLIST_ITEM_MAX}
                disabled={disabled}
                aria-label={`Checklist item ${i + 1}`}
                onChange={(e) => onChange(rows.map((r) => (r.id === row.id ? { ...r, text: e.target.value } : r)))}
                onKeyDown={(e) => {
                  // Enter here changes nothing; it must not submit the form half-way through an edit.
                  if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) e.preventDefault();
                }}
                onBlur={(e) => {
                  if (!e.target.value.trim()) onChange(rows.filter((r) => r.id !== row.id));
                }}
                className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-sm text-ink outline-none transition-colors hover:border-line focus:border-brand focus:ring-2 focus:ring-brand/20"
              />
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(rows.filter((r) => r.id !== row.id))}
                aria-label={`Remove “${row.text || `item ${i + 1}`}” from the checklist`}
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
          value={pending}
          dir="auto"
          disabled={disabled || full}
          maxLength={CHECKLIST_ITEM_MAX * 20}
          aria-label="Add a checklist item"
          aria-describedby={hintId}
          placeholder={full ? `A checklist holds up to ${CHECKLIST_MAX} items` : 'Add an item and press Enter'}
          onChange={(e) => onPendingChange(e.target.value)}
          onKeyDown={onKey}
          onBlur={() => {
            if (pending.trim()) add(pending);
          }}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData('text');
            if (!/\n/.test(pasted)) return;
            e.preventDefault();
            add(`${pending}${pasted}`);
          }}
          className="min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
        <button
          type="button"
          onClick={() => add(pending)}
          disabled={disabled || full || !pending.trim()}
          className="!min-h-[40px] flex-none rounded-xl border border-line px-3 text-sm font-semibold text-ink transition-colors hover:border-brand hover:text-brand disabled:opacity-40"
        >
          Add
        </button>
      </div>
      <p id={hintId} className="sr-only">Press Enter to add it. Pasting several lines adds one item per line.</p>
    </div>
  );
}
