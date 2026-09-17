import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { DraggableTaskCard } from './DraggableTaskCard';
import type { TaskCardTask } from './TaskCard';

export interface KanbanColumnData {
  id: string;
  name: string;
  color: string;
  tasks: TaskCardTask[];
}

export interface KanbanColumnProps {
  column: KanbanColumnData;
  onTaskClick?: (taskKey: string) => void;
}

export function KanbanColumn({ column, onTaskClick }: KanbanColumnProps) {
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
          className="grid h-6 w-6 place-items-center rounded-md text-ink-2 transition-colors hover:bg-ground hover:text-brand"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
        </button>
        <span className="min-w-[1.5rem] rounded-full bg-ground px-1.5 text-center text-xs font-semibold text-ink-2">{column.tasks.length}</span>
        <span className="flex-1 whitespace-nowrap text-sm font-bold text-ink [writing-mode:vertical-rl]">{column.name}</span>
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
          <span className="truncate text-sm font-bold text-ink">{column.name}</span>
          <span className="min-w-[1.25rem] flex-none rounded-full bg-ground px-1.5 text-center text-xs font-semibold tabular-nums text-ink-2">{column.tasks.length}</span>
        </div>
        <button
          onClick={() => setCollapsed(true)}
          aria-label={`Collapse ${column.name}`}
          className="grid h-6 w-6 flex-none place-items-center rounded-md text-ink-2 transition-colors hover:bg-ground hover:text-brand"
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
      </header>
      <div className="flex min-h-[80px] flex-col gap-2.5">
        <SortableContext items={column.tasks.map((t) => t.key)} strategy={verticalListSortingStrategy}>
          {column.tasks.map((task) => (
            <DraggableTaskCard key={task.key} task={task} onClick={() => onTaskClick?.(task.key)} />
          ))}
        </SortableContext>
        {column.tasks.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-line/70 px-2 py-7 text-center">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-ink-3"><rect x="3" y="3" width="18" height="18" rx="2.5" /><path d="M12 8v8M8 12h8" /></svg>
            <p className="text-xs font-medium text-ink-3">No tasks</p>
            <p className="text-[11px] text-ink-3/80">Drop a card here</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
