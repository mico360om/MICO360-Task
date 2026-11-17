import { useId, useRef, useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { FieldLabel, FieldError, fieldClass } from './ui/Field';
import { statusMeta, STATUS_ORDER } from '../lib/taskStatus';
import { statusClass } from '../lib/colour-classes';
import type { ApiColumn, ColumnCategory } from '../api/columns';

/** s137: a column as Manage columns lists it — with its live task count when the server gave one. */
export type ManagedColumn = ApiColumn & { taskCount?: number };

export interface ColumnManagerProps {
  columns: ManagedColumn[];
  /** s137: a new column's name and status, chosen at once. */
  onAdd: (name: string, category: ColumnCategory) => void;
  onRename: (id: string, name: string) => void;
  /** Change which Kanban status this column maps to (optional). Its colour follows (1.23.8). */
  onSetCategory?: (id: string, category: ColumnCategory) => void;
  onToggleEnabled: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, direction: 'up' | 'down') => void;
  /** Persist a full new order after a drag (optional; arrows fall back to onMove). */
  onReorder?: (orderedIds: string[]) => void;
}

/**
 * s137: one grid for the header and every row (lg, 1024 px, and wider): drag · colour · Name · Status · Tasks · Visible ·
 * ↑↓ · Delete, the whole table at most 960 px wide. Narrower, each column is a small card (the same controls).
 */
const ROW_GRID = 'lg:grid lg:grid-cols-[1.75rem_1.75rem_minmax(8rem,28rem)_9.5rem_4rem_4.5rem_5rem_2.75rem] lg:items-center lg:gap-2';
/** 44 px on a phone and on any touch screen; compact with a mouse. */
const TAP = 'max-lg:h-11 max-lg:w-11 [@media(pointer:coarse)]:h-11'; // the table's cells keep their widths on a touch screen
const TAP_FIELD = 'max-lg:min-h-11 [@media(pointer:coarse)]:min-h-11';
/** A text button: its height (the compact density's min-height rule would beat a min-height). */
const TAP_BUTTON = 'max-lg:h-11 [@media(pointer:coarse)]:h-11';

const taskWord = (n: number) => `${n} ${n === 1 ? 'task' : 'tasks'}`;

/**
 * Admin column management: add / rename / remap status / show-hide / reorder / delete (T7.5). 1.23.8: no
 * colour picker — one colour scheme (owner, 7 Nov): a column wears its status kind's colour, so every board
 * looks the same. s137 (1.23.37): a compact table with each column's task count; Delete waits, saying why,
 * while a column holds tasks; a new column's status is chosen as it is added.
 */
export function ColumnManager({
  columns,
  onAdd,
  onRename,
  onSetCategory,
  onToggleEnabled,
  onDelete,
  onMove,
  onReorder,
}: ColumnManagerProps) {
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState<ColumnCategory>('TODO');
  const [nameError, setNameError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const ordered = [...columns].sort((a, b) => a.position - b.position);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = ordered.map((c) => c.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onReorder?.(arrayMove(ids, from, to));
  }

  return (
    <div data-testid="columns-table" className="flex max-w-[960px] flex-col gap-3">
      <div>
        <div data-testid="columns-head" className={`hidden px-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3 ${ROW_GRID}`}>
          <span aria-hidden />
          <span aria-hidden />
          <span>Name</span>
          <span>Status</span>
          <span className="text-center">Tasks</span>
          <span className="text-center">Visible</span>
          <span className="text-center">Order</span>
          <span aria-hidden />
        </div>
        <p className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 px-2 text-xs text-ink-3">
          <span>Colours follow the status</span>
          <span>Hidden columns keep their tasks</span>
        </p>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={ordered.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-col gap-2 lg:gap-1.5">
            {ordered.map((c, i) => (
              <ColumnRow
                key={c.id}
                col={c}
                first={i === 0}
                last={i === ordered.length - 1}
                confirming={confirmingId === c.id}
                onRename={onRename}
                onSetCategory={onSetCategory}
                onToggleEnabled={onToggleEnabled}
                onMove={onMove}
                onAskDelete={() => setConfirmingId(c.id)}
                onCancelDelete={() => setConfirmingId(null)}
                onConfirmDelete={() => { onDelete(c.id); setConfirmingId(null); }}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      {/* Add a column: its name and status at once. */}
      <form
        className="rounded-xl border border-dashed border-line bg-ground/40 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          const v = newName.trim();
          if (!v) {
            setNameError('Column name is required.');
            nameRef.current?.focus();
            return;
          }
          onAdd(v, newCategory);
          setNewName('');
          setNewCategory('TODO');
          setNameError(null);
        }}
      >
        <FieldLabel htmlFor="new-column-name" required>
          Add a column
        </FieldLabel>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <input
            id="new-column-name"
            ref={nameRef}
            dir="auto"
            value={newName}
            required
            aria-required="true"
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? 'new-column-error' : undefined}
            onChange={(e) => {
              setNewName(e.target.value);
              if (nameError) setNameError(null);
            }}
            placeholder="e.g. In Review"
            className={fieldClass(!!nameError, `min-w-0 flex-1 basis-48 lg:max-w-[28rem] ${TAP_FIELD}`)}
          />
          <select
            aria-label="Status of the new column"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value as ColumnCategory)}
            className={fieldClass(false, `w-full flex-none sm:w-[9.5rem] ${TAP_FIELD}`)}
          >
            {STATUS_ORDER.map((cat) => <option key={cat} value={cat}>{statusMeta(cat).label}</option>)}
          </select>
          <button
            type="submit"
            className={`inline-flex flex-none items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-sm font-semibold text-white shadow-brand transition-colors hover:bg-brand-2 max-sm:w-full max-sm:justify-center ${TAP_BUTTON}`}
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            Add column
          </button>
        </div>
        <FieldError id="new-column-error">{nameError}</FieldError>
      </form>
    </div>
  );
}

