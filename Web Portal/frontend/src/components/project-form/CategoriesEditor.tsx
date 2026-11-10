import { useEffect, useId, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { categoriesApi, type ApiCategory, type ProjectCategories } from '../../api/categories';
import { ApiError } from '../../lib/api-client';
import { CATEGORY_NAME_MAX, CATEGORY_TONES, CATEGORY_WORDS, categoryTones, checkCategoryName, nextCategoryColor } from '../../lib/task-categories';
import { TOUCH_SQUARE, TOUCH_TALL } from '../../lib/touch';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { categoryStyle } from '../CategoryChip';
import { CategoryColourPicker } from '../categories/CategoryColourPicker';
import { useOwnEscape } from '../task-drawer/save-state';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Toggle } from '../ui/Toggle';

/** A project's categories (every part of the site reads them under this key). */
export const categoriesKey = (projectId: string) => ['categories', projectId] as const;

/** Below 768px: the section starts folded, so the rest of the window stays in reach on a phone. */
const PHONE_QUERY = '(max-width: 47.9375em)';
const SAVED_AT_ONCE = 'Changes to categories save straight away.';
const ROW_BUTTON = `rounded-lg border border-line px-2 py-1 text-xs font-medium text-ink-2 transition-colors hover:border-brand/30 hover:bg-ground hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 ${TOUCH_TALL}`;
const ICON_BUTTON = `grid h-7 w-7 place-items-center rounded-lg border border-line text-ink-2 transition-colors hover:border-brand/30 hover:bg-ground hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 ${TOUCH_SQUARE}`;
const BOX = `w-full rounded-lg border bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:ring-2 ${TOUCH_TALL}`;
const box = (bad: boolean) => `${BOX} ${bad ? 'border-danger focus:ring-danger/20' : 'border-line focus:border-brand focus:ring-brand/20'}`;

const isData = (d: unknown): d is ProjectCategories => !!d && typeof d === 'object' && Array.isArray((d as ProjectCategories).categories);

/** The server's words for a refused change (409 duplicate name → the shared words), else a plain retry line. */
function problemOf(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'CATEGORY_DUPLICATE') return CATEGORY_WORDS.duplicate;
    if (err.code === 'CATEGORY_IN_USE') return CATEGORY_WORDS.inUse;
    if (err.status >= 400 && err.status < 500 && err.message && !/^Request failed/.test(err.message)) return err.message;
  }
  if (err instanceof TypeError) return 'The server couldn’t be reached. Please try again.';
  return 'Couldn’t save that. Please try again.';
}

const tasksText = (n: number) => (n <= 0 ? 'No tasks' : `On ${n} ${n === 1 ? 'task' : 'tasks'}`);

const ARROW = (up: boolean) => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={up ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} />
  </svg>
);
const GRIP = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
    <circle cx="9" cy="6" r="1.4" />
    <circle cx="15" cy="6" r="1.4" />
    <circle cx="9" cy="12" r="1.4" />
    <circle cx="15" cy="12" r="1.4" />
    <circle cx="9" cy="18" r="1.4" />
    <circle cx="15" cy="18" r="1.4" />
  </svg>
);

/** The swatch: the category's colour as a small square (a status is a round dot), its name for screen readers. */
function Swatch({ color }: { color: string }) {
  return (
    <>
      <span aria-hidden="true" style={categoryStyle(color)} className="cat-swatch h-3 w-3 flex-none rounded-[3px]" />
      <span className="sr-only">{categoryTones(color).label}, </span>
    </>
  );
}

/**
 * 1.24 A project's Categories, in its Edit window: the project's own labels for its tasks (a name and
 * one of 12 colours), in order. Admins and the project's managers add, rename, recolour, reorder (drag
 * a row, or Move up / Move down, or Alt+↑ / Alt+↓ in a row), retire (kept on its tasks, not offered),
 * use again and delete (only one no task uses), and switch "Every task needs a category" on or off —
 * each saved at once, apart from the window's Save. Everyone else sees the list.
 */
