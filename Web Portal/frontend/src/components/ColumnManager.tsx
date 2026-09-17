import { useRef, useState } from 'react';
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
import type { ApiColumn, ColumnCategory } from '../api/columns';

export interface ColumnManagerProps {
  columns: ApiColumn[];
  onAdd: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onSetColor: (id: string, color: string) => void;
  /** Change which Kanban status this column maps to (optional). */
  onSetCategory?: (id: string, category: ColumnCategory) => void;
  onToggleEnabled: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, direction: 'up' | 'down') => void;
  /** Persist a full new order after a drag (optional; arrows fall back to onMove). */
  onReorder?: (orderedIds: string[]) => void;
}

/** Admin column management: add / rename / recolour / remap status / show-hide / reorder / delete (T7.5). */
export function ColumnManager({
  columns,
  onAdd,
  onRename,
  onSetColor,
  onSetCategory,
  onToggleEnabled,
  onDelete,
  onMove,
  onReorder,
}: ColumnManagerProps) {
  const [newName, setNewName] = useState('');
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
    <div className="flex flex-col gap-3">
      <div className="hidden items-center gap-3 px-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3 sm:flex">
        <span className="w-5" aria-hidden />
        <span className="w-7" aria-hidden />
        <span className="flex-1">Column</span>
        <span className="w-36">Mapped status</span>
        <span className="w-16 text-center">Visible</span>
        <span className="w-24 text-right">Reorder</span>
        <span className="w-8" aria-hidden />
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={ordered.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-col gap-2">
            {ordered.map((c, i) => (
              <ColumnRow
                key={c.id}
                col={c}
                first={i === 0}
                last={i === ordered.length - 1}
                confirming={confirmingId === c.id}
                onRename={onRename}
                onSetColor={onSetColor}
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

      {/* Polished add-column panel */}
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
          onAdd(v);
          setNewName('');
          setNameError(null);
        }}
      >
        <FieldLabel htmlFor="new-column-name" required>
          Add a column
        </FieldLabel>
        <div className="mt-1.5 flex items-center gap-2">
          <input
            id="new-column-name"
            ref={nameRef}
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
            className={fieldClass(!!nameError, 'min-w-0 flex-1')}
          />
          <button
            type="submit"
            className="inline-flex flex-none items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-sm font-semibold text-white shadow-brand transition-colors hover:bg-brand-2"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            Add column
          </button>
        </div>
        <FieldError id="new-column-error">{nameError}</FieldError>
        <p className="mt-1.5 text-xs text-ink-3">New columns start as a “To Do” stage — set its mapped status after adding.</p>
      </form>
    </div>
  );
}

interface ColumnRowProps {
  col: ApiColumn;
  first: boolean;
  last: boolean;
  confirming: boolean;
  onRename: (id: string, name: string) => void;
  onSetColor: (id: string, color: string) => void;
  onSetCategory?: (id: string, category: ColumnCategory) => void;
  onToggleEnabled: (id: string, enabled: boolean) => void;
  onMove: (id: string, direction: 'up' | 'down') => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}

function ColumnRow({ col, first, last, confirming, onRename, onSetColor, onSetCategory, onToggleEnabled, onMove, onAskDelete, onCancelDelete, onConfirmDelete }: ColumnRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: col.id });
  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };
  const meta = statusMeta(col.category);

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex flex-wrap items-center gap-2 rounded-xl border bg-surface p-2 pl-1 transition-colors sm:flex-nowrap ${isDragging ? 'border-brand/40 shadow-lift' : 'border-line'} ${col.enabled ? '' : 'opacity-70'}`}
    >
      {/* Drag handle */}
      <button
        type="button"
        aria-label={`Drag ${col.name}`}
        {...attributes}
        {...listeners}
        className="grid h-8 w-5 flex-none cursor-grab touch-none place-items-center rounded text-ink-3 transition-colors hover:text-ink active:cursor-grabbing"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" /></svg>
      </button>

      {/* Colour swatch */}
      <label className="relative h-7 w-7 flex-none cursor-pointer overflow-hidden rounded-lg border border-line shadow-soft" style={{ background: col.color }} title={`Colour ${col.name}`}>
        <input type="color" aria-label={`Colour ${col.name}`} value={col.color} onChange={(e) => onSetColor(col.id, e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
      </label>

      {/* Name */}
      <input
        aria-label={`Name of ${col.name}`}
        defaultValue={col.name}
        onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== col.name) onRename(col.id, v); }}
        className={fieldClass(false, 'min-w-0 flex-1 font-medium')}
      />

      {/* Mapped status */}
      {onSetCategory ? (
        <select
          aria-label={`Status of ${col.name}`}
          value={col.category}
          onChange={(e) => onSetCategory(col.id, e.target.value as ColumnCategory)}
          className={fieldClass(false, 'w-full flex-none sm:w-36')}
        >
          {STATUS_ORDER.map((cat) => <option key={cat} value={cat}>{statusMeta(cat).label}</option>)}
        </select>
      ) : (
        <span className="inline-flex w-full flex-none items-center gap-1.5 rounded-md bg-ground px-2 py-1 text-xs font-medium text-ink-2 sm:w-36">
          <span className="h-2 w-2 rounded-full" style={{ background: meta.color }} aria-hidden />
          {meta.label}
        </span>
      )}

      {/* Visibility toggle */}
      <label className="flex w-16 flex-none items-center justify-center" title={col.enabled ? 'Visible on the board' : 'Hidden from the board'}>
        <input type="checkbox" aria-label={`Enable ${col.name}`} checked={col.enabled} onChange={(e) => onToggleEnabled(col.id, e.target.checked)} className="peer sr-only" />
        <span className="relative h-5 w-9 cursor-pointer rounded-full bg-line transition-colors peer-checked:bg-brand peer-focus-visible:ring-2 peer-focus-visible:ring-brand/40">
          <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4" />
        </span>
      </label>

      {/* Reorder arrows */}
      <div className="flex w-24 flex-none items-center justify-end gap-0.5">
        <button type="button" onClick={() => onMove(col.id, 'up')} disabled={first} aria-label={`Move ${col.name} up`} className="grid h-7 w-7 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-ground hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 15l-6-6-6 6" /></svg>
        </button>
        <button type="button" onClick={() => onMove(col.id, 'down')} disabled={last} aria-label={`Move ${col.name} down`} className="grid h-7 w-7 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-ground hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
        </button>
      </div>

      {/* Delete (with confirmation) */}
      {confirming ? (
        <div className="flex flex-none items-center gap-1">
          <button type="button" onClick={onConfirmDelete} className="rounded-lg bg-danger px-2 py-1 text-xs font-semibold text-white transition-colors hover:brightness-95">Delete</button>
          <button type="button" onClick={onCancelDelete} aria-label={`Cancel deleting ${col.name}`} className="rounded-lg px-2 py-1 text-xs font-medium text-ink-2 transition-colors hover:bg-ground">Cancel</button>
        </div>
      ) : (
        <button type="button" onClick={onAskDelete} aria-label={`Delete ${col.name}`} className="grid h-7 w-8 flex-none place-items-center rounded-lg text-ink-3 transition-colors hover:bg-danger-soft hover:text-danger">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6M10 11v6M14 11v6" /></svg>
        </button>
      )}
    </li>
  );
}
