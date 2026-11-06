import { createContext, Fragment, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Avatar } from '../ui/Avatar';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Sparkle } from '../task-drawer/properties';
import { failureMessage, useOwnEscape } from '../task-drawer/save-state';
import { useAuthStore } from '../../stores/auth-store';
import { readUserValue, writeUserValue } from '../../lib/user-storage';
import { markFound } from '../../lib/useFoundAnchor';
import {
  ancestorsOf,
  checklistCards,
  CHECKLIST_DEPTH_MAX,
  CHECKLIST_TEXT_MAX,
  CHECKLISTS_MAX,
  composerKey,
  dueWords,
  findNode,
  linesOf,
  moveAvailability,
  overallCounts,
  type CLCard,
  type CLItem,
  type CLList,
  type CLNode,
  type CLPerson,
  type ChecklistAt,
  type ChecklistMove,
} from '../../lib/checklist-tree';
import { ActionsMenu, AssignStrip, ChevronIcon, DueStrip, ICON_BUTTON, ProgressBar, SuggestionReview, type MenuEntry } from './checklist-parts';

/** What a delete answers when it can be undone (the batch to restore). */
export interface ChecklistRemovedBatch {
  batchId: string;
  count: number;
}

/**
 * What can be done to the checklists — each optional: what isn't given isn't offered. The task panel
 * saves each change on the server; the New task form and the template editors change a local draft.
 */
export interface ChecklistActions {
  toggle?: (id: string, done: boolean) => Promise<void> | void;
  /** Add one item; answers the new item's id (so typing goes on right after it). */
  addItem?: (at: ChecklistAt, text: string) => Promise<string | void> | string | void;
  /** Add several items at once (pasted lines, AI steps). */
  addItems?: (at: ChecklistAt, texts: string[]) => Promise<void> | void;
  rename?: (id: string, text: string) => Promise<void> | void;
  remove?: (id: string) => Promise<ChecklistRemovedBatch | void> | ChecklistRemovedBatch | void;
  duplicate?: (id: string) => Promise<void> | void;
  move?: (id: string, how: ChecklistMove) => Promise<void> | void;
  assign?: (id: string, userId: string | null) => Promise<void> | void;
  setDue?: (id: string, day: string | null) => Promise<void> | void;
  /** Add a checklist after `afterId` (null: last); answers its id. */
  addList?: (title: string, afterId: string | null) => Promise<string | void> | string | void;
  renameList?: (id: string, title: string) => Promise<void> | void;
  duplicateList?: (id: string) => Promise<void> | void;
  removeList?: (id: string) => Promise<ChecklistRemovedBatch | void> | ChecklistRemovedBatch | void;
  /** Undo a delete (its batch). */
  restore?: (batchId: string) => Promise<void> | void;
}

export interface NestedChecklistsProps {
  lists: CLList[];
  /** Flat, in tree order (list by list, each parent before its sub-items). */
  items: CLItem[];
  actions: ChecklistActions;
  /** Who an item may be given to (the task's team). */
  people?: CLPerson[];
  /** 'panel': the task panel (ticks, counts, people, dates); 'editor': checklists being written (a form, a template). */
  mode?: 'panel' | 'editor';
  /** Today ('YYYY-MM-DD', company time): "3 Nov" this year, late dates in red. */
  today?: string;
  /** Collapsed parents are remembered for the signed-in person on this device, per this key (the task). */
  memoryKey?: string;
  /** Opened at an item (…&item=<id>): its parents open, it comes into view, marked. */
  focusItemId?: string | null;
  /** AI: break the task into steps (reviewed before any is added). */
  onSuggest?: () => Promise<string[] | void>;
  /** 1.23.1: items that came with a merged task, by id ("From MICO-14" over a run of them). */
  fromKeys?: Record<string, string>;
  /** What is typed in the add boxes, kept by the caller (a form: so Create never loses it). */
  typed?: Record<string, string>;
  onTypedChange?: (typed: Record<string, string>) => void;
}

const INDENT_PX = 20;
const INDENT_LEVELS = 4;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const quote = (s: string) => `“${s}”`;
const isEnter = (e: KeyboardEvent) => e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.nativeEvent.isComposing;

type Confirm = { kind: 'item'; id: string; title: string; count: number } | { kind: 'list'; id: string; title: string; count: number };

interface Ctx {
  panel: boolean;
  actions: ChecklistActions;
  people: CLPerson[];
  today: string;
  cards: CLCard[];
  collapsed: Set<string>;
  toggleCollapsed: (id: string) => void;
  editing: string | null;
  setEditing: (id: string | null) => void;
  composer: ChecklistAt | null;
  openComposer: (at: ChecklistAt | null) => void;
  strip: { id: string; kind: 'assign' | 'due' } | null;
  setStrip: (s: { id: string; kind: 'assign' | 'due' } | null) => void;
  note: { id: string; text: string } | null;
  tick: (node: CLNode, listId: string) => void;
  typed: Record<string, string>;
  setTyped: (changes: Record<string, string>) => void;
  addAt: (at: ChecklistAt, texts: string[]) => Promise<string | null | false>;
  run: (listId: string | null, fallback: string, fn: () => unknown) => Promise<boolean>;
  askDelete: (node: CLNode, listId: string) => void;
  hasParents: (listId: string) => boolean;
  fromKeys?: Record<string, string>;
}
const ChecklistContext = createContext<Ctx | null>(null);
const useCtx = () => useContext(ChecklistContext)!;

