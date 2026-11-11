import type { HTMLAttributes } from 'react';
import { Avatar } from './ui/Avatar';
import { ProjectAvatar } from './ProjectAvatar';
import { PriorityBadge, type Priority } from './ui/PriorityBadge';
import { daysUntilDue, isOverdue } from '../lib/due-date';
import { formatDueDay } from '../lib/due-display';
import { instantDayText } from '../lib/day-words';
import { DEFAULT_TIME_ZONE } from '../lib/company-clock';
import { InspectionChip } from './inspections/inspection-ui';
import { ApprovalChip } from './approvals/ApprovalChip';
import type { ExternalContactSummary } from '../lib/external-contacts';
import { ExternalContactsLine } from './ExternalContactsLine';
import { TaskKey } from './TaskKey';
import { DENSE_FACE, DENSE_STACK, DENSE_TEXT } from '../lib/density-tokens';
import { useDensity } from '../lib/density';
import { DUE_SOON_CLASS, OVERDUE_CLASS, STATUS_CLASS } from '../lib/colour-classes';
import { DescriptionLine, PeopleLine, TagChips, type TagLike } from './DetailLines';

export interface TaskCardTask {
  key: string;
  title: string;
  priority: Priority;
  dueDate?: string | null;
  progress: number;
  /** Avatar hotfix (owner, 10 Nov): each face shows their photo; initials without one. */
  assignees: { id: string; name: string; avatarUrl?: string | null }[];
  counts?: { comments: number; attachments: number; checklistDone: number; checklistTotal: number };
  /**
   * Its status's colour (1.23.8: the column's kind in the one scheme, lib/colour-classes) — drawn as a left
   * stripe so cards read as belonging to their stage.
   */
  accentColor?: string;
  /** True when the task sits in a BLOCKED-category column, for an at-a-glance "Blocked" flag. */
  blocked?: boolean;
  /** True when the task repeats (it is the newest copy of a recurring series). */
  recurring?: boolean;
  /** True for a milestone (a key date or deliverable of the project). */
  milestone?: boolean;
  /** Shown on the project's client page (staff see a small mark). */
  clientVisible?: boolean;
  /** 1.23: when a client accepted it in the Client portal (a small mark; the day on hover). */
  clientAcceptedAt?: string | null;
  /** Carries an inspection form (a check): opening it starts the checklist. */
  inspection?: boolean;
  /** Finished, waiting for a project manager's approval (not done yet). */
  awaitingApproval?: boolean;
  /** True when the task is finished (DONE column or completed) — a finished task is never overdue. */
  done?: boolean;
  /** Its project, on a board showing several projects (the All projects board). */
  project?: { name: string; code: string; color?: string | null; icon?: string | null; imageUrl?: string | null };
  /** Its external contacts in short ("External: Ahmed Al Said (OXY) and 2 more"); null or absent for none. */
  external?: ExternalContactSummary | null;
  /** The board's month view: its dates in the month ("5–20 Nov", "Overdue · from Oct"), shown instead of the due date. */
  dateLine?: { text: string; overdue: boolean; title?: string };
  /** 1.23.8 Detailed cards: its description (the first line shows) and its tags. */
  description?: string | null;
  tags?: TagLike[];
}

export interface TaskCardProps {
  task: TaskCardTask;
  onClick?: () => void;
  /** Company time zone: "overdue" means the due day is before today there (not the device's today). */
  timeZone?: string;
  /**
   * False when a wrapper (the draggable card on the board) is the focusable, keyboard-operable
   * element — the card then renders as plain content so there is one tab stop per card.
   */
  interactive?: boolean;
  /** Leave room in the top corner for the card's "⋯" menu (drawn beside the card, over this corner). */
  menuSpace?: boolean;
}

/** A milestone's flag. */
export function MilestoneIcon({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 21V4" />
      <path d="M5 4h11l-2 4 2 4H5" fill="currentColor" fillOpacity="0.18" />
    </svg>
  );
}

