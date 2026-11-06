import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { DashboardLayout, LayoutGroup, WidgetId, WidgetPlace, WidgetSize } from '../../api/dashboard';
import { CUSTOMIZE_WORDS, moveBy, movedAnnouncement, moveTo, setSize, toggleHidden, WIDGET_NAME } from '../../lib/dashboard-layout';
import { TOUCH_SQUARE, TOUCH_TALL } from '../../lib/touch';
import { Button } from '../ui/Button';

export type LayoutTarget = 'mine' | LayoutGroup;

export interface CustomizePanelProps {
  isAdmin: boolean;
  target: LayoutTarget;
  onTarget: (target: LayoutTarget) => void;
  draft: DashboardLayout;
  /** A change, and what a screen reader should hear about it. */
  onChange: (layout: DashboardLayout, said: string) => void;
  /** What the live region says (moves, hides, sizes, saves). */
  status: string;
  error: string | null;
  saving: boolean;
  /** The default to arrange has not loaded yet. */
  loading?: boolean;
  onReset: () => void;
  onCancel: () => void;
  onDone: () => void;
}

const SMALL_BUTTON = `grid h-8 w-8 flex-none place-items-center rounded-lg border border-line bg-surface text-ink-2 transition-colors hover:border-brand/30 hover:text-ink disabled:opacity-40 ${TOUCH_SQUARE}`;

/**
 * 1.23.4 "Customize dashboard": each widget in the person's order — drag it by its handle (or Move up /
 * Move down from the keyboard, each move said aloud), show or hide it, make it Small or Wide — then Done
 * saves it to their account. Reset to default goes back to their group's default. An administrator also
 * arranges the two defaults (for administrators, for everyone else) and saves them for everyone.
 */