/** Collapsed parents as remembered (nothing when storage can't be read). */
function readCollapsed(userId: string | undefined, name: string | null): Set<string> {
  if (!name) return new Set();
  try {
    const raw = readUserValue(userId, name);
    const ids = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

/**
 * A task's checklists — several, each with a title, items nested under items — in one editor for the
 * task panel, the New task form and the task and project templates (owner, 6 Nov: nesting is never
 * lost on the way). A parent's tick follows its sub-items; counts are of the real to-do items only.
 */
export function NestedChecklists({
  lists,
  items,
  actions,
  people = [],
  mode = 'panel',
  today = '',
  memoryKey,
  focusItemId,
  onSuggest,
  fromKeys,
  typed: typedProp,
  onTypedChange,
}: NestedChecklistsProps) {
  const panel = mode === 'panel';
  const userId = useAuthStore((s) => s.user?.id);
  const rootRef = useRef<HTMLDivElement>(null);

  // Ticks shown before the server has them (a parent follows its sub-items at once).
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  useEffect(() => setTicks((t) => (Object.keys(t).length ? {} : t)), [items]);
  const cards = useMemo(() => checklistCards(lists, items, ticks), [lists, items, ticks]);
  const overall = overallCounts(cards);

  // Collapsed parents, remembered per person per task on this device.
  const memoryName = memoryKey ? `checklist.collapsed.${memoryKey}` : null;
  const [collapsed, setCollapsedState] = useState<Set<string>>(() => readCollapsed(userId, memoryName));
  const saveCollapsed = (next: Set<string>) => {
    setCollapsedState(next);
    if (memoryName) writeUserValue(userId, memoryName, next.size ? JSON.stringify([...next]) : null);
  };
  const toggleCollapsed = (id: string) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    saveCollapsed(next);
  };

  // Text typed in the add boxes: the caller's (a form), else our own.
  const [ownTyped, setOwnTyped] = useState<Record<string, string>>({});
  const typed = typedProp ?? ownTyped;
  const setTyped = (changes: Record<string, string>) => {
    const next = { ...typed };
    for (const [k, v] of Object.entries(changes)) {
      if (v) next[k] = v;
      else delete next[k];
    }
    if (!typedProp) setOwnTyped(next);
    onTypedChange?.(next);
  };

  const [editing, setEditing] = useState<string | null>(null);
  const [composer, setComposer] = useState<ChecklistAt | null>(null);
  const [strip, setStrip] = useState<{ id: string; kind: 'assign' | 'due' } | null>(null);
  const [note, setNote] = useState<{ id: string; text: string } | null>(null);
  const [problem, setProblem] = useState<{ listId: string | null; text: string } | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [undo, setUndo] = useState<{ batchId: string | null; text: string } | null>(null);
  const [suggestion, setSuggestion] = useState<{ listId: string; steps: string[] } | null>(null);
  const [suggesting, setSuggesting] = useState<string | null>(null);
  const [newList, setNewList] = useState<string | null>(null);
  const [renamingList, setRenamingList] = useState<string | null>(null);

  // Focus moves after a change once the part to focus is on screen (a new checklist's add box, Undo…).
  const pendingFocus = useRef<{ selector: string; until: number } | null>(null);
  const focusSoon = (selector: string) => {
    pendingFocus.current = { selector, until: Date.now() + 5000 };
  };
  useLayoutEffect(() => {
    const want = pendingFocus.current;
    if (!want) return;
    if (Date.now() > want.until) {
      pendingFocus.current = null;
      return;
    }
    const el = rootRef.current?.querySelector<HTMLElement>(want.selector);
    if (el) {
      pendingFocus.current = null;
      el.focus();
    }
  });

  // An undo notice goes after a while.
  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), undo.batchId ? 10_000 : 4000);
    return () => clearTimeout(t);
  }, [undo]);

  // Opened at an item: open its parents, bring it into view and mark it (once per item asked for).
  const marked = useRef<string | null>(null);
  const toMark = useRef<string | null>(null);
  useEffect(() => {
    if (!focusItemId || marked.current === focusItemId || !findNode(cards, focusItemId)) return;
    marked.current = focusItemId;
    const up = ancestorsOf(cards, focusItemId);
    if (up.some((id) => collapsed.has(id))) {
      const next = new Set(collapsed);
      for (const id of up) next.delete(id);
      saveCollapsed(next);
    }
    toMark.current = focusItemId;
  });
  useEffect(() => {
    if (!toMark.current) return;
    const el = document.getElementById(`checklist-item-${toMark.current}`);
    if (el) {
      toMark.current = null;
      markFound(el);
    }
  });

  async function run(listId: string | null, fallback: string, fn: () => unknown): Promise<boolean> {
    setProblem(null);
    try {
      await fn();
      return true;
    } catch (err) {
      setProblem({ listId: listId || null, text: failureMessage(err, fallback) });
      return false;
    }
  }

  /** Add items at a place: several at once when that can be done in one go. The last new id (null: not known; false: failed). */
  async function addAt(at: ChecklistAt, texts: string[]): Promise<string | null | false> {
    if (texts.length === 0) return null;
    let last: string | null = null;
    const ok = await run(at.listId || null, 'Couldn’t add the item.', async () => {
      if (texts.length > 1 && actions.addItems) {
        await actions.addItems(at, texts);
        return;
      }
      let place = at;
      for (const text of texts) {
        const id = await actions.addItem?.(place, text);
        last = typeof id === 'string' ? id : null;
        if (last) place = { ...place, afterId: last };
      }
    });
    return ok ? last : false;
  }

  function tick(node: CLNode, listId: string) {
    const id = node.item.id;
    if (!actions.toggle) return;
    if (node.children.length > 0) {
      // A parent follows its sub-items (owner, 6 Nov): it says why and changes nothing.
      const open = node.subTotal - node.subDone;
      setNote({ id, text: open > 0 ? `${plural(open, 'sub-item')} still open` : 'Its sub-items are all done — reopen one of them instead.' });
      return;
    }
    const next = !node.done;
    setNote(null);
    setProblem(null);
    setTicks((t) => ({ ...t, [id]: next }));
    Promise.resolve()
      .then(() => actions.toggle!(id, next))
      .catch((err: unknown) => {
        // Not saved: the tick goes back as it was.
        setTicks((t) => Object.fromEntries(Object.entries(t).filter(([k]) => k !== id)));
        setProblem({ listId: listId || null, text: failureMessage(err, 'Couldn’t update the checklist.') });
      });
  }

  async function removeItem(id: string, text: string, subItems: number, listId: string) {
    let answer: ChecklistRemovedBatch | void = undefined;
    const ok = await run(listId, 'Couldn’t delete it.', async () => {
      answer = await actions.remove?.(id);
    });
    if (!ok) return;
    if (editing === id) setEditing(null);
    afterDelete(answer, `Deleted ${quote(text)}${subItems ? ` and its ${plural(subItems, 'sub-item')}` : ''}.`, listId);
  }
  async function removeList(id: string, title: string, listId: string) {
    let answer: ChecklistRemovedBatch | void = undefined;
    const ok = await run(listId, 'Couldn’t delete the checklist.', async () => {
      answer = await actions.removeList?.(id);
    });
    if (ok) afterDelete(answer, `Deleted the checklist ${quote(title)}.`, null);
  }
  /** After a delete: Undo (when it can be undone), focused, so nothing is lost by a misclick. */
  function afterDelete(answer: ChecklistRemovedBatch | void, text: string, listId: string | null) {
    const batchId = answer && typeof answer === 'object' && answer.batchId ? answer.batchId : null;
    if (batchId && actions.restore) {
      setUndo({ batchId, text });
      focusSoon('[data-undo]');
    } else {
      focusSoon(listId !== null ? `[data-add-for="${listId}"]` : '[data-add-for]');
    }
  }
  async function undoDelete() {
    const batchId = undo?.batchId;
    if (!batchId || !actions.restore) return;
    const ok = await run(null, 'Couldn’t restore it.', () => actions.restore!(batchId));
    setUndo(ok ? { batchId: null, text: 'Restored.' } : null);
  }

  function askDelete(node: CLNode, listId: string) {
    if (node.descendants > 0) setConfirm({ kind: 'item', id: node.item.id, title: node.item.text, count: node.descendants });
    else void removeItem(node.item.id, node.item.text, 0, listId);
  }

  async function suggestFor(listId: string) {
    if (!onSuggest || suggesting) return;
    setSuggesting(listId);
    setProblem(null);
    try {
      const steps = (await onSuggest()) ?? [];
      if (steps.length === 0) setProblem({ listId: listId || null, text: 'The AI had no steps to suggest for this task.' });
      else setSuggestion({ listId, steps });
    } catch (err) {
      setProblem({ listId: listId || null, text: failureMessage(err, 'The AI suggestion failed.') });
    } finally {
      setSuggesting(null);
    }
  }

  const canAdd = Boolean(actions.addItem || actions.addItems);
  const hasParents = (listId: string) => {
    const card = cards.find((c) => c.list.id === listId);
    return Boolean(card?.roots.some(function any(n: CLNode): boolean {
      return n.children.length > 0 || n.children.some(any);
    }));
  };
  const openComposer = (at: ChecklistAt | null) => {
    setComposer(at);
    if (at?.parentId && collapsed.has(at.parentId)) toggleCollapsed(at.parentId);
  };

  const ctx: Ctx = {
    panel,
    actions,
    people,
    today,
    cards,
    collapsed,
    toggleCollapsed,
    editing,
    setEditing,
    composer,
    openComposer,
    strip,
    setStrip,
    note,
    tick,
    typed,
    setTyped,
    addAt,
    run,
    askDelete,
    hasParents,
    fromKeys,
  };

  const lastListId = cards[cards.length - 1]?.implicit ? null : (cards[cards.length - 1]?.list.id ?? null);
  const canAddList = Boolean(actions.addList) && lists.length < CHECKLISTS_MAX;
  async function createList() {
    const title = (newList ?? '').trim();
    if (!title || !actions.addList) return;
    let id: string | void = undefined;
    const ok = await run(null, 'Couldn’t add the checklist.', async () => {
      id = await actions.addList!(title.slice(0, CHECKLIST_TEXT_MAX), lastListId);
    });
    if (!ok) return;
    setNewList(null);
    focusSoon(typeof id === 'string' ? `[data-add-for="${id}"]` : '[data-add-list]');
  }

  const body = (
    <>
      {cards.map((card) => (
        <ChecklistCard
          key={card.list.id || 'implicit'}
          card={card}
          headingLevel={panel ? 4 : 3}
          problem={problem && problem.listId !== null && problem.listId === card.list.id ? problem.text : null}
          renaming={renamingList === card.list.id}
          onRenamed={() => setRenamingList(null)}
          menu={[
            ...(actions.renameList && !card.implicit ? [{ label: 'Rename', onSelect: () => setRenamingList(card.list.id) }] : []),
            ...(actions.duplicateList && !card.implicit ? [{ label: 'Duplicate', onSelect: () => void run(card.list.id, 'Couldn’t duplicate the checklist.', () => actions.duplicateList!(card.list.id)) }] : []),
            ...(hasParents(card.list.id)
              ? [
                  {
                    label: 'Collapse all',
                    onSelect: () => {
                      const next = new Set(collapsed);
                      const walk = (ns: CLNode[]) => ns.forEach((n) => (n.children.length ? (next.add(n.item.id), walk(n.children)) : null));
                      walk(card.roots);
                      saveCollapsed(next);
                    },
                  },
                  {
                    label: 'Expand all',
                    onSelect: () => {
                      const next = new Set(collapsed);
                      const walk = (ns: CLNode[]) => ns.forEach((n) => (next.delete(n.item.id), walk(n.children)));
                      walk(card.roots);
                      saveCollapsed(next);
                    },
                  },
                ]
              : []),
            ...(onSuggest && canAdd ? [{ label: 'Suggest steps (AI)', onSelect: () => void suggestFor(card.list.id) }] : []),
            ...(actions.removeList && !card.implicit
              ? [
                  {
                    label: 'Delete',
                    danger: true,
                    onSelect: () => setConfirm({ kind: 'list', id: card.list.id, title: card.list.title, count: countItems(card.roots) }),
                  },
                ]
              : []),
          ]}
          suggestion={
            suggestion && suggestion.listId === card.list.id ? (
              <SuggestionReview
                steps={suggestion.steps}
                onDiscard={() => setSuggestion(null)}
                onAdd={async (chosen) => {
                  if ((await addAt({ listId: card.list.id, parentId: null, afterId: null }, chosen)) !== false) setSuggestion(null);
                }}
              />
            ) : null
          }
        />
      ))}
      {canAddList ? (
        newList === null ? (
          <button
            type="button"
            data-add-list
            onClick={() => setNewList('')}
            className="inline-flex h-9 items-center gap-1.5 self-start rounded-lg border border-dashed border-line px-3 text-xs font-semibold text-brand transition-colors hover:border-brand sm:h-8 [@media(pointer:coarse)]:h-11"
          >
            <span aria-hidden="true">+</span> Add checklist
          </button>
        ) : (
          <NewListBox value={newList} onChange={setNewList} onSubmit={() => void createList()} onCancel={() => setNewList(null)} />
        )
      ) : null}
    </>
  );

  return (
    <ChecklistContext.Provider value={ctx}>
      <div ref={rootRef}>
        {panel ? (
          <section aria-labelledby="task-checklist-heading">
            <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2">
              <h3 id="task-checklist-heading" className="eyebrow">
                Checklists
              </h3>
              {overall.total > 0 ? <span className="text-xs font-medium tabular-nums text-ink-2">{`${overall.done}/${overall.total} completed`}</span> : null}
              {onSuggest && canAdd ? (
                <button
                  type="button"
                  onClick={() => void suggestFor(cards[0]!.list.id)}
                  disabled={suggesting !== null}
                  title="Let AI break this task into steps — you review them before any are added"
                  className="ms-auto inline-flex h-9 items-center gap-1.5 rounded-lg border border-brand/30 bg-brand/5 px-2.5 text-xs font-semibold text-brand transition-colors hover:border-brand disabled:opacity-60 sm:h-8 [@media(pointer:coarse)]:h-11"
                >
                  {suggesting ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-brand/30 border-t-brand" aria-hidden /> : <Sparkle />}
                  {suggesting ? 'Thinking…' : 'Suggest steps'}
                  <span className="rounded bg-brand px-1 py-px text-[9px] font-bold uppercase tracking-wide text-white">AI</span>
                </button>
              ) : null}
            </div>
            {problem && problem.listId === null ? (
              <p role="alert" className="mb-2 rounded-md bg-danger-soft px-2.5 py-1.5 text-xs text-danger">
                {problem.text}
              </p>
            ) : null}
            <div className="flex flex-col gap-3">{body}</div>
            {undo ? (
              <div data-testid="checklist-undo" role="status" className="sticky bottom-2 z-10 mt-3 flex items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink shadow-lift">
                <span className="min-w-0 flex-1 break-words">{undo.text}</span>
                {undo.batchId ? (
                  <button type="button" data-undo onClick={() => void undoDelete()} className="h-9 rounded-lg px-2.5 text-sm font-semibold text-brand hover:bg-brand/10 sm:h-8 [@media(pointer:coarse)]:h-11">
                    Undo
                  </button>
                ) : null}
                <button type="button" onClick={() => setUndo(null)} aria-label="Dismiss" className={ICON_BUTTON}>
                  ✕
                </button>
              </div>
            ) : null}
          </section>
        ) : (
          <div className="flex flex-col gap-3">
            {problem && problem.listId === null ? (
              <p role="alert" className="rounded-md bg-danger-soft px-2.5 py-1.5 text-xs text-danger">
                {problem.text}
              </p>
            ) : null}
            {body}
          </div>
        )}
      </div>
      {confirm ? (
        <ConfirmDialog
          title={
            confirm.kind === 'item'
              ? `Delete ${quote(confirm.title)} and its ${plural(confirm.count, 'sub-item')}?`
              : confirm.count
                ? `Delete the checklist ${quote(confirm.title)} and its ${plural(confirm.count, 'item')}?`
                : `Delete the checklist ${quote(confirm.title)}?`
          }
          confirmLabel="Delete"
          onConfirm={() => {
            const c = confirm;
            setConfirm(null);
            if (c.kind === 'item') {
              const listId = findNode(cards, c.id)?.card.list.id ?? '';
              void removeItem(c.id, c.title, c.count, listId);
            } else void removeList(c.id, c.title, c.id);
          }}
          onClose={() => setConfirm(null)}
        >
          {panel && actions.restore ? 'You can undo it straight away, or restore it from the task’s history for 30 days.' : null}
        </ConfirmDialog>
      ) : null}
    </ChecklistContext.Provider>
  );
}