/** The "Visible to client" mark: an eye (the project's client page shows this task). */
export function ClientEyeIcon({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** 1.23: "Client accepted · 30 Oct 2026" on a card — a tick in a circle, the day on hover. */
function ClientAcceptedIcon({ at, timeZone }: { at: string; timeZone: string }) {
  const day = instantDayText(at, timeZone);
  const label = day ? `Client accepted · ${day}` : 'Client accepted';
  return (
    <span className="text-success" role="img" aria-label={label} title={label}>
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="m8 12.5 2.7 2.7L16 9.5" />
      </svg>
    </span>
  );
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

export function TaskCard({ task, onClick, timeZone = DEFAULT_TIME_ZONE, interactive = true, menuSpace = false }: TaskCardProps) {
  // Calendar-day rule in the company zone; finished work is never flagged overdue, nor work waiting
  // for approval (its badge says so instead: owner, 30 Oct).
  const overdue = !task.done && !task.awaitingApproval && isOverdue(task.dueDate, timeZone);
  const dueText = formatDueDay(task.dueDate, timeZone) || 'No due date';
  // 1.23.8: due today or tomorrow (not finished, not waiting): amber, in words too.
  const daysLeft = task.done || task.awaitingApproval ? null : daysUntilDue(task.dueDate, timeZone);
  const soon = daysLeft === 0 ? 'Due today' : daysLeft === 1 ? 'Due tomorrow' : null;
  // Detailed (1.23.8, lib/density): the whole title, the description's first line, the tags and everyone on it.
  const detailed = useDensity() === 'detailed';
  // The month view gives its own line (a span, "From 5 Nov", "No date"), shown even without a due date.
  const line = task.dateLine;
  const hasDue = Boolean(line) || Boolean(task.dueDate);
  const dateLate = line ? line.overdue : overdue;
  const c = task.counts;
  const shownAssignees = detailed ? task.assignees : task.assignees.slice(0, 3);
  const extra = task.assignees.length - shownAssignees.length;

  return (
    <div
      {...(interactive
        ? ({
            role: 'button',
            tabIndex: 0,
            onKeyDown: (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick?.();
              }
            },
          } satisfies HTMLAttributes<HTMLDivElement>)
        : {})}
      onClick={onClick}
      // Compact rows (1.23.0, lib/density): a third less padding and room inside, the title a step smaller.
      // One border for every card, overdue or not (owner, 10 Nov: the red edge went; the Overdue badge and
      // the status stripe say it). A blocked one's stripe is the Blocked red and its chip says so.
      className="group relative flex cursor-pointer flex-col gap-2 overflow-hidden rounded-xl border border-line bg-surface p-3 pl-3.5 text-left shadow-soft compact:gap-1.5 compact:p-2 compact:pl-2.5 outline-none transition-all duration-200 ease-emphasized hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-card"
    >
      {/* Status stripe in its status's colour, so a card always reads as belonging to its stage. */}
      <span data-card-stripe className="absolute inset-y-0 left-0 w-1" style={{ background: task.accentColor ?? 'transparent' }} aria-hidden="true" />

      {task.project ? (
        <span data-testid="card-project" className={`flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-ink-2 ${menuSpace ? 'pr-7 [@media(pointer:coarse)]:pr-11' : ''}`}>
          <ProjectAvatar project={task.project} size="xs" />
          <span dir="auto" title={task.project.name} className="truncate">{task.project.name}</span>
        </span>
      ) : null}

      {/* The number never shrinks under the flags (a long one, e.g. TN2FF00336-2, once ran under the
          milestone flag): in a narrow column the flags and the priority wrap to the next line instead. */}
      <div className={`flex flex-wrap items-center justify-between gap-x-2 gap-y-1 ${menuSpace && !task.project ? 'pr-7 [@media(pointer:coarse)]:pr-11' : ''}`}>
        <TaskKey value={task.key} dense="compact" />
        <div className="flex flex-none items-center gap-1.5">
          {task.blocked ? (
            <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${STATUS_CLASS.BLOCKED.chip}`}>
              <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M6 6l12 12" /></svg>
              Blocked
            </span>
          ) : null}
          {task.milestone ? (
            <span className="text-brand" role="img" aria-label="Milestone" title="Milestone">
              <MilestoneIcon size={13} />
            </span>
          ) : null}
          {task.clientVisible ? (
            <span className="text-info" role="img" aria-label="Visible to client" title="Visible to client">
              <ClientEyeIcon size={13} />
            </span>
          ) : null}
          {task.clientAcceptedAt ? <ClientAcceptedIcon at={task.clientAcceptedAt} timeZone={timeZone} /> : null}
          {task.recurring ? (
            <span className="text-ink-3" role="img" aria-label="Repeats" title="Repeats">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17 2l4 4-4 4" /><path d="M3 11V9a3 3 0 0 1 3-3h15" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v2a3 3 0 0 1-3 3H3" /></svg>
            </span>
          ) : null}
          <PriorityBadge priority={task.priority} />
        </div>
      </div>

      <div dir="auto" className={`${detailed ? 'break-words' : 'line-clamp-2'} text-start text-sm font-medium leading-snug text-ink transition-colors group-hover:text-brand ${DENSE_TEXT}`}>{task.title}</div>
      {detailed ? <DescriptionLine description={task.description} className="-mt-1" /> : null}
      <ExternalContactsLine summary={task.external} />
      {detailed ? <TagChips tags={task.tags} /> : null}

      {/* A check's chip leads the line of facts (it wraps there; beside the key, with the priority and
          the flags, it overlapped them in a narrow column and broke the key in two). */}
      {task.awaitingApproval || task.inspection || hasDue || (c && (c.checklistTotal > 0 || c.comments > 0 || c.attachments > 0)) ? (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          {task.awaitingApproval ? <ApprovalChip /> : null}
          {task.inspection ? <InspectionChip /> : null}
          {hasDue ? (
            // Overdue: a badge, the scheme's overdue words on its pale tint (owner, 10 Nov) — dark red on pale
            // red, light red on a dark red wash in dark mode. Other dates stay plain words.
            <span
              data-testid="card-date"
              title={line?.title}
              className={`inline-flex items-center gap-1 text-[11px] ${dateLate ? `rounded-full px-2 py-0.5 font-semibold ${OVERDUE_CLASS.chip}` : soon && !line ? `rounded px-1 ${DUE_SOON_CLASS.text} font-semibold` : 'rounded px-1 text-ink-2'}`}
            >
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
              </svg>
              {line ? (
                // The month view's line; a carried card's due day is read out too (on hover it's the title).
                <>
                  {line.text}
                  {line.title ? <span className="sr-only"> ({line.title})</span> : null}
                </>
              ) : (
                <>
                  {soon && !overdue ? `${soon} · ` : null}
                  {overdue ? `Overdue · ${dueText}` : dueText}
                </>
              )}
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
          <span className="w-8 flex-none text-right text-[11px] tabular-nums text-ink-3">{task.progress}%</span>
        </div>
        {task.assignees.length > 0 ? (
          <div className="flex flex-none items-center gap-1">
            {task.assignees.length === 1 ? (
              <span dir="auto" className="max-w-[6rem] truncate text-[11px] text-ink-2">{task.assignees[0]!.name}</span>
            ) : null}
            <div className={`flex ${detailed ? 'flex-wrap justify-end gap-y-0.5' : ''} -space-x-1.5 ${DENSE_STACK}`}>
              {shownAssignees.map((a) => (
                <Avatar key={a.id} name={a.name} src={a.avatarUrl} size="sm" dense />
              ))}
              {extra > 0 ? (
                <span className={`grid h-6 w-6 place-items-center rounded-full border border-line bg-ground text-[10px] font-semibold text-ink-2 ${DENSE_FACE}`}>
                  +{extra}
                </span>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
      {detailed && task.assignees.length > 1 ? <PeopleLine people={task.assignees} /> : null}
    </div>
  );
}
