import { Avatar } from './ui/Avatar';
import { PriorityBadge, type Priority } from './ui/PriorityBadge';

export interface TaskCardTask {
  key: string;
  title: string;
  priority: Priority;
  dueDate?: string | null;
  progress: number;
  assignees: { id: string; name: string }[];
  counts?: { comments: number; attachments: number; checklistDone: number; checklistTotal: number };
  /** The card's column colour — drawn as a left status stripe so cards read as belonging to their stage. */
  accentColor?: string;
  /** True when the task sits in a BLOCKED-category column, for an at-a-glance "Blocked" flag. */
  blocked?: boolean;
}

export interface TaskCardProps {
  task: TaskCardTask;
  onClick?: () => void;
}

function parseDate(dueDate?: string | null): Date | null {
  if (!dueDate) return null;
  const d = new Date(dueDate);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isOverdue(dueDate?: string | null): boolean {
  const d = parseDate(dueDate);
  return d !== null && d.getTime() < Date.now();
}

function formatDate(dueDate?: string | null): string {
  const d = parseDate(dueDate);
  return d ? d.toLocaleDateString() : 'No due date';
}

/** A small icon + number badge (checklist / comments / attachments), shown only when relevant. */
function CountBadge({ label, value, children }: { label: string; value: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-0.5 text-[11px] text-ink-2" aria-label={label} title={label}>
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {children}
      </svg>
      {value}
    </span>
  );
}

export function TaskCard({ task, onClick }: TaskCardProps) {
  const overdue = isOverdue(task.dueDate);
  const hasDue = Boolean(task.dueDate);
  const c = task.counts;
  const shownAssignees = task.assignees.slice(0, 3);
  const extra = task.assignees.length - shownAssignees.length;

  // One base card; overdue and blocked add an unmistakable ring so they pop within a column.
  const stateCls = overdue
    ? 'border-line ring-1 ring-danger/50 hover:border-danger/50'
    : task.blocked
      ? 'border-line ring-1 ring-warning/50 hover:border-warning/50'
      : 'border-line hover:border-brand/40';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick?.();
        }
      }}
      className={`group relative flex cursor-pointer flex-col gap-2 overflow-hidden rounded-xl border bg-surface p-3 pl-3.5 text-left shadow-soft outline-none transition-all duration-200 ease-emphasized hover:-translate-y-0.5 hover:shadow-card ${stateCls}`}
    >
      {/* Status stripe in the column colour, so a card always reads as belonging to its stage. */}
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: task.accentColor ?? 'transparent' }} aria-hidden="true" />

      <div className="flex items-center justify-between gap-2">
        <span className="rounded bg-ground px-1.5 py-0.5 font-mono text-[11px] text-ink-2">{task.key}</span>
        <div className="flex flex-none items-center gap-1.5">
          {task.blocked ? (
            <span className="inline-flex items-center gap-1 rounded bg-danger-soft px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-danger">
              <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M6 6l12 12" /></svg>
              Blocked
            </span>
          ) : null}
          <PriorityBadge priority={task.priority} />
        </div>
      </div>

      <div className="line-clamp-2 text-sm font-medium leading-snug text-ink transition-colors group-hover:text-brand">{task.title}</div>

      {hasDue || (c && (c.checklistTotal > 0 || c.comments > 0 || c.attachments > 0)) ? (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          {hasDue ? (
            <span
              className={`inline-flex items-center gap-1 rounded px-1 text-[11px] ${overdue ? 'bg-danger-soft font-semibold text-danger' : 'text-ink-2'}`}
            >
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
              </svg>
              {overdue ? `Overdue · ${formatDate(task.dueDate)}` : formatDate(task.dueDate)}
            </span>
          ) : null}
          {c && c.checklistTotal > 0 ? (
            <CountBadge label="Subtasks done" value={`${c.checklistDone}/${c.checklistTotal}`}>
              <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </CountBadge>
          ) : null}
          {c && c.comments > 0 ? (
            <CountBadge label="Comments" value={String(c.comments)}>
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </CountBadge>
          ) : null}
          {c && c.attachments > 0 ? (
            <CountBadge label="Attachments" value={String(c.attachments)}>
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </CountBadge>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-1 items-center gap-1.5">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ground" aria-label={`Progress ${task.progress}%`}>
            <div className="h-full rounded-full bg-brand-sheen transition-[width] duration-500 ease-emphasized" style={{ width: `${task.progress}%` }} />
          </div>
          <span className="w-7 flex-none text-right text-[10px] tabular-nums text-ink-3">{task.progress}%</span>
        </div>
        {task.assignees.length > 0 ? (
          <div className="flex flex-none items-center gap-1">
            {task.assignees.length === 1 ? (
              <span className="max-w-[6rem] truncate text-[11px] text-ink-2">{task.assignees[0]!.name}</span>
            ) : null}
            <div className="flex -space-x-1.5">
              {shownAssignees.map((a) => (
                <Avatar key={a.id} name={a.name} size="sm" />
              ))}
              {extra > 0 ? (
                <span className="grid h-6 w-6 place-items-center rounded-full border border-line bg-ground text-[10px] font-semibold text-ink-2">
                  +{extra}
                </span>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