const countItems = (nodes: CLNode[]): number => nodes.reduce((n, x) => n + 1 + x.descendants, 0);

function NewListBox({ value, onChange, onSubmit, onCancel }: { value: string; onChange: (v: string) => void; onSubmit: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useOwnEscape(ref, onCancel);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={ref}
        dir="auto"
        aria-label="New checklist title"
        placeholder="e.g. Electrical"
        maxLength={CHECKLIST_TEXT_MAX}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (isEnter(e)) {
            e.preventDefault();
            onSubmit();
          }
        }}
        className="h-9 min-w-0 flex-[1_1_12rem] rounded-lg border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 [@media(pointer:coarse)]:h-11"
      />
      <button type="button" onClick={onSubmit} disabled={!value.trim()} className="h-9 rounded-lg bg-brand px-3 text-xs font-semibold text-white hover:bg-brand-2 disabled:opacity-50 sm:h-8 [@media(pointer:coarse)]:h-11">
        Add checklist
      </button>
      <button type="button" onClick={onCancel} className="h-9 rounded-lg px-2.5 text-xs font-medium text-ink-2 hover:bg-ground sm:h-8 [@media(pointer:coarse)]:h-11">
        Cancel
      </button>
    </div>
  );
}

/** One checklist: its title (renamed in place), "5/8" and a bar, its menu, its items and a box to add more. */
function ChecklistCard({
  card,
  headingLevel,
  problem,
  renaming,
  onRenamed,
  menu,
  suggestion,
}: {
  card: CLCard;
  headingLevel: 3 | 4;
  problem: string | null;
  renaming: boolean;
  onRenamed: () => void;
  menu: MenuEntry[];
  suggestion: ReactNode;
}) {
  const c = useCtx();
  const titleId = useId();
  const title = card.list.title;
  const Heading = headingLevel === 3 ? 'h3' : 'h4';
  const listId = card.list.id;
  return (
    <div role="group" aria-labelledby={titleId} data-testid="checklist-card" data-list-id={listId} className="rounded-xl border border-line bg-surface p-2.5 sm:p-3">
      <div className="mb-1.5 flex items-center gap-2">
        {renaming ? (
          <ListTitleEditor id={titleId} title={title} onDone={onRenamed} onSave={(next) => c.run(listId, 'Couldn’t rename the checklist.', () => c.actions.renameList?.(listId, next))} />
        ) : (
          <Heading id={titleId} dir="auto" className="min-w-0 flex-1 text-sm font-semibold text-ink [overflow-wrap:anywhere]">
            {title}
          </Heading>
        )}
        {c.panel && card.total > 0 ? <span className="flex-none text-xs font-semibold tabular-nums text-ink-2">{`${card.done}/${card.total}`}</span> : null}
        <ActionsMenu label={`Actions for the checklist ${quote(title)}`} entries={menu} />
      </div>
      {c.panel && card.total > 0 ? (
        <div className="mb-2">
          <ProgressBar label={`Progress of ${quote(title)}`} done={card.done} total={card.total} />
        </div>
      ) : null}
      {problem ? (
        <p role="alert" className="mb-2 rounded-md bg-danger-soft px-2.5 py-1.5 text-xs text-danger">
          {problem}
        </p>
      ) : null}
      {suggestion}
      {card.roots.length === 0 && c.panel ? (
        <p className="py-1 text-sm text-ink-3">{c.actions.addItem || c.actions.addItems ? 'No steps yet — break the work down below.' : 'No checklist items.'}</p>
      ) : null}
      <ItemList nodes={card.roots} parent={null} listId={listId} listTitle={title} />
      {c.actions.addItem || c.actions.addItems ? <EndBox card={card} /> : null}
    </div>
  );
}

