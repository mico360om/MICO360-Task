import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { DraggableTaskCard } from './DraggableTaskCard';
import { TaskCard, type TaskCardTask } from './TaskCard';
import { CardMenu, type CardMenuItem } from './board/CardMenu';
import { SelectAllBox, TaskSelectBox } from './bulk/select-boxes';

/** Bulk changes' Select mode on the board: the cards' boxes and each column's "Select all" box. */
export interface BoardSelect {
  /** Is this card ticked? */
  has: (taskKey: string) => boolean;
  /** A card's box; with Shift, every card from the last one clicked, in this column. */
  onToggle: (taskKey: string, columnId: string, shift: boolean) => void;
  /** A column header's box: every card it shows ticked, some, or none. */
  columnState: (columnId: string) => 'all' | 'some' | 'none';
  onToggleColumn: (columnId: string) => void;
}

export interface KanbanColumnData {
  id: string;
  name: string;
  color: string;
  tasks: TaskCardTask[];
  /** Board search (10 Nov): how many cards it has without the search ("3 of 12"); absent while not searching. */
  total?: number;
}

export interface KanbanColumnProps {
  column: KanbanColumnData;
  onTaskClick?: (taskKey: string) => void;
  /** Start a new task in this column (New task opens with the column chosen); none: read-only. */
  onAddTask?: () => void;
  timeZone?: string;
  /** Each card's "⋯" menu (none: no menu). */
  cardMenu?: (taskKey: string) => CardMenuItem[] | null;
  /** A card is being dragged: the menus step aside (they don't travel with the cards). */
  dragging?: boolean;
  /** The board fits the window: the cards scroll inside the column, under its header. */
  fit?: boolean;
  /** Cards may be dragged (default). False (1.22.3 review): a read-only board — they only open. */
  canDrag?: boolean;
  /** Bulk changes' Select mode (the board's Select button): boxes on the cards and the header. */
  select?: BoardSelect;
}

const PLUS = <path d="M12 5v14M5 12h14" />;

/**
 * A column's count: how many cards it has, or — while the board is searched — how many of them are
 * found: "3 of 12" with a mouse, the shorter "3/12" on a touch screen (its 44px buttons leave the
 * column's name less room), always read out as "3 of 12".
 */
function ColumnCount({ shown, total, className }: { shown: number; total: number | undefined; className: string }) {
  if (total === undefined) return <span data-testid="column-count" className={className}>{shown}</span>;
  return (
    <span data-testid="column-count" className={`relative whitespace-nowrap ${className}`}>
      <span aria-hidden="true">
        {shown}
        <span className="[@media(pointer:coarse)]:hidden"> of </span>
        <span className="hidden [@media(pointer:coarse)]:inline">/</span>
        {total}
      </span>
      <span className="sr-only">{`${shown} of ${total}`}</span>
    </span>
  );
}

/** The "+" that starts a task in this column, in its header (and on its collapsed rail). */
function AddTaskButton({ name, onAddTask }: { name: string; onAddTask: () => void }) {
  return (
    <button
      type="button"
      onClick={onAddTask}
      aria-label={`Add a task to ${name}`}
      title={`Add a task to ${name}`}
      className="grid h-6 w-6 flex-none place-items-center rounded-md text-ink-2 transition-colors hover:bg-ground hover:text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand [@media(pointer:coarse)]:-my-2.5 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
    >
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">{PLUS}</svg>
    </button>
  );
}