export function CategoriesEditor({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const api = categoriesApi(apiClient);
  const key = categoriesKey(projectId);
  const q = useQuery({ queryKey: key, queryFn: () => api.forProject(projectId) });
  const data = isData(q.data) ? q.data : null;
  const categories = data?.categories ?? [];
  const manage = data?.canManage === true;
  const phone = useMediaQuery(PHONE_QUERY);
  const [open, setOpen] = useState(() => !phone);
  const ids = { panel: useId(), heading: useId(), hint: useId(), requireHint: useId(), add: useId(), addName: useId(), addProblem: useId() };

  const [message, setMessage] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; value: string; problem: string | null; busy: boolean } | null>(null);
  const [recolouring, setRecolouring] = useState<{ id: string; color: string; busy: boolean } | null>(null);
  const [deleting, setDeleting] = useState<ApiCategory | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [addName, setAddName] = useState('');
  const [addColor, setAddColor] = useState<string | null>(null);
  const [addProblem, setAddProblem] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const addRef = useRef<HTMLInputElement>(null);
  /** After a move: the row and the control the keyboard was on, focused again once the row is in its new place. */
  const pendingFocus = useRef<{ id: string; focusKey: string } | null>(null);

  const used = categories.map((c) => c.color);
  const newColor = addColor ?? nextCategoryColor(used);
  // Read again by everyone who shows them: the task form (this key) and the lists (lib/useProjectCategories' own key).
  const refresh = () => qc.invalidateQueries({ queryKey: key });

  useEffect(() => {
    const p = pendingFocus.current;
    if (!p) return;
    pendingFocus.current = null;
    const row = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-category-id]') ?? [])].find((el) => el.dataset.categoryId === p.id);
    let el = row?.querySelector<HTMLButtonElement>(`[data-focus-key="${p.focusKey}"]`) ?? null;
    if (el?.disabled) el = row?.querySelector<HTMLButtonElement>('[data-focus-key="up"]:not(:disabled), [data-focus-key="down"]:not(:disabled)') ?? null;
    el?.focus();
  });

  /** Run one change: its refusal shows above the list; the list is read again either way. */
  async function change(run: () => Promise<unknown>): Promise<boolean> {
    setMessage(null);
    try {
      await run();
      return true;
    } catch (err) {
      setMessage(problemOf(err));
      return false;
    } finally {
      void refresh();
    }
  }

  async function saveOrder(order: string[], movedId: string, focusKey: string | null) {
    if (!data) return;
    const byId = new Map(categories.map((c) => [c.id, c]));
    // The new order shows at once (a read on its way would put the old one back), so a quick second move builds on it.
    void qc.cancelQueries({ queryKey: key });
    const before = qc.getQueryData(key);
    pendingFocus.current = focusKey ? { id: movedId, focusKey } : null;
    qc.setQueryData<ProjectCategories>(key, { ...data, categories: order.map((id, position) => ({ ...byId.get(id)!, position })) });
    setAnnounce(`${byId.get(movedId)?.name ?? ''} moved to place ${order.indexOf(movedId) + 1} of ${order.length}.`);
    const ok = await change(() => api.reorder(projectId, order));
    if (!ok) qc.setQueryData(key, before);
  }

  function move(id: string, delta: -1 | 1, focusKey: string | null) {
    const order = categories.map((c) => c.id);
    const from = order.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= order.length) return;
    order.splice(from, 1);
    order.splice(to, 0, id);
    void saveOrder(order, id, focusKey);
  }

  function dropOn(targetId: string) {
    const moving = dragId;
    setDragId(null);
    setOverId(null);
    if (!moving || moving === targetId) return;
    const order = categories.map((c) => c.id);
    const at = order.indexOf(targetId);
    const rest = order.filter((id) => id !== moving);
    rest.splice(at, 0, moving);
    void saveOrder(rest, moving, null);
  }

  async function add() {
    if (adding) return;
    const check = checkCategoryName(addName);
    if (!check.ok) {
      setAddProblem(check.problem);
      addRef.current?.focus();
      return;
    }
    setAdding(true);
    setAddProblem(null);
    try {
      await api.create(projectId, { name: check.name, color: newColor });
      setAddName('');
      setAddColor(null);
      await refresh();
    } catch (err) {
      setAddProblem(problemOf(err));
    } finally {
      setAdding(false);
      addRef.current?.focus();
    }
  }

  async function saveName() {
    if (!renaming || renaming.busy) return;
    const current = categories.find((c) => c.id === renaming.id);
    const check = checkCategoryName(renaming.value);
    if (!check.ok) return setRenaming({ ...renaming, problem: check.problem });
    if (current && check.name === current.name) return setRenaming(null);
    setRenaming({ ...renaming, busy: true, problem: null });
    try {
      await api.update(renaming.id, { name: check.name });
      pendingFocus.current = { id: renaming.id, focusKey: 'rename' };
      setRenaming(null);
    } catch (err) {
      setRenaming((r) => (r ? { ...r, busy: false, problem: problemOf(err) } : r));
    } finally {
      void refresh();
    }
  }

  async function saveColour() {
    if (!recolouring || recolouring.busy) return;
    const current = categories.find((c) => c.id === recolouring.id);
    if (current && current.color === recolouring.color) {
      pendingFocus.current = { id: recolouring.id, focusKey: 'colour' };
      return setRecolouring(null);
    }
    setRecolouring({ ...recolouring, busy: true });
    const ok = await change(() => api.update(recolouring.id, { color: recolouring.color }));
    if (ok) {
      pendingFocus.current = { id: recolouring.id, focusKey: 'colour' };
      setRecolouring(null);
    } else setRecolouring((r) => (r ? { ...r, busy: false } : r));
  }

  function askDelete(c: ApiCategory) {
    setMessage(null);
    if ((c.taskCount ?? 0) > 0) {
      setMessage(CATEGORY_WORDS.inUse);
      return;
    }
    setDeleteError(null);
    setDeleting(c);
  }

  async function confirmDelete() {
    if (!deleting || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await api.remove(deleting.id);
    } catch (err) {
      setDeleteError(problemOf(err));
      setDeleteBusy(false);
      void refresh();
      return;
    }
    setDeleteBusy(false);
    setDeleting(null);
    await refresh();
    // Its row is gone: the keyboard goes on from the Add box.
    addRef.current?.focus();
  }

  async function toggleRequired() {
    if (!data) return;
    const next = !data.requireCategory;
    void qc.cancelQueries({ queryKey: key });
    qc.setQueryData<ProjectCategories>(key, { ...data, requireCategory: next });
    const ok = await change(() => api.setRequired(projectId, next));
    if (!ok) qc.setQueryData<ProjectCategories>(key, (d) => (d ? { ...d, requireCategory: !next } : d));
  }

  // Enter in a box here does this section's job (add, rename) — never the project window's Save.
  const keepEnterHere = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter' && e.target instanceof HTMLInputElement) e.preventDefault();
  };

  const rowKeys = (e: KeyboardEvent<HTMLLIElement>, c: ApiCategory) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    if (e.target instanceof HTMLInputElement) return;
    e.preventDefault();
    const focusKey = (e.target as HTMLElement).closest('[data-focus-key]')?.getAttribute('data-focus-key') ?? null;
    move(c.id, e.key === 'ArrowUp' ? -1 : 1, focusKey);
  };

  const dragProps = (c: ApiCategory, busy: boolean) =>
    manage && !busy
      ? {
          draggable: true,
          onDragStart: (e: DragEvent<HTMLLIElement>) => {
            setDragId(c.id);
            try {
              e.dataTransfer?.setData('text/plain', c.id);
              if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
            } catch {
              /* some browsers refuse data on a drag they didn't start */
            }
          },
          onDragEnter: (e: DragEvent<HTMLLIElement>) => {
            if (!dragId) return;
            e.preventDefault();
            setOverId(c.id);
          },
          onDragOver: (e: DragEvent<HTMLLIElement>) => {
            if (!dragId) return;
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
          },
          onDrop: (e: DragEvent<HTMLLIElement>) => {
            e.preventDefault();
            dropOn(c.id);
          },
          onDragEnd: () => {
            setDragId(null);
            setOverId(null);
          },
        }
      : {};

  const row = (c: ApiCategory, i: number) => {
    const renamingThis = renaming?.id === c.id ? renaming : null;
    const recolouringThis = recolouring?.id === c.id ? recolouring : null;
    const inUse = (c.taskCount ?? 0) > 0;
    return (
      <li
        key={c.id}
        data-category-id={c.id}
        data-category-name={c.name}
        data-retired={c.retired ? '' : undefined}
        onKeyDown={manage ? (e) => rowKeys(e, c) : undefined}
        {...dragProps(c, !!renamingThis || !!recolouringThis)}
        className={`rounded-xl border bg-surface px-2.5 py-2 transition-colors ${overId === c.id && dragId !== c.id ? 'border-brand ring-2 ring-brand/20' : 'border-line'} ${dragId === c.id ? 'opacity-50' : ''}`}
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          {manage ? (
            <span aria-hidden="true" title="Drag to reorder" className="flex-none cursor-grab text-ink-3 active:cursor-grabbing">
              {GRIP}
            </span>
          ) : null}
          <Swatch color={c.color} />
          {renamingThis ? (
            <RenameBox
              name={c.name}
              value={renamingThis.value}
              problem={renamingThis.problem}
              busy={renamingThis.busy}
              onChange={(value) => setRenaming({ ...renamingThis, value, problem: null })}
              onSave={() => void saveName()}
              onCancel={() => {
                pendingFocus.current = { id: c.id, focusKey: 'rename' };
                setRenaming(null);
              }}
            />
          ) : (
            <span className={`flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 ${c.retired ? 'text-ink-2' : 'text-ink'}`}>
              <bdi className="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">{c.name}</bdi>
              {c.retired ? <span className="rounded bg-ground px-1.5 text-[11px] font-medium text-ink-2">{CATEGORY_WORDS.retired}</span> : null}
              {manage && c.taskCount !== undefined ? <span className="text-xs text-ink-3">{tasksText(c.taskCount)}</span> : null}
            </span>
          )}
          {manage && !renamingThis ? (
            <span className="ms-auto flex flex-wrap items-center gap-1">
              <button type="button" data-focus-key="up" onClick={() => move(c.id, -1, 'up')} disabled={i === 0} aria-label={`${CATEGORY_WORDS.moveUp} ${c.name}`} title={`${CATEGORY_WORDS.moveUp} (Alt+↑)`} aria-keyshortcuts="Alt+ArrowUp" className={ICON_BUTTON}>
                {ARROW(true)}
              </button>
              <button type="button" data-focus-key="down" onClick={() => move(c.id, 1, 'down')} disabled={i === categories.length - 1} aria-label={`${CATEGORY_WORDS.moveDown} ${c.name}`} title={`${CATEGORY_WORDS.moveDown} (Alt+↓)`} aria-keyshortcuts="Alt+ArrowDown" className={ICON_BUTTON}>
                {ARROW(false)}
              </button>
              <button type="button" data-focus-key="rename" onClick={() => { setRecolouring(null); setRenaming({ id: c.id, value: c.name, problem: null, busy: false }); }} aria-label={`${CATEGORY_WORDS.rename} ${c.name}`} className={ROW_BUTTON}>
                {CATEGORY_WORDS.rename}
              </button>
              <button type="button" data-focus-key="colour" onClick={() => { setRenaming(null); setRecolouring(recolouringThis ? null : { id: c.id, color: c.color, busy: false }); }} aria-expanded={!!recolouringThis} aria-label={`Change colour of ${c.name}`} className={ROW_BUTTON}>
                {CATEGORY_WORDS.colour}
              </button>
              <button
                type="button"
                data-focus-key="retire"
                onClick={() => void change(() => api.update(c.id, { retired: !c.retired }))}
                aria-label={c.retired ? `Use ${c.name} again` : `${CATEGORY_WORDS.retire} ${c.name}`}
                className={ROW_BUTTON}
              >
                {c.retired ? CATEGORY_WORDS.unretire : CATEGORY_WORDS.retire}
              </button>
              <button
                type="button"
                data-focus-key="delete"
                onClick={() => askDelete(c)}
                aria-label={`${CATEGORY_WORDS.remove} ${c.name}`}
                aria-disabled={inUse ? true : undefined}
                title={inUse ? CATEGORY_WORDS.inUse : undefined}
                className={`${ROW_BUTTON} ${inUse ? 'cursor-not-allowed opacity-40 hover:border-line hover:bg-transparent hover:text-ink-2' : 'hover:text-danger'}`}
              >
                {CATEGORY_WORDS.remove}
              </button>
            </span>
          ) : null}
        </div>
        {recolouringThis ? (
          <ColourPanel
            name={c.name}
            color={recolouringThis.color}
            busy={recolouringThis.busy}
            onChange={(color) => setRecolouring({ ...recolouringThis, color })}
            onSave={() => void saveColour()}
            onCancel={() => {
              pendingFocus.current = { id: c.id, focusKey: 'colour' };
              setRecolouring(null);
            }}
          />
        ) : null}
      </li>
    );
  };

  return (
    <section aria-labelledby={ids.heading} onKeyDown={keepEnterHere} className="rounded-2xl border border-line px-4 py-3">
      <h3 id={ids.heading} className="text-sm font-semibold text-ink">
        <button type="button" aria-expanded={open} aria-controls={ids.panel} onClick={() => setOpen((o) => !o)} className={`-mx-1 flex w-[calc(100%+0.5rem)] items-center gap-2 rounded-lg px-1 text-left ${TOUCH_TALL}`}>
          <span className="flex-1">
            {CATEGORY_WORDS.heading}
            {data && categories.length > 0 ? <span className="ms-1.5 font-normal text-ink-2">· {categories.length}</span> : null}
          </span>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`flex-none text-ink-2 transition-transform ${open ? 'rotate-180' : ''}`}>
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </h3>
      <div id={ids.panel} hidden={!open} className="mt-1 space-y-3">
        <p id={ids.hint} className="text-xs text-ink-2">{CATEGORY_WORDS.settingsHint}</p>
        {q.isLoading ? (
          <p className="text-sm text-ink-2">Loading…</p>
        ) : q.isError && !data ? (
          <p role="alert" className="text-sm text-danger">
            Couldn’t load the categories.{' '}
            <button type="button" onClick={() => void q.refetch()} className="font-semibold underline">Retry</button>
          </p>
        ) : (
          <>
            {manage ? <p className="text-xs font-medium text-ink">{SAVED_AT_ONCE}</p> : <p className="text-xs text-ink-2">{CATEGORY_WORDS.notManager}</p>}
            {message ? (
              <p role="alert" className="flex items-start justify-between gap-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
                <span>{message}</span>
                <button type="button" onClick={() => setMessage(null)} aria-label="Dismiss" className={`shrink-0 opacity-80 hover:opacity-100 ${TOUCH_SQUARE}`}>✕</button>
              </p>
            ) : null}
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm font-medium text-ink">{CATEGORY_WORDS.require}</div>
                <p id={ids.requireHint} className="text-xs text-ink-2">{CATEGORY_WORDS.requireHint}</p>
              </div>
              <Toggle on={data?.requireCategory === true} onChange={() => void toggleRequired()} label={CATEGORY_WORDS.require} describedBy={ids.requireHint} disabled={!manage} />
            </div>
            {categories.length === 0 ? (
              <p className="text-sm text-ink-2">{CATEGORY_WORDS.none}</p>
            ) : (
              <ol ref={listRef} aria-label="Categories, in order" className="flex flex-col gap-1.5">
                {categories.map(row)}
              </ol>
            )}
            {manage ? (
              <p className="sr-only" aria-live="polite">
                {announce}
              </p>
            ) : null}
            {manage ? (
              <div role="group" aria-labelledby={ids.add} className="space-y-2 rounded-xl bg-ground/60 p-3">
                <div id={ids.add} className="text-sm font-semibold text-ink">{CATEGORY_WORDS.add}</div>
                <div className="flex flex-col gap-1">
                  <label htmlFor={ids.addName} className="text-xs font-medium text-ink-2">Category name</label>
                  <div className="flex gap-2">
                    <input
                      id={ids.addName}
                      ref={addRef}
                      value={addName}
                      onChange={(e) => {
                        setAddName(e.target.value);
                        setAddProblem(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void add();
                        }
                      }}
                      dir="auto"
                      maxLength={CATEGORY_NAME_MAX}
                      placeholder="e.g. Electrical"
                      aria-invalid={addProblem ? true : undefined}
                      aria-describedby={addProblem ? ids.addProblem : undefined}
                      className={`${box(!!addProblem)} min-w-0 flex-1`}
                    />
                    <button type="button" onClick={() => void add()} disabled={adding} className={`flex-none rounded-lg bg-brand px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:brightness-95 disabled:opacity-60 ${TOUCH_TALL}`}>
                      Add
                    </button>
                  </div>
                  {addProblem ? (
                    <p id={ids.addProblem} className="text-xs font-medium text-danger">
                      {addProblem}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-ink-2" aria-hidden="true">{CATEGORY_WORDS.colour}: {CATEGORY_TONES[newColor as keyof typeof CATEGORY_TONES]?.label ?? ''}</span>
                  <CategoryColourPicker label={CATEGORY_WORDS.colour} value={newColor} onChange={setAddColor} />
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
      {deleting ? (
        <ConfirmDialog
          title={`${CATEGORY_WORDS.remove} ${deleting.name}?`}
          confirmLabel="Delete category"
          keepLabel="Cancel"
          busy={deleteBusy}
          error={deleteError}
          onConfirm={() => void confirmDelete()}
          onClose={() => setDeleting(null)}
        >
          No task uses it, so no task changes. This can’t be undone.
        </ConfirmDialog>
      ) : null}
    </section>
  );
}

/** A category's new name, typed in its row: Enter saves, Escape (here only, not the window) leaves it. */
function RenameBox({ name, value, problem, busy, onChange, onSave, onCancel }: { name: string; value: string; problem: string | null; busy: boolean; onChange: (v: string) => void; onSave: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const problemId = useId();
  useOwnEscape(ref, onCancel);
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
        <input
          ref={ref}
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onSave();
            }
          }}
          dir="auto"
          maxLength={CATEGORY_NAME_MAX}
          aria-label={`New name for ${name}`}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? problemId : undefined}
          className={`${box(!!problem)} min-w-[8rem] flex-1`}
        />
        <button type="button" onClick={onSave} disabled={busy} className={`rounded-lg bg-brand px-3 py-1 text-xs font-semibold text-white disabled:opacity-60 ${TOUCH_TALL}`}>
          Save
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className={ROW_BUTTON}>
          Cancel
        </button>
      </span>
      {problem ? (
        <span id={problemId} className="text-xs font-medium text-danger">
          {problem}
        </span>
      ) : null}
    </span>
  );
}

/** A category's colour, changed in its row: pick from the 12, then Save colour (Escape leaves it). */
function ColourPanel({ name, color, busy, onChange, onSave, onCancel }: { name: string; color: string; busy: boolean; onChange: (c: string) => void; onSave: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useOwnEscape(ref, onCancel);
  useEffect(() => {
    ref.current?.querySelector<HTMLInputElement>('input:checked')?.focus();
  }, []);
  return (
    <div ref={ref} className="mt-2 flex flex-col gap-2 border-t border-line pt-2">
      <CategoryColourPicker label={`Colour for ${name}`} value={color} onChange={onChange} disabled={busy} />
      <div className="flex gap-2">
        <button type="button" onClick={onSave} disabled={busy} className={`rounded-lg bg-brand px-3 py-1 text-xs font-semibold text-white disabled:opacity-60 ${TOUCH_TALL}`}>
          Save colour
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className={ROW_BUTTON}>
          Cancel
        </button>
      </div>
    </div>
  );
}