function ListTitleEditor({ id, title, onSave, onDone }: { id: string; title: string; onSave: (title: string) => Promise<boolean>; onDone: () => void }) {
  const [value, setValue] = useState(title);
  const ref = useRef<HTMLInputElement>(null);
  const active = useRef(true);
  useOwnEscape(ref, () => {
    active.current = false;
    onDone();
  });
  useEffect(() => ref.current?.focus(), []);
  async function commit() {
    if (!active.current) return;
    active.current = false;
    const next = value.trim();
    if (next && next !== title && !(await onSave(next.slice(0, CHECKLIST_TEXT_MAX)))) {
      active.current = true;
      return;
    }
    onDone();
  }
  return (
    <input
      ref={ref}
      id={id}
      dir="auto"
      aria-label="Checklist title"
      maxLength={CHECKLIST_TEXT_MAX}
      value={value}
      data-unsaved={value.trim() !== title || undefined}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (isEnter(e)) {
          e.preventDefault();
          void commit();
        }
      }}
      onBlur={() => void commit()}
      className="h-9 min-w-0 flex-1 rounded-md border border-brand bg-surface px-2 text-sm font-semibold text-ink outline-none ring-2 ring-brand/20 sm:h-8 [@media(pointer:coarse)]:h-11"
    />
  );
}

