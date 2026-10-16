import { useEffect, useRef, useState } from 'react';
import { SaveIndicator, useOwnEscape, useSaveState } from './save-state';

/** The task title column's limit (VARCHAR 191) — enforced here so a save can't be rejected for it. */
export const TITLE_MAX = 191;

export const PencilIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
  </svg>
);

/**
 * The task title, editable in place: click it (or the pencil), then Enter or leaving the box saves
 * and Escape drops the edit. A failed save keeps the text and shows why.
 */
export function InlineTitle({ title, onSave }: { title: string; onSave?: (title: string) => Promise<void> | void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const save = useSaveState();
  const inputRef = useRef<HTMLInputElement>(null);
  // Whether an edit is open — cleared at once when it is dropped or saved, so the blur that follows
  // (the box going away) doesn't save it again.
  const active = useRef(false);
  const editing = draft !== null;
  useOwnEscape(inputRef, () => {
    active.current = false;
    setDraft(null);
    save.reset();
  }, editing);

  useEffect(() => {
    if (!editing) return;
    active.current = true;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  async function commit() {
    if (draft === null || !active.current || save.busy) return;
    const next = draft.trim();
    if (!next) {
      save.fail('A title is required.');
      return;
    }
    if (next === title) {
      active.current = false;
      setDraft(null);
      save.reset();
      return;
    }
    if (await save.run(() => onSave?.(next))) {
      active.current = false;
      setDraft(null);
    }
  }

  if (draft !== null) {
    return (
      <div>
        <input
          ref={inputRef}
          aria-label="Title"
          dir="auto"
          maxLength={TITLE_MAX}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || ((e.ctrlKey || e.metaKey) && e.code === 'KeyS')) {
              e.preventDefault();
              void commit();
            }
          }}
          onBlur={() => void commit()}
          aria-invalid={save.state.status === 'error' || undefined}
          className="w-full rounded-lg border border-brand bg-surface px-2 py-1 font-display text-lg font-bold leading-snug text-ink outline-none ring-2 ring-brand/20 sm:text-xl"
        />
        <div className="mt-1 flex items-center gap-2 text-[11px] text-ink-3">
          <SaveIndicator state={save.state} />
          {save.state.status !== 'saving' ? <span className="hidden sm:inline">Enter to save · Esc to cancel</span> : null}
        </div>
      </div>
    );
  }
  return (
    <div>
      <div className="group flex items-start gap-1.5">
        <h2
          dir="auto"
          onClick={onSave ? () => setDraft(title) : undefined}
          className={`min-w-0 flex-1 break-words text-start font-display text-lg font-bold leading-snug text-ink sm:text-xl ${onSave ? 'cursor-text' : ''}`}
        >
          {title}
        </h2>
        {onSave ? (
          <button
            type="button"
            onClick={() => setDraft(title)}
            aria-label="Edit title"
            title="Edit title"
            className="mt-0.5 grid h-8 w-8 flex-none place-items-center rounded-lg text-ink-3 transition-colors hover:bg-ground hover:text-brand sm:h-7 sm:w-7 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
          >
            <PencilIcon />
          </button>
        ) : null}
      </div>
      <SaveIndicator state={save.state} />
    </div>
  );
}

/**
 * The description, editable in place: Save (or Ctrl+Enter) saves, Cancel (or Escape) drops the
 * edit. Empty, it offers to add one.
 */
export function InlineDescription({ description, onSave }: { description: string | null; onSave?: (description: string) => Promise<void> | void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const save = useSaveState();
  const boxRef = useRef<HTMLTextAreaElement>(null);
  useOwnEscape(boxRef, () => {
    setDraft(null);
    save.reset();
  }, draft !== null);

  useEffect(() => {
    const box = boxRef.current;
    if (draft === null || !box) return;
    // Grow with the text, up to a limit (then it scrolls).
    box.style.height = 'auto';
    box.style.height = `${Math.min(box.scrollHeight, 320)}px`;
  }, [draft]);

  async function commit() {
    if (draft === null || save.busy) return;
    if (draft.trim() === (description ?? '').trim()) {
      setDraft(null);
      return;
    }
    if (await save.run(() => onSave?.(draft.trim()))) setDraft(null);
  }

  if (draft !== null) {
    return (
      <div className="flex flex-col gap-2">
        <textarea
          ref={boxRef}
          aria-label="Description"
          dir="auto"
          autoFocus
          rows={4}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.code === 'KeyS') && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void commit();
            }
          }}
          placeholder="What needs doing, and how will we know it’s done?"
          className="min-h-[96px] w-full resize-y rounded-lg border border-brand bg-surface px-3 py-2 text-sm leading-relaxed text-ink outline-none ring-2 ring-brand/20"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void commit()}
            disabled={save.busy}
            aria-label="Save description"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3.5 text-xs font-semibold text-white transition-colors hover:bg-brand-2 disabled:opacity-60 sm:h-8"
          >
            {save.busy ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(null);
              save.reset();
            }}
            disabled={save.busy}
            className="h-9 rounded-lg px-3 text-xs font-medium text-ink-2 transition-colors hover:bg-ground disabled:opacity-60 sm:h-8"
          >
            Cancel
          </button>
          <span className="hidden text-[11px] text-ink-3 sm:inline">Ctrl+Enter to save · Esc to cancel</span>
        </div>
        <SaveIndicator state={save.state} />
      </div>
    );
  }
  if (!description) {
    return (
      <div>
        {onSave ? (
          <button
            type="button"
            onClick={() => setDraft('')}
            className="flex min-h-[44px] w-full items-center gap-2 rounded-lg border border-dashed border-line px-3 text-start text-sm text-ink-3 transition-colors hover:border-brand hover:text-brand"
          >
            <PencilIcon />
            Add a description
          </button>
        ) : (
          <p className="text-sm italic text-ink-3">No description.</p>
        )}
        <SaveIndicator state={save.state} />
      </div>
    );
  }
  return (
    <div className="group relative">
      <p dir="auto" className="whitespace-pre-wrap break-words pe-9 text-start text-sm leading-relaxed text-ink-2">
        {description}
      </p>
      {onSave ? (
        <button
          type="button"
          onClick={() => setDraft(description)}
          aria-label="Edit description"
          title="Edit description"
          className="absolute end-0 top-0 grid h-8 w-8 place-items-center rounded-lg text-ink-3 transition-colors hover:bg-ground hover:text-brand sm:h-7 sm:w-7 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
        >
          <PencilIcon />
        </button>
      ) : null}
      <SaveIndicator state={save.state} />
    </div>
  );
}
