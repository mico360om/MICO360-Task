import { useId, useRef, useState } from 'react';
import type { TaskCategoryChip } from '../../api/categories';
import { CATEGORY_WORDS, needsCategory } from '../../lib/task-categories';
import { TOUCH_TALL } from '../../lib/touch';
import { CategoryChip } from '../CategoryChip';
import { CategoryPicker, type PickableCategory } from '../task-form/category-picker';
import { PencilIcon } from './inline-text';
import { SaveIndicator, useSaveState, useOwnEscape } from './save-state';

/**
 * 1.24 The task panel's "Categories": the task's categories as chips in their colours, and — for
 * whoever may edit the task — Edit, a multi-pick from the project's list saved in one go (the server's
 * refusal is shown). A project that asks every task for a category marks a task without one "Needs a
 * category".
 */
export function CategoriesBox({
  categories,
  choices,
  requireCategory = false,
  onSave,
}: {
  categories: TaskCategoryChip[];
  /** The project's categories (retired ones too); null/absent while they load. */
  choices?: PickableCategory[] | null;
  requireCategory?: boolean;
  /** Give the task exactly these categories; rejects with the reason to show. */
  onSave?: (ids: string[]) => Promise<void> | void;
}) {
  const headingId = useId();
  const problemId = useId();
  const save = useSaveState();
  const [editing, setEditing] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const current = categories.map((c) => c.id);
  const changed = editing && JSON.stringify(picked) !== JSON.stringify(current);
  const needs = needsCategory({ categories }, { requireCategory });
  // A category the task has that the list doesn't (not loaded, or gone) can still be taken off.
  const list = choices ?? [];
  const pickable: PickableCategory[] = [...list, ...categories.filter((c) => !list.some((x) => x.id === c.id)).map((c, i) => ({ ...c, position: 10_000 + i }))];
  const kept = categories.filter((c) => c.retired).map((c) => c.id);

  const close = () => {
    setEditing(false);
    setProblem(null);
    setTimeout(() => editRef.current?.focus(), 0);
  };
  useOwnEscape(editorRef, () => {
    if (!save.busy) close();
  }, editing);
  async function apply() {
    if (!onSave || save.busy) return;
    if (requireCategory && picked.length === 0) {
      setProblem(CATEGORY_WORDS.pickOne);
      return;
    }
    if (!changed) {
      close();
      return;
    }
    if (await save.run(() => onSave(picked))) close();
  }

  return (
    <section aria-labelledby={headingId} className="rounded-xl border border-line p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 id={headingId} className="eyebrow">
          {CATEGORY_WORDS.heading}
        </h3>
        {onSave && choices && !editing ? (
          <button
            ref={editRef}
            type="button"
            onClick={() => {
              setPicked(current);
              setProblem(null);
              save.reset();
              setEditing(true);
            }}
            aria-label="Edit categories"
            title="Edit categories"
            className={`inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-brand transition-colors hover:bg-brand/10 ${TOUCH_TALL}`}
          >
            <PencilIcon />
            <span aria-hidden="true">Edit</span>
          </button>
        ) : null}
      </div>
      {editing ? (
        <div ref={editorRef} data-unsaved={changed || undefined} className="mt-2">
          <CategoryPicker
            categories={pickable}
            value={picked}
            kept={kept}
            onChange={(ids) => {
              setPicked(ids);
              setProblem(null);
            }}
            required={requireCategory}
            invalid={!!problem}
            describedBy={problem ? problemId : undefined}
            disabled={save.busy}
          />
          {problem ? (
            <p id={problemId} role="alert" className="mt-1.5 text-xs font-medium text-danger">
              {problem}
            </p>
          ) : null}
          <div className="mt-2.5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void apply()}
              disabled={save.busy}
              className={`h-8 rounded-lg bg-brand px-3 text-xs font-semibold text-white transition-colors hover:brightness-95 disabled:opacity-60 ${TOUCH_TALL}`}
            >
              Save
            </button>
            <button
              type="button"
              onClick={close}
              disabled={save.busy}
              className={`h-8 rounded-lg px-3 text-xs font-medium text-ink-2 transition-colors hover:bg-ground disabled:opacity-60 ${TOUCH_TALL}`}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : categories.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {categories.map((c) => (
            <CategoryChip key={c.id} category={c} />
          ))}
        </div>
      ) : needs ? (
        <p className="mt-2 inline-flex items-center gap-1 rounded-md bg-warning-soft px-1.5 py-0.5 text-xs font-semibold text-warning">{CATEGORY_WORDS.needs}</p>
      ) : (
        <p className="mt-2 text-sm text-ink-3">{CATEGORY_WORDS.noneOnTask}</p>
      )}
      <SaveIndicator state={save.state} />
    </section>
  );
}