/** Items at one level, with a "From MICO-14" heading over a run of a merged task's items, and an add box where one is open. */
function ItemList({ nodes, parent, listId, listTitle = '', id }: { nodes: CLNode[]; parent: CLNode | null; listId: string; listTitle?: string; id?: string }) {
  const c = useCtx();
  const parentId = parent?.item.id ?? null;
  const here = (at: ChecklistAt | null, afterId: string | null) => at && at.listId === listId && at.parentId === parentId && at.afterId === afterId;
  const endComposer = parentId !== null && here(c.composer, null);
  if (nodes.length === 0 && !endComposer) return null;
  const depth = parent ? parent.depth + 1 : 0;
  return (
    <ul id={id} className="flex flex-col">
      {nodes.map((node, index) => {
        // 1.23.3: a merged task's checklists come whole, titled "From MICO-14 · …" — no heading repeats it.
        const fromKey = parent === null && !listTitle.startsWith('From ') ? c.fromKeys?.[node.item.id] : undefined;
        const before = parent === null && index > 0 ? c.fromKeys?.[nodes[index - 1]!.item.id] : undefined;
        return (
          <Fragment key={node.item.id}>
            {fromKey && fromKey !== before ? (
              <li data-testid="checklist-from" className="mt-2 px-1 pb-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                From <span dir="ltr" translate="no" className="font-mono normal-case">{fromKey}</span>
              </li>
            ) : null}
            <ItemRow node={node} listId={listId} />
            {here(c.composer, node.item.id) ? <Composer at={c.composer!} depth={depth} label={`New item after ${quote(node.item.text)}`} /> : null}
          </Fragment>
        );
      })}
      {endComposer ? <Composer at={c.composer!} depth={depth} label={`New sub-item of ${quote(parent!.item.text)}`} /> : null}
    </ul>
  );
}

/** The indent of a level: 20 px a level up to four; deeper levels keep the fourth (with a guide line). */
const indentOf = (depth: number) => `${Math.min(depth, INDENT_LEVELS) * INDENT_PX}px`;