export function KanbanColumn({ column, onTaskClick, onAddTask, timeZone, cardMenu, dragging = false, fit = false, canDrag = true, select }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const [collapsed, setCollapsed] = useState(false);
  // Board search (10 Nov): the cards found, of all the column's ("3 of 12"); a card fading out (no longer
  // found after a live change) isn't counted, dragged or opened.
  const searching = column.total !== undefined;
  const found = column.tasks.filter((t) => !t.leaving);

  // Collapsed: a slim vertical rail (still a drop target) that clicks open again.
  if (collapsed) {
    return (
      <section
        ref={setNodeRef}
        aria-label={column.name}
        className={`flex w-12 flex-none flex-col items-center gap-3 rounded-2xl border bg-surface/70 py-3 transition-all duration-200 ${
          isOver ? 'border-brand/40 bg-brand/5 ring-2 ring-brand/30' : 'border-line'
        }`}
      >
        <button
          onClick={() => setCollapsed(false)}
          aria-label={`Expand ${column.name}`}
          className="grid h-6 w-6 place-items-center rounded-md text-ink-2 transition-colors hover:bg-ground hover:text-brand [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
        </button>
        <ColumnCount shown={found.length} total={column.total} className="min-w-[1.5rem] rounded-full bg-ground px-1.5 text-center text-xs font-semibold text-ink-2" />
        {onAddTask ? <AddTaskButton name={column.name} onAddTask={onAddTask} /> : null}
        <span dir="auto" className="flex-1 whitespace-nowrap text-sm font-bold text-ink [writing-mode:vertical-rl]">{column.name}</span>
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: column.color }} aria-hidden="true" />
      </section>
    );
  }

  return (
    <section
      ref={setNodeRef}
      aria-label={column.name}
      className={`flex min-w-[var(--board-col,15rem)] flex-1 basis-0 flex-col gap-2 overflow-hidden rounded-2xl border bg-surface/70 p-2.5 transition-all duration-200 ${fit ? 'min-h-0' : ''} ${
        isOver ? 'border-brand/40 bg-brand/5 shadow-card ring-2 ring-brand/30' : 'border-line'
      }`}
    >
      <span className="-mx-2.5 -mt-2.5 h-1" style={{ background: column.color }} aria-hidden="true" />
      {/* A long name wraps onto a second line, and past that gives its full name on hover. */}
      <header className="flex flex-none items-center justify-between gap-1 px-1 py-0.5">
        <div className="flex min-w-0 items-center gap-2">
          {select && column.tasks.length > 0 ? (
            <label className="-my-1 grid h-6 w-6 flex-none cursor-pointer place-items-center [@media(pointer:coarse)]:-my-2.5 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11">
              <SelectAllBox state={select.columnState(column.id)} onChange={() => select.onToggleColumn(column.id)} label={`Select every task in ${column.name}`} className="h-4 w-4 cursor-pointer accent-brand" />
            </label>
          ) : null}
          <span className="h-2.5 w-2.5 flex-none rounded-full ring-2 ring-surface" style={{ background: column.color }} />
          <span dir="auto" title={column.name} className="line-clamp-2 break-words text-sm font-bold leading-tight text-ink">{column.name}</span>
          <ColumnCount shown={found.length} total={column.total} className="min-w-[1.25rem] flex-none rounded-full bg-ground px-1.5 text-center text-xs font-semibold tabular-nums text-ink-2" />
        </div>
        <div className="flex flex-none items-center gap-0.5">
          {onAddTask ? <AddTaskButton name={column.name} onAddTask={onAddTask} /> : null}
          <button
            onClick={() => setCollapsed(true)}
            aria-label={`Collapse ${column.name}`}
            className="grid h-6 w-6 flex-none place-items-center rounded-md text-ink-2 transition-colors hover:bg-ground hover:text-brand [@media(pointer:coarse)]:-my-2.5 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
        </div>
      </header>
      {/* Fitted to the window, the cards scroll here (the header above stays); the padding keeps a
          card's ring and lift inside the scroll area's edges. data-column-scroll: see board-collision. */}
      <div
        // Compact rows (1.23.0, lib/density): the cards closer together.
        className={fit ? '-mx-1 flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto overscroll-contain px-1 pb-1 pt-0.5 compact:gap-1.5' : 'flex min-h-[80px] flex-col gap-2.5 compact:gap-1.5'}
        {...(fit ? { 'data-column-scroll': '' } : {})}
      >
        <SortableContext items={found.map((t) => t.key)} strategy={verticalListSortingStrategy}>
          {column.tasks.map((task) => {
            if (task.leaving) {
              // Fades out where it was, then the board drops it (Board: useLeavingCards).
              return (
                <div key={task.key} data-leaving={task.key} aria-hidden="true" className="pointer-events-none animate-scrim-out">
                  <TaskCard task={task} timeZone={timeZone} interactive={false} />
                </div>
              );
            }
            const items = cardMenu?.(task.key) ?? null;
            const card =
              !items || items.length === 0 ? (
                <DraggableTaskCard key={task.key} task={task} timeZone={timeZone} onClick={() => onTaskClick?.(task.key)} disabled={!canDrag} />
              ) : (
                <div key={task.key} className="group/card relative">
                  <DraggableTaskCard task={task} timeZone={timeZone} onClick={() => onTaskClick?.(task.key)} menuSpace disabled={!canDrag} />
                  {dragging ? null : <CardMenu taskKey={task.key} items={items} />}
                </div>
              );
            if (!select) return card;
            // Select mode: the card's box beside it (never inside the card, which is its own button).
            const ticked = select.has(task.key);
            return (
              <div key={task.key} className="flex items-start gap-1">
                <TaskSelectBox task={task} checked={ticked} onChange={(shift) => select.onToggle(task.key, column.id, shift)} className="-ms-1 mt-1" />
                <div className={`min-w-0 flex-1 rounded-xl ${ticked ? 'ring-2 ring-brand/50' : ''}`}>{card}</div>
              </div>
            );
          })}
        </SortableContext>
        {column.tasks.length === 0 ? (
          onAddTask ? (
            // The empty box is itself the way to start the column's first task.
            <button
              type="button"
              onClick={onAddTask}
              className="group flex flex-1 flex-col items-center justify-start gap-1.5 rounded-xl border border-dashed border-line/70 px-2 py-7 text-center transition-colors max-md:flex-none hover:border-brand/60 hover:bg-brand/5 focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-ink-3 group-hover:text-brand"><rect x="3" y="3" width="18" height="18" rx="2.5" /><path d="M12 8v8M8 12h8" /></svg>
              <span className="text-xs font-medium text-ink-3">{searching ? 'No matching cards' : 'No tasks'}</span>
              <span className="text-xs text-ink-3">
                <span className="font-semibold text-brand">Add a task</span> or drop a card here
              </span>
            </button>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-start gap-1.5 rounded-xl border border-dashed border-line/70 px-2 py-7 text-center max-md:flex-none">
              {canDrag ? <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-ink-3"><rect x="3" y="3" width="18" height="18" rx="2.5" /><path d="M12 8v8M8 12h8" /></svg> : null}
              <p className="text-xs font-medium text-ink-3">{searching ? 'No matching cards' : 'No tasks'}</p>
              {canDrag ? <p className="text-xs text-ink-3">Drop a card here</p> : null}
            </div>
          )
        ) : null}
      </div>
    </section>
  );
}
