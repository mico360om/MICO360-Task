import { useState, type ReactNode } from 'react';
import { ModalPortal } from '../ui/ModalPortal';
import { useDialog } from '../../hooks/useDialog';
import type { CalItem } from '../../lib/calendar-model';
import type { MoveScope } from '../../lib/calendar-reschedule';
import { recurrenceSummary } from '../../lib/recurrence-summary';
import { PRIORITY_LABEL, STATUS_META, TaskChip, dayLabel, fullDayLabel } from './calendar-ui';
import { ProjectAvatar, type ProjectLook } from '../ProjectAvatar';

function Shell({ label, onClose, children, wide = false }: { label: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useDialog(onClose, { initialFocus: 'container' });
  return (
    <ModalPortal>
      <div className="above-keyboard fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
        <div className="absolute inset-0 bg-ink/40 animate-fade-in" onClick={onClose} aria-hidden="true" />
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-label={label}
          tabIndex={-1}
          className={`card relative flex max-h-[min(calc(var(--visible-height)*0.9),44rem)] w-full flex-col overflow-hidden rounded-b-none outline-none animate-scale-in sm:rounded-2xl ${wide ? 'sm:max-w-lg' : 'sm:max-w-md'}`}
        >
          {children}
        </div>
      </div>
    </ModalPortal>
  );
}

function Header({ title, onClose, sub }: { title: ReactNode; onClose: () => void; sub?: ReactNode }) {
  return (
    <div className="flex flex-none items-start gap-3 border-b border-line px-5 py-4">
      <div className="min-w-0 flex-1">
        <h2 className="font-display text-lg font-bold leading-snug text-ink [overflow-wrap:anywhere]">{title}</h2>
        {sub ? <div className="mt-0.5 text-xs text-ink-2">{sub}</div> : null}
      </div>
      <button type="button" onClick={onClose} aria-label="Close" className="grid h-9 w-9 flex-none place-items-center rounded-lg text-ink-2 hover:bg-ground hover:text-ink">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
      </button>
    </div>
  );
}

/** Every task due on one day (the filters still apply), and a way to add one there. */
export function DayDialog({ day, items, colorOf, canDrag, canCreate, onOpen, onAdd, onClose }: {
  day: string;
  items: CalItem[];
  colorOf: (projectId: string) => string | undefined;
  canDrag: (item: CalItem) => boolean;
  canCreate: boolean;
  onOpen: (item: CalItem) => void;
  onAdd: (day: string) => void;
  onClose: () => void;
}) {
  const label = fullDayLabel(day);
  return (
    <Shell label={label} onClose={onClose}>
      <Header title={label} sub={items.length === 0 ? 'Nothing due' : `${items.length} ${items.length === 1 ? 'task' : 'tasks'}`} onClose={onClose} />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
        {items.length === 0 ? (
          <p className="py-4 text-center text-sm text-ink-2">Nothing is due on this day{canCreate ? '.' : ' with these filters.'}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {items.map((item) => (
              <li key={item.key}>
                <TaskChip item={item} color={colorOf(item.task.projectId)} draggable={canDrag(item)} onOpen={onOpen} meta={`${item.task.key}${item.task.assignees?.length ? ` · ${item.task.assignees.map((a) => a.name).join(', ')}` : ''}`} />
              </li>
            ))}
          </ul>
        )}
      </div>
      {canCreate ? (
        <div className="flex-none border-t border-line px-5 py-3">
          <button type="button" onClick={() => onAdd(day)} aria-label={`Add a task on ${dayLabel(day)}`} className="w-full rounded-xl bg-brand-gradient px-4 py-2.5 text-sm font-semibold text-white shadow-brand">
            + Add a task on this day
          </button>
        </div>
      ) : null}
    </Shell>
  );
}

function ScopeChoice({ value, onChange }: { value: MoveScope; onChange: (v: MoveScope) => void }) {
  const options: { v: MoveScope; label: string; hint: string }[] = [
    { v: 'occurrence', label: 'This occurrence', hint: 'Only this copy moves; the next ones stay on their days.' },
    { v: 'series', label: 'This and future occurrences', hint: 'The schedule moves to the new day from here on.' },
  ];
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-semibold text-ink">Which occurrences?</legend>
      {options.map((o) => (
        <label key={o.v} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${value === o.v ? 'border-brand bg-brand/5' : 'border-line hover:border-brand/50'}`}>
          <input type="radio" name="move-scope" value={o.v} checked={value === o.v} onChange={() => onChange(o.v)} className="mt-1 accent-[rgb(var(--c-brand))]" />
          <span>
            <span className="block text-sm font-medium text-ink">{o.label}</span>
            <span className="block text-xs text-ink-2">{o.hint}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/** Asked when the newest copy of a repeating task is dropped on another day. */
export function MoveChoiceDialog({ item, to, onMove, onClose }: { item: CalItem; to: string; onMove: (scope: MoveScope) => void; onClose: () => void }) {
  const [scope, setScope] = useState<MoveScope>('occurrence');
  return (
    <Shell label="Move a repeating task" onClose={onClose}>
      <Header title="Move a repeating task" sub={`${item.task.key} · from ${dayLabel(item.date)} to ${dayLabel(to)}`} onClose={onClose} />
      <div className="flex flex-col gap-4 px-5 py-4">
        <p dir="auto" className="text-sm text-ink">{item.task.title}</p>
        <ScopeChoice value={scope} onChange={setScope} />
      </div>
      <div className="flex flex-none flex-col-reverse gap-2 border-t border-line px-5 py-3 sm:flex-row sm:justify-end">
        <button type="button" onClick={onClose} className="rounded-xl border border-line px-4 py-2 text-sm font-medium text-ink hover:bg-ground">Cancel</button>
        <button type="button" onClick={() => onMove(scope)} className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white">Move</button>
      </div>
    </Shell>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-3 py-1.5">
      <dt className="text-xs font-semibold uppercase tracking-wide text-ink-2">{label}</dt>
      <dd className="min-w-0 text-sm text-ink">{children}</dd>
    </div>
  );
}

/** How far a day is from today, in words. */
function relative(day: string, today: string): string {
  const d = Math.round((Date.parse(`${day}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d === -1) return 'yesterday';
  return d > 0 ? `in ${d} days` : `${-d} days ago`;
}

/**
 * A task's details from the calendar: the full title, project, people, due day (and time, if it has
 * one), priority, status and repeat — with its date to change, or the whole task to open.
 */
export function TaskPreview({
  item,
  today,
  timeZone,
  project,
  movable,
  onMove,
  onOpenTask,
  onClose,
}: {
  item: CalItem;
  today: string;
  timeZone: string;
  /** The task's project (null while the projects are loading or when it can't be seen). */
  project: ProjectLook | null;
  movable: boolean;
  onMove: (to: string, scope: MoveScope) => void;
  onOpenTask: (taskId: string) => void;
  onClose: () => void;
}) {
  const t = item.task;
  const s = STATUS_META[item.status];
  const [editing, setEditing] = useState(false);
  const [to, setTo] = useState(item.date);
  const [scope, setScope] = useState<MoveScope>('occurrence');
  const due = t.dueDate ? new Date(t.dueDate) : null;
  const timed = due && !(due.getUTCHours() === 0 && due.getUTCMinutes() === 0) && item.kind === 'task';
  const time = timed ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone }).format(due!) : null;
  const rule = t.recurrenceRule;
  return (
    <Shell label={t.title} onClose={onClose} wide>
      <Header
        title={<span dir="auto">{t.title}</span>}
        sub={<span className="font-mono">{t.key}</span>}
        onClose={onClose}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
        {item.kind === 'projected' ? (
          <p className="mb-3 flex items-start gap-2 rounded-xl border border-dashed border-ink-3/60 bg-ground px-3 py-2 text-sm text-ink">
            <span className="mt-0.5 text-ink-2">{STATUS_META.projected.icon}</span>
            <span>
              This copy will be created {rule?.createNext === 'ON_SCHEDULE' ? `on ${dayLabel(item.date)}` : 'when the current one is completed'} — it isn’t a task yet.
              The current copy is due {t.dueDate ? dayLabel(t.dueDate.slice(0, 10)) : 'without a date'}.
            </span>
          </p>
        ) : null}
        <dl className="divide-y divide-line">
          <Row label="Status">
            <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-semibold ${s.chip}`}>
              {s.icon}
              <span>{s.label}</span>
            </span>
          </Row>
          <Row label="Due">
            <span>{fullDayLabel(item.date)}</span>
            {time ? <span> at {time}</span> : null}
            <span className={`ms-2 text-xs ${item.status === 'overdue' ? 'font-semibold text-danger' : 'text-ink-2'}`}>({relative(item.date, today)})</span>
          </Row>
          <Row label="Project">
            <span className="inline-flex items-center gap-2">
              {project ? <ProjectAvatar project={project} size="sm" /> : <span className="h-2.5 w-2.5 flex-none rounded-full bg-ink-3" aria-hidden="true" />}
              <span dir="auto">{project?.name ?? 'Project'}</span>
            </span>
          </Row>
          <Row label="Assignees">
            {t.assignees?.length ? (
              <ul className="flex flex-wrap gap-1.5">
                {t.assignees.map((a) => (
                  <li key={a.id} dir="auto" className="rounded-full bg-ground px-2 py-0.5 text-xs font-medium">{a.name}</li>
                ))}
              </ul>
            ) : (
              <span className="text-ink-2">Unassigned</span>
            )}
          </Row>
          <Row label="Priority">{PRIORITY_LABEL[t.priority]}</Row>
          {rule || t.recurrenceParentId ? (
            <Row label="Repeat">
              {rule ? recurrenceSummary(rule) : 'An earlier copy of a repeating task'}
              {rule?.resumeFrom ? <span className="block text-xs text-ink-2">This copy was moved from {dayLabel(rule.resumeFrom)}; the series stays on schedule.</span> : null}
            </Row>
          ) : null}
        </dl>

        {editing ? (
          <form
            className="mt-3 flex flex-col gap-3 rounded-xl border border-line bg-ground/60 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (to && to !== item.date) onMove(to, scope);
            }}
          >
            <label className="flex flex-col gap-1 text-sm font-medium text-ink">
              New due date
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} required className="rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20" />
            </label>
            {rule ? <ScopeChoice value={scope} onChange={setScope} /> : null}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(false)} className="rounded-lg px-3 py-2 text-sm font-medium text-ink-2 hover:bg-surface">Cancel</button>
              <button type="submit" disabled={!to || to === item.date} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Save date</button>
            </div>
          </form>
        ) : null}
      </div>
      <div className="flex flex-none flex-col-reverse gap-2 border-t border-line px-5 py-3 sm:flex-row sm:justify-end">
        {movable && !editing ? (
          <button type="button" onClick={() => setEditing(true)} className="rounded-xl border border-line px-4 py-2 text-sm font-medium text-ink hover:border-brand hover:text-brand">
            Change date
          </button>
        ) : null}
        <button type="button" onClick={() => onOpenTask(t.id)} className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white">
          {item.kind === 'projected' ? 'Open the current copy' : 'Open task'}
        </button>
      </div>
    </Shell>
  );
}