function ItemRow({ node, listId }: { node: CLNode; listId: string }) {
  const c = useCtx();
  const it = node.item;
  const parent = node.children.length > 0;
  const expanded = !c.collapsed.has(it.id);
  const childListId = `checklist-children-${it.id}`;
  const countId = `checklist-count-${it.id}`;
  const showChildren = parent ? expanded : c.composer?.parentId === it.id && c.composer.afterId === null;
  const late = Boolean(c.panel && it.dueDate && c.today && it.dueDate < c.today && !node.done);
  const moves = c.actions.move ? moveAvailability(c.cards, it.id) : null;
  const can = (how: ChecklistMove) => Boolean(moves?.[how]);
  const menu: MenuEntry[] = [
    ...((c.actions.addItem || c.actions.addItems) && node.depth < CHECKLIST_DEPTH_MAX - 1
      ? [{ label: 'Add sub-item', onSelect: () => c.openComposer({ listId, parentId: it.id, afterId: null }) }]
      : []),
    ...(c.panel && c.actions.assign && c.people.length ? [{ label: 'Assign…', onSelect: () => c.setStrip({ id: it.id, kind: 'assign' }) }] : []),
    ...(c.panel && c.actions.setDue ? [{ label: 'Due date…', onSelect: () => c.setStrip({ id: it.id, kind: 'due' }) }] : []),
    ...(c.actions.duplicate ? [{ label: 'Duplicate', onSelect: () => void c.run(listId, 'Couldn’t duplicate it.', () => c.actions.duplicate!(it.id)) }] : []),
    ...(['indent', 'outdent', 'up', 'down'] as const)
      .filter(can)
      .map((how) => ({ label: { indent: 'Indent', outdent: 'Outdent', up: 'Move up', down: 'Move down' }[how], onSelect: () => void c.run(listId, 'Couldn’t move it.', () => c.actions.move!(it.id, how)) })),
    ...(c.actions.remove ? [{ label: 'Delete', danger: true, onSelect: () => c.askDelete(node, listId) }] : []),
  ];
  const deep = node.depth > INDENT_LEVELS;
  const reserve = c.hasParents(listId);
  return (
    <li id={`checklist-item-${it.id}`} data-testid="checklist-item" data-depth={node.depth} data-item-id={it.id} data-from-key={c.fromKeys?.[it.id] ?? undefined} className="scroll-mt-24 rounded-lg outline-none data-[found=true]:ring-2 data-[found=true]:ring-brand/50">
      <div data-row className="group flex items-start gap-0.5 rounded-lg transition-colors hover:bg-ground/70" style={{ paddingInlineStart: indentOf(node.depth) }}>
        {deep ? <span data-guide aria-hidden="true" title={`Level ${node.depth + 1}`} className="my-1 me-1 w-0.5 flex-none self-stretch rounded-full bg-brand/30" /> : null}
        {parent ? (
          <button
            type="button"
            onClick={() => c.toggleCollapsed(it.id)}
            aria-expanded={expanded}
            aria-controls={expanded ? childListId : undefined}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${quote(it.text)}`}
            className="grid h-9 w-6 flex-none place-items-center rounded-md text-ink-3 hover:bg-ground hover:text-ink sm:h-8 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
          >
            <ChevronIcon open={expanded} />
          </button>
        ) : reserve ? (
          <span aria-hidden="true" className="w-6 flex-none [@media(pointer:coarse)]:w-11" />
        ) : null}
        {c.panel && c.actions.toggle ? (
          <label className="grid h-9 w-8 flex-none cursor-pointer place-items-center sm:h-8 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11">
            <input type="checkbox" checked={node.done} aria-label={it.text} aria-describedby={parent ? countId : undefined} onChange={() => c.tick(node, listId)} className="h-[18px] w-[18px] accent-brand" />
          </label>
        ) : c.panel ? (
          <span aria-hidden="true" className="grid h-9 w-8 flex-none place-items-center text-ink-3 sm:h-8">
            {node.done ? '☑' : '☐'}
          </span>
        ) : (
          <span aria-hidden="true" className="grid h-9 w-7 flex-none place-items-center sm:h-8">
            <span className="h-4 w-4 rounded border border-ink-3/60" />
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 py-1">
          {c.editing === it.id ? <ItemEditor node={node} listId={listId} /> : <ItemText node={node} />}
          {c.editing === it.id ? null : <ItemFacts node={node} late={late} countId={countId} />}
        </div>
        <ActionsMenu label={`More actions for ${quote(it.text)}`} entries={menu} className="sm:opacity-60 sm:group-hover:opacity-100 sm:focus-within:opacity-100" />
      </div>
      {c.note?.id === it.id ? (
        <p role="status" className="mb-1 ms-1 rounded-md bg-warning-soft px-2 py-1 text-xs font-medium text-ink" style={{ marginInlineStart: indentOf(node.depth) }}>
          {c.note.text}
        </p>
      ) : null}
      {c.strip?.id === it.id ? (
        <div style={{ marginInlineStart: indentOf(node.depth) }}>
          {c.strip.kind === 'assign' ? (
            <AssignStrip
              text={it.text}
              people={c.people}
              current={it.assignee?.id ?? null}
              onClose={() => c.setStrip(null)}
              onPick={async (userId) => {
                await c.actions.assign!(it.id, userId);
                c.setStrip(null);
              }}
            />
          ) : (
            <DueStrip
              text={it.text}
              current={it.dueDate ?? null}
              onClose={() => c.setStrip(null)}
              onSave={async (day) => {
                await c.actions.setDue!(it.id, day);
                c.setStrip(null);
              }}
            />
          )}
        </div>
      ) : null}
      {showChildren ? <ItemList id={childListId} nodes={node.children} parent={node} listId={listId} /> : null}
    </li>
  );
}

/** The item's words: a button that edits them in place when they can be changed. */
function ItemText({ node }: { node: CLNode }) {
  const c = useCtx();
  const it = node.item;
  const tone = `${node.done && c.panel ? 'text-ink-3 line-through' : 'text-ink'} ${node.children.length ? 'font-medium' : ''}`;
  if (!c.actions.rename) {
    return (
      <span dir="auto" className={`min-w-0 flex-[1_1_7rem] text-start text-sm [overflow-wrap:anywhere] ${tone}`}>
        {it.text}
      </span>
    );
  }
  return (
    <button
      type="button"
      data-edit-for={it.id}
      onClick={() => c.setEditing(it.id)}
      aria-label={`Edit ${quote(it.text)}`}
      title="Edit"
      dir="auto"
      className={`min-w-0 flex-[1_1_7rem] cursor-text rounded [overflow-wrap:anywhere] px-0.5 text-start text-sm hover:bg-surface ${tone}`}
    >
      {it.text}
    </button>
  );
}

/** The person (a face), the due date and, on a parent, how many of its sub-items are done. */
function ItemFacts({ node, late, countId }: { node: CLNode; late: boolean; countId: string }) {
  const c = useCtx();
  const it = node.item;
  if (!c.panel) return null;
  const who = it.assignee;
  const due = dueWords(it.dueDate, c.today);
  const canAssign = Boolean(c.actions.assign && c.people.length);
  return (
    <span className="ms-auto flex min-w-0 max-w-full flex-wrap items-center gap-1.5">
      {who ? (
        canAssign ? (
          <button type="button" onClick={() => c.setStrip({ id: it.id, kind: 'assign' })} aria-label={`For ${who.name} — change who it’s for`} title={who.name} className="grid h-7 w-7 place-items-center rounded-full hover:ring-2 hover:ring-brand/30 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11">
            <span aria-hidden="true" className="contents">
              <Avatar name={who.name} src={who.avatarUrl ?? null} size="sm" />
            </span>
          </button>
        ) : (
          <span role="img" aria-label={who.name} title={who.name} className="inline-flex">
            <span aria-hidden="true" className="contents">
              <Avatar name={who.name} src={who.avatarUrl ?? null} size="sm" />
            </span>
          </span>
        )
      ) : null}
      {due ? (
        c.actions.setDue ? (
          <button
            type="button"
            onClick={() => c.setStrip({ id: it.id, kind: 'due' })}
            aria-label={`Due ${due}${late ? ', overdue' : ''} — change the due date`}
            className={`inline-flex h-7 items-center rounded-md px-1.5 text-xs font-medium tabular-nums transition-colors hover:bg-surface [@media(pointer:coarse)]:h-11 ${late ? 'bg-danger-soft font-semibold text-danger' : 'bg-ground text-ink-2'}`}
          >
            {due}
          </button>
        ) : (
          <span className={`inline-flex h-6 items-center rounded-md px-1.5 text-xs font-medium tabular-nums ${late ? 'bg-danger-soft font-semibold text-danger' : 'bg-ground text-ink-2'}`}>
            <span className="sr-only">Due </span>
            {due}
            {late ? <span className="sr-only">, overdue</span> : null}
          </span>
        )
      ) : null}
      {node.children.length ? (
        <span id={countId} className="text-xs font-semibold tabular-nums text-ink-2">
          <span aria-hidden="true">{`${node.subDone}/${node.subTotal}`}</span>
          <span className="sr-only">{`${node.subDone} of ${plural(node.subTotal, 'sub-item')} done`}</span>
        </span>
      ) : null}
    </span>
  );
}

/**
 * An item's words being edited: Enter saves and starts the next item at the same level, Tab /
 * Shift+Tab indent / outdent it, Escape drops the edit, leaving the box saves.
 */
function ItemEditor({ node, listId }: { node: CLNode; listId: string }) {
  const c = useCtx();
  const it = node.item;
  const [draft, setDraft] = useState(it.text);
  const [problem, setProblem] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const active = useRef(true);
  useOwnEscape(ref, () => {
    active.current = false;
    c.setEditing(null);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-edit-for="${it.id}"]`)?.focus());
  });
  useEffect(() => ref.current?.focus(), []);

  /** Save the words when they changed; false when refused (the edit stays, saying why). */
  async function save(): Promise<boolean> {
    const text = draft.trim();
    if (!text || text === it.text || !c.actions.rename) return true;
    try {
      await c.actions.rename(it.id, text.slice(0, CHECKLIST_TEXT_MAX));
      setProblem(null);
      return true;
    } catch (err) {
      setProblem(failureMessage(err, 'Couldn’t rename it.'));
      return false;
    }
  }
  async function finish(next?: () => void) {
    if (!active.current) return;
    active.current = false;
    if (!(await save())) {
      active.current = true;
      return;
    }
    c.setEditing(null);
    next?.();
  }
  async function shift(how: 'indent' | 'outdent') {
    if (!(await save())) return;
    await c.run(listId, 'Couldn’t move it.', () => c.actions.move!(it.id, how));
    ref.current?.focus();
  }
  return (
    <div className="min-w-0 flex-1">
      <input
        ref={ref}
        aria-label="Checklist item"
        dir="auto"
        maxLength={CHECKLIST_TEXT_MAX}
        value={draft}
        // Leaving the box saves the new wording (stepping to another task too); only a refused save is unsaved.
        data-unsaved={problem ? true : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (isEnter(e)) {
            e.preventDefault();
            void finish(() => (c.actions.addItem || c.actions.addItems ? c.openComposer({ listId, parentId: it.parentId, afterId: it.id }) : undefined));
          } else if (e.key === 'Tab' && c.actions.move) {
            const moves = moveAvailability(c.cards, it.id);
            const how = e.shiftKey ? 'outdent' : 'indent';
            if (!moves[how]) return;
            e.preventDefault();
            void shift(how);
          }
        }}
        onBlur={() => void finish()}
        className="h-9 w-full rounded-md border border-brand bg-surface px-2 text-sm text-ink outline-none ring-2 ring-brand/20 sm:h-8 [@media(pointer:coarse)]:h-11"
      />
      {problem ? (
        <p role="alert" className="mt-1 text-xs text-danger">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

/** The slot an add box at `at` could be indented into: under the item before it. */
function indentTarget(cards: CLCard[], at: ChecklistAt): CLNode | null {
  const siblings = at.parentId ? (findNode(cards, at.parentId)?.node.children ?? []) : (cards.find((x) => x.list.id === at.listId)?.roots ?? []);
  const prev = at.afterId ? siblings.find((n) => n.item.id === at.afterId) : siblings[siblings.length - 1];
  return prev && prev.depth < CHECKLIST_DEPTH_MAX - 1 ? prev : null;
}

/** Keys an add box shares: Enter adds, Tab / Shift+Tab move the box in / out a level (with what's typed). */
function useAddBoxKeys(at: ChecklistAt, text: string, onAdded: (newId: string | null) => void) {
  const c = useCtx();
  const key = composerKey(at);
  return async (e: KeyboardEvent<HTMLInputElement>) => {
    if (isEnter(e)) {
      e.preventDefault();
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length === 0) {
        onAdded(null);
        return;
      }
      const added = await c.addAt(at, lines);
      if (added === false) return;
      c.setTyped({ [key]: '' });
      onAdded(added);
    } else if (e.key === 'Tab' && !e.shiftKey && text.trim()) {
      const target = indentTarget(c.cards, at);
      if (!target) return;
      e.preventDefault();
      const next = { listId: at.listId, parentId: target.item.id, afterId: null };
      c.setTyped({ [key]: '', [composerKey(next)]: text });
      c.openComposer(next);
    } else if (e.key === 'Tab' && e.shiftKey && at.parentId && text.trim()) {
      const up = findNode(c.cards, at.parentId);
      if (!up) return;
      e.preventDefault();
      const next = { listId: at.listId, parentId: up.parent?.item.id ?? null, afterId: at.parentId };
      c.setTyped({ [key]: '', [composerKey(next)]: text });
      c.openComposer(next);
    }
  };
}

/** A new item being written in the list, where Enter (or "Add sub-item") put it. */
function Composer({ at, depth, label }: { at: ChecklistAt; depth: number; label: string }) {
  const c = useCtx();
  const key = composerKey(at);
  const value = c.typed[key] ?? '';
  const ref = useRef<HTMLInputElement>(null);
  useOwnEscape(ref, () => {
    c.setTyped({ [key]: '' });
    c.openComposer(null);
  });
  useEffect(() => ref.current?.focus(), [key]);
  const onKey = useAddBoxKeys(at, value, (newId) => {
    if (newId === null && !value.trim()) c.openComposer(null);
    else if (newId) c.openComposer({ ...at, afterId: newId });
  });
  return (
    <li data-testid="checklist-composer" style={{ paddingInlineStart: indentOf(depth) }} className="py-0.5">
      <input
        ref={ref}
        dir="auto"
        aria-label={label}
        placeholder="New item…"
        maxLength={CHECKLIST_TEXT_MAX * 20}
        value={value}
        data-unsaved={value.trim() !== '' || undefined}
        onChange={(e) => c.setTyped({ [key]: e.target.value })}
        onKeyDown={(e) => void onKey(e)}
        onPaste={(e) => {
          const lines = linesOf(e.clipboardData.getData('text'));
          if (lines.length < 2) return;
          e.preventDefault();
          void c.addAt(at, lines).then((r) => r !== false && c.openComposer(null));
        }}
        onBlur={() => {
          if (!value.trim()) c.openComposer(null);
        }}
        className="h-9 w-full rounded-md border border-brand/60 bg-surface px-2 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-brand focus:ring-2 focus:ring-brand/20 sm:h-8 [@media(pointer:coarse)]:h-11"
      />
    </li>
  );
}

/** The box at the end of a checklist: Enter adds at the top level and keeps the box ready; pasted lines add one each. */
function EndBox({ card }: { card: CLCard }) {
  const c = useCtx();
  const at: ChecklistAt = { listId: card.list.id, parentId: null, afterId: null };
  const key = composerKey(at);
  const value = c.typed[key] ?? '';
  const [adding, setAdding] = useState(false);
  const onKey = useAddBoxKeys(at, value, () => undefined);
  async function addTyped() {
    const lines = value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length || adding) return;
    setAdding(true);
    if ((await c.addAt(at, lines)) !== false) c.setTyped({ [key]: '' });
    setAdding(false);
  }
  return (
    <div className="mt-1.5 flex items-center gap-2">
      <input
        dir="auto"
        data-add-for={card.list.id}
        aria-label={`Add an item to ${quote(card.list.title)}`}
        placeholder="Add an item…"
        maxLength={CHECKLIST_TEXT_MAX * 20}
        value={value}
        data-unsaved={value.trim() !== '' || undefined}
        onChange={(e) => c.setTyped({ [key]: e.target.value })}
        onKeyDown={(e) => {
          if (isEnter(e)) {
            e.preventDefault();
            void addTyped();
          } else void onKey(e);
        }}
        onPaste={(e) => {
          const lines = linesOf(`${value}${e.clipboardData.getData('text')}`);
          if (!/\n/.test(e.clipboardData.getData('text')) || lines.length < 2) return;
          e.preventDefault();
          void c.addAt(at, lines).then((r) => r !== false && c.setTyped({ [key]: '' }));
        }}
        className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-sm text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-brand focus:ring-2 focus:ring-brand/20 sm:h-9 [@media(pointer:coarse)]:h-11"
      />
      <button
        type="button"
        onClick={() => void addTyped()}
        disabled={value.trim() === '' || adding}
        className="h-10 flex-none rounded-lg border border-line px-3 text-xs font-semibold text-brand transition-colors hover:border-brand disabled:opacity-50 sm:h-9 [@media(pointer:coarse)]:h-11"
      >
        Add item
      </button>
    </div>
  );
}