export function CustomizePanel({ isAdmin, target, onTarget, draft, onChange, status, error, saving, loading, onReset, onCancel, onDone }: CustomizePanelProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const ids = draft.widgets.map((w) => w.id);
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const next = moveTo(draft, active.id as WidgetId, over.id as WidgetId);
    onChange(next, movedAnnouncement(next, active.id as WidgetId));
  };
  const targets: LayoutTarget[] = ['mine', 'admins', 'everyone'];
  const doneLabel = target === 'mine' ? CUSTOMIZE_WORDS.done : `${CUSTOMIZE_WORDS.saveDefault} ${target === 'admins' ? 'for administrators' : 'for everyone else'}`;

  return (
    <section className="card border-brand/30 p-4 sm:p-5" aria-labelledby="customize-heading" data-testid="customize-panel">
      <h2 id="customize-heading" className="font-display text-base font-semibold text-ink">
        {CUSTOMIZE_WORDS.title}
      </h2>
      <p className="mt-0.5 text-sm text-ink-2">{CUSTOMIZE_WORDS.note}</p>
      <p className="mt-0.5 text-xs text-ink-2 lg:hidden">{CUSTOMIZE_WORDS.phoneNote}</p>

      {isAdmin ? (
        <fieldset className="mt-3">
          <legend className="text-xs font-semibold uppercase tracking-wide text-ink-2">{CUSTOMIZE_WORDS.arranging}</legend>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {targets.map((t) => (
              <label
                key={t}
                className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors focus-within:ring-2 focus-within:ring-brand/40 ${TOUCH_TALL} ${
                  target === t ? 'border-brand bg-brand/10 text-brand' : 'border-line bg-surface text-ink-2 hover:text-ink'
                }`}
              >
                <input type="radio" name="dashboard-layout-target" value={t} checked={target === t} onChange={() => onTarget(t)} className="sr-only" />
                {CUSTOMIZE_WORDS[t]}
              </label>
            ))}
          </div>
          {target !== 'mine' ? (
            <p className="mt-1.5 text-xs text-ink-2">
              {CUSTOMIZE_WORDS.defaultNote}
              {target === 'everyone' ? ` ${CUSTOMIZE_WORDS.everyoneNote}` : ''}
            </p>
          ) : null}
        </fieldset>
      ) : null}

      {loading ? (
        <div role="status" aria-label="Loading the default" className="mt-3 flex flex-col gap-2">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="skeleton h-12 rounded-xl" />
          ))}
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ol className="mt-3 flex flex-col gap-2" aria-label="Widgets, in order">
              {draft.widgets.map((w, i) => (
                <WidgetRow
                  key={w.id}
                  place={w}
                  first={i === 0}
                  last={i === draft.widgets.length - 1}
                  onMove={(by) => {
                    const next = moveBy(draft, w.id, by);
                    onChange(next, movedAnnouncement(next, w.id));
                  }}
                  onToggle={() => onChange(toggleHidden(draft, w.id), `${WIDGET_NAME[w.id]} ${w.hidden ? 'shown' : 'hidden'}.`)}
                  onSize={(size) => onChange(setSize(draft, w.id, size), `${WIDGET_NAME[w.id]} is ${size === 'wide' ? 'Wide' : 'Small'}.`)}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}

      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
      {error ? (
        <p role="alert" className="mt-2 text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <Button variant="secondary" size="sm" onClick={onReset} disabled={saving || loading} className={TOUCH_TALL}>
          {CUSTOMIZE_WORDS.reset}
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving} className={TOUCH_TALL}>
            {CUSTOMIZE_WORDS.cancel}
          </Button>
          <Button size="sm" onClick={onDone} loading={saving} disabled={loading} className={TOUCH_TALL}>
            {doneLabel}
          </Button>
        </div>
      </div>
    </section>
  );
}

function WidgetRow({ place, first, last, onMove, onToggle, onSize }: { place: WidgetPlace; first: boolean; last: boolean; onMove: (by: -1 | 1) => void; onToggle: () => void; onSize: (size: WidgetSize) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: place.id });
  const name = WIDGET_NAME[place.id];
  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
    zIndex: isDragging ? 10 : undefined,
  };
  return (
    <li
      ref={setNodeRef}
      style={style}
      data-widget-row={place.id}
      className={`flex flex-wrap items-center gap-2 rounded-xl border p-2 ${isDragging ? 'border-brand/40 shadow-lift' : 'border-line'} ${place.hidden ? 'border-dashed bg-ground' : 'bg-surface'}`}
    >
      <button
        type="button"
        aria-label={`Drag ${name}`}
        {...attributes}
        {...listeners}
        className={`grid h-8 w-6 flex-none cursor-grab touch-none place-items-center rounded text-ink-3 hover:text-ink active:cursor-grabbing ${TOUCH_SQUARE}`}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
          <circle cx="9" cy="6" r="1.6" />
          <circle cx="15" cy="6" r="1.6" />
          <circle cx="9" cy="12" r="1.6" />
          <circle cx="15" cy="12" r="1.6" />
          <circle cx="9" cy="18" r="1.6" />
          <circle cx="15" cy="18" r="1.6" />
        </svg>
      </button>
      <span className="flex min-w-0 flex-1 basis-32 items-center gap-2 text-sm font-medium text-ink">
        <span className="truncate">{name}</span>
        {place.hidden ? <span className="flex-none rounded-md bg-surface px-1.5 py-0.5 text-[11px] font-semibold text-ink-2">Hidden</span> : null}
      </span>
      <div className="flex flex-none items-center gap-1.5">
        <button type="button" className={SMALL_BUTTON} aria-label={`Move ${name} up`} disabled={first} onClick={() => onMove(-1)}>
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 19V5M6 11l6-6 6 6" />
          </svg>
        </button>
        <button type="button" className={SMALL_BUTTON} aria-label={`Move ${name} down`} disabled={last} onClick={() => onMove(1)}>
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 5v14M6 13l6 6 6-6" />
          </svg>
        </button>
        <button type="button" className={SMALL_BUTTON} aria-label={place.hidden ? `Show ${name}` : `Hide ${name}`} aria-pressed={!place.hidden} onClick={onToggle}>
          {place.hidden ? (
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c5.5 0 9 6 9 6a16 16 0 0 1-2.7 3.4M6.6 6.6C4.3 8.1 3 12 3 12s3.5 6 9 6a9 9 0 0 0 4.4-1.1" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z" />
              <circle cx="12" cy="12" r="2.5" />
            </svg>
          )}
        </button>
        <div role="group" aria-label={`${name} size`} className="inline-flex overflow-hidden rounded-lg border border-line">
          {(['small', 'wide'] as const).map((size) => (
            <button
              key={size}
              type="button"
              aria-pressed={place.size === size}
              onClick={() => place.size !== size && onSize(size)}
              className={`px-2.5 py-1 text-xs font-semibold transition-colors ${TOUCH_TALL} ${place.size === size ? 'bg-brand text-white' : 'bg-surface text-ink-2 hover:text-ink'}`}
            >
              {size === 'small' ? 'Small' : 'Wide'}
            </button>
          ))}
        </div>
      </div>
    </li>
  );
}

/** The "Customize dashboard" button's picture: widgets in a grid. */
export function CustomizeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="3" y="13.5" width="18" height="7.5" rx="1.5" />
    </svg>
  );
}