interface ColumnRowProps {
  col: ManagedColumn;
  first: boolean;
  last: boolean;
  confirming: boolean;
  onRename: (id: string, name: string) => void;
  onSetCategory?: (id: string, category: ColumnCategory) => void;
  onToggleEnabled: (id: string, enabled: boolean) => void;
  onMove: (id: string, direction: 'up' | 'down') => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}

function ColumnRow({ col, first, last, confirming, onRename, onSetCategory, onToggleEnabled, onMove, onAskDelete, onCancelDelete, onConfirmDelete }: ColumnRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: col.id });
  const reasonId = useId();
  const [saidWhy, setSaidWhy] = useState<string | null>(null);
  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };
  const meta = statusMeta(col.category);
  const count = col.taskCount;
  // Today's rule (the server's): a column with live tasks stays until they are moved.
  const cantDelete = count !== undefined && count > 0 ? `Move its ${taskWord(count)} first` : null;
  const iconButton = `grid h-8 w-8 flex-none place-items-center rounded-lg transition-colors ${TAP}`;

  return (
    <li
      ref={setNodeRef}
      style={style}
      aria-label={col.name}
      className={`flex flex-col gap-2 rounded-xl border bg-surface p-2 transition-colors lg:gap-y-1 lg:py-1.5 lg:pl-1 ${ROW_GRID} ${isDragging ? 'border-brand/40 shadow-lift' : 'border-line'} ${col.enabled ? '' : 'opacity-70'}`}
    >
      {/* Top of a phone's card: drag, colour, name and status. */}
      <div className="flex flex-wrap items-center gap-2 lg:contents">
        <button
          type="button"
          aria-label={`Drag ${col.name}`}
          {...attributes}
          {...listeners}
          className={`grid h-8 w-7 flex-none cursor-grab touch-none place-items-center rounded text-ink-3 transition-colors hover:text-ink active:cursor-grabbing ${TAP}`}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" /></svg>
        </button>

        {/* Its colour: its status kind's (1.23.8 one scheme), named for screen readers. */}
        <span role="img" aria-label={`${col.name}: ${meta.label} colour`} title={`${meta.label} colour`} className={`h-6 w-6 flex-none rounded-md border border-line shadow-soft ${statusClass(col.category).dot}`} />

        <input
          aria-label={`Name of ${col.name}`}
          dir="auto"
          defaultValue={col.name}
          onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== col.name) onRename(col.id, v); }}
          className={fieldClass(false, `min-w-0 flex-1 font-medium lg:w-full ${TAP_FIELD}`)}
        />

        {onSetCategory ? (
          <select
            aria-label={`Status of ${col.name}`}
            value={col.category}
            onChange={(e) => onSetCategory(col.id, e.target.value as ColumnCategory)}
            className={fieldClass(false, `w-full flex-none ${TAP_FIELD}`)}
          >
            {STATUS_ORDER.map((cat) => <option key={cat} value={cat}>{statusMeta(cat).label}</option>)}
          </select>
        ) : (
          <span className="inline-flex w-full flex-none items-center gap-1.5 rounded-md bg-ground px-2 py-1 text-xs font-medium text-ink-2">
            <span className={`h-2 w-2 rounded-full ${statusClass(col.category).dot}`} aria-hidden />
            {meta.label}
          </span>
        )}
      </div>

      {/* Bottom of a phone's card: its tasks, Visible, the arrows and Delete. */}
      <div className="flex items-center justify-between gap-2 lg:contents">
        <span className="text-sm tabular-nums text-ink-2 lg:text-center">
          <span aria-hidden>
            {count === undefined ? '–' : count}
            <span className="lg:hidden"> {count === 1 ? 'task' : 'tasks'}</span>
          </span>
          <span className="sr-only">{count === undefined ? 'Task count not known' : taskWord(count)}</span>
        </span>

        <label className={`flex flex-none items-center justify-center gap-2 lg:justify-self-center ${TAP_FIELD}`} title={col.enabled ? 'Visible on the board' : 'Hidden from the board'}>
          <span className="text-xs text-ink-2 lg:hidden" aria-hidden>Visible</span>
          <input type="checkbox" aria-label={`Enable ${col.name}`} checked={col.enabled} onChange={(e) => onToggleEnabled(col.id, e.target.checked)} className="peer sr-only" />
          {/* The knob is inside the track, so it is moved from the track (`peer-checked` only reaches siblings of the box). */}
          <span data-switch-track className="relative h-5 w-9 cursor-pointer rounded-full bg-line transition-colors peer-checked:bg-brand peer-checked:[&>span]:translate-x-4 peer-focus-visible:ring-2 peer-focus-visible:ring-brand/40">
            <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform" />
          </span>
        </label>

        <div className="flex flex-none items-center justify-center gap-0.5">
          <button type="button" onClick={() => onMove(col.id, 'up')} disabled={first} aria-label={`Move ${col.name} up`} className={`${iconButton} text-ink-2 hover:bg-ground hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent`}>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 15l-6-6-6 6" /></svg>
          </button>
          <button type="button" onClick={() => onMove(col.id, 'down')} disabled={last} aria-label={`Move ${col.name} down`} className={`${iconButton} text-ink-2 hover:bg-ground hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent`}>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
          </button>
        </div>

        <button
          type="button"
          onClick={() => (cantDelete ? setSaidWhy(cantDelete) : onAskDelete())}
          aria-label={`Delete ${col.name}`}
          aria-disabled={cantDelete ? true : undefined}
          aria-describedby={cantDelete ? reasonId : undefined}
          aria-expanded={cantDelete ? undefined : confirming}
          title={cantDelete ?? undefined}
          className={`${iconButton} lg:justify-self-center ${cantDelete ? 'cursor-not-allowed text-ink-3 opacity-40' : confirming ? 'bg-danger-soft text-danger' : 'text-ink-3 hover:bg-danger-soft hover:text-danger'}`}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6M10 11v6M14 11v6" /></svg>
        </button>
        {cantDelete ? <span id={reasonId} className="sr-only">{cantDelete}</span> : null}
      </div>

      {/* The confirmation, under the row (a 44 px cell has no room for two buttons). */}
      {confirming && !cantDelete ? (
        <div className="flex flex-wrap items-center justify-end gap-2 lg:col-[3/-1] lg:pb-1">
          <span className="me-auto text-xs text-ink-2">Delete the “{col.name}” column?</span>
          <button type="button" onClick={onConfirmDelete} className={`rounded-lg bg-danger px-3 py-1 text-xs font-semibold text-white transition-colors hover:brightness-95 ${TAP_BUTTON}`}>Delete</button>
          <button type="button" onClick={onCancelDelete} aria-label={`Cancel deleting ${col.name}`} className={`rounded-lg px-3 py-1 text-xs font-medium text-ink-2 transition-colors hover:bg-ground ${TAP_BUTTON}`}>Cancel</button>
        </div>
      ) : null}

      {/* Pressed while it can't go: the reason, under the row. */}
      {cantDelete && saidWhy === cantDelete ? (
        <p role="status" className="text-xs text-ink-2 lg:col-[3/-1] lg:pb-1">{cantDelete}</p>
      ) : null}
    </li>
  );
}
