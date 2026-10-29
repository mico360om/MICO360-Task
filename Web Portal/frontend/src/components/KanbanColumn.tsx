import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { DraggableTaskCard } from './DraggableTaskCard';
import type { TaskCardTask } from './TaskCard';
import { CardMenu, type CardMenuItem } from './board/CardMenu';

export interface KanbanColumnData {
  id: string;
  name: string;
  color: string;
  tasks: TaskCardTask[];
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
}

const PLUS = <path d="M12 5v14M5 12h14" />;

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

export function KanbanColumn({ column, onTaskClick, onAddTask, timeZone, cardMenu, dragging = false }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const [collapsed, setCollapsed] = useState(false);

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
        <span className="min-w-[1.5rem] rounded-full bg-ground px-1.5 text-center text-xs font-semibold text-ink-2">{column.tasks.length}</span>
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
      className={`flex min-w-[15rem] flex-1 basis-0 flex-col gap-2 overflow-hidden rounded-2xl border bg-surface/70 p-2.5 transition-all duration-200 ${
        isOver ? 'border-brand/40 bg-brand/5 shadow-card ring-2 ring-brand/30' : 'border-line'
      }`}
    >
      <span className="-mx-2.5 -mt-2.5 h-1" style={{ background: column.color }} aria-hidden="true" />
      <header className="flex items-center justify-between px-1 py-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="h-2.5 w-2.5 flex-none rounded-full ring-2 ring-surface" style={{ background: column.color }} />
          <span dir="auto" className="truncate text-sm font-bold text-ink">{column.name}</span>
          <span className="min-w-[1.25rem] flex-none rounded-full bg-ground px-1.5 text-center text-xs font-semibold tabular-nums text-ink-2">{column.tasks.length}</span>
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
      <div className="flex min-h-[80px] flex-col gap-2.5">
        <SortableContext items={column.tasks.map((t) => t.key)} strategy={verticalListSortingStrategy}>
          {column.tasks.map((task) => {
            const items = cardMenu?.(task.key) ?? null;
            if (!items || items.length === 0) return <DraggableTaskCard key={task.key} task={task} timeZone={timeZone} onClick={() => onTaskClick?.(task.key)} />;
            return (
              <div key={task.key} className="group/card relative">
                <DraggableTaskCard task={task} timeZone={timeZone} onClick={() => onTaskClick?.(task.key)} menuSpace />
                {dragging ? null : <CardMenu taskKey={task.key} items={items} />}
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
              className="group flex flex-1 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-line/70 px-2 py-7 text-center transition-colors hover:border-brand/60 hover:bg-brand/5 focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-ink-3 group-hover:text-brand"><rect x="3" y="3" width="18" height="18" rx="2.5" /><path d="M12 8v8M8 12h8" /></svg>
              <span className="text-xs font-medium text-ink-3">No tasks</span>
              <span className="text-[11px] text-ink-3/80">
                <span className="font-semibold text-brand">Add a task</span> or drop a card here
              </span>
            </button>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-line/70 px-2 py-7 text-center">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-ink-3"><rect x="3" y="3" width="18" height="18" rx="2.5" /><path d="M12 8v8M8 12h8" /></svg>
              <p className="text-xs font-medium text-ink-3">No tasks</p>
              <p className="text-[11px] text-ink-3/80">Drop a card here</p>
            </div>
          )
        ) : null}
      </div>
    </section>
  );
}
