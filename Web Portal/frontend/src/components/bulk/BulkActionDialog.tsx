import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQueries, useQuery } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { bulkApi, type BulkAction, type BulkActionType, type BulkResult, type BulkStatus } from '../../api/bulk';
import type { Priority } from '../../api/tasks';
import { membersApi } from '../../api/members';
import { usersApi } from '../../api/users';
import { ApiError } from '../../lib/api-client';
import { confirmLines, confirmTitle, type ConfirmNames } from '../../lib/bulk-words';
import { STATUS_ORDER, statusMeta } from '../../lib/taskStatus';
import { useProjectCategories } from '../../lib/useProjectCategories';
import { MAX_TASK_GUESTS } from '../../lib/guest-contacts';
import { TOUCH_TALL } from '../../lib/touch';
import { useDialog } from '../../hooks/useDialog';
import { ModalPortal } from '../ui/ModalPortal';
import { Button } from '../ui/Button';
import { dialogLayer, dialogPanel } from '../ui/dialog-size';
import { fieldClass } from '../ui/Field';
import { PriorityBadge } from '../ui/PriorityBadge';
import { AssigneeSelect, type PersonOption } from '../task-form/AssigneeSelect';
import { CategoryPicker } from '../task-form/category-picker';
import { GuestBadge, GuestPicker, guestChipText, type PickedGuest } from '../task-form/guest-picker';

/** Every bulk change but a move to another project (that one has its own dialog: MoveTaskDialog). */
export type BulkDialogType = Exclude<BulkActionType, 'project'>;

export interface BulkActionDialogProps {
  type: BulkDialogType;
  taskIds: string[];
  /** The selected tasks' projects: the people who can be assigned there; one project's categories and guests. */
  projectIds: string[];
  /** People on the selected tasks now (more choices for Unassign). */
  assigned?: { id: string; name: string }[];
  /** The company's today ('YYYY-MM-DD'). */
  today: string;
  onClose: () => void;
  /** Applied: what happened to each task (the caller shows the summary). */
  onApplied: (result: BulkResult) => void;
}

/** Nothing to choose: straight to the check. */
const DIRECT: ReadonlySet<BulkDialogType> = new Set(['duplicate', 'archive', 'unarchive', 'delete']);
/** The most people (or guests) one change adds. */
const MAX_PEOPLE = 20;
const PRIORITIES: { value: Priority; label: string }[] = [
  { value: 'URGENT', label: 'Urgent' },
  { value: 'HIGH', label: 'High' },
  { value: 'NORMAL', label: 'Normal' },
  { value: 'LOW', label: 'Low' },
];

const plural = (n: number) => `${n} task${n === 1 ? '' : 's'}`;
function chooseTitle(type: BulkDialogType, n: number): string {
  switch (type) {
    case 'status':
      return `Change the status of ${plural(n)}`;
    case 'priority':
      return `Change the priority of ${plural(n)}`;
    case 'assign':
      return `Assign people to ${plural(n)}`;
    case 'reassign':
      return `Reassign ${plural(n)}`;
    case 'unassign':
      return `Unassign people from ${plural(n)}`;
    case 'dueDate':
      return `Change the due date of ${plural(n)}`;
    case 'category':
      return `Change the categories of ${plural(n)}`;
    case 'guests':
      return `Add guests to ${plural(n)}`;
    default:
      return `Change ${plural(n)}`;
  }
}

const failureText = (e: unknown, fallback: string) => (e instanceof ApiError && e.message ? e.message : `${fallback} Check your connection and try again.`);
const fullName = (u: { firstName?: string | null; lastName?: string | null; username?: string | null }) => [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username || 'Someone';
/** A complete, plausible calendar date — never a half-typed year like 0002. */
const isCompleteDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && Number(v.slice(0, 4)) >= 2000 && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

/**
 * One bulk change, asked first (owner, 10 Nov): choose the change (a status, people, a date…), then
 * the server's dry run says what will change, on how many tasks, how many will be skipped and why, and
 * what to know ("2 will wait for approval") — Apply sends the very same change. Nothing would change:
 * it says so and offers only Close.
 */
export function BulkActionDialog({ type, taskIds, projectIds, assigned = [], today, onClose, onApplied }: BulkActionDialogProps) {
  const n = taskIds.length;
  const direct = DIRECT.has(type);
  const [action, setAction] = useState<BulkAction | null>(direct ? ({ type } as BulkAction) : null);
  const [names, setNames] = useState<ConfirmNames>({ today });
  const titleId = useId();
  const bodyId = useId();

  const check = useMutation({ mutationFn: (a: BulkAction) => bulkApi(apiClient).run(taskIds, a, { dryRun: true }) });
  const apply = useMutation({ mutationFn: (a: BulkAction) => bulkApi(apiClient).run(taskIds, a), onSuccess: (r) => onApplied(r) });
  const busy = apply.isPending;
  const dialogRef = useDialog(() => {
    if (!busy) onClose();
  });

  // Delete, Archive, Duplicate…: checked at once (once, even when drawn twice).
  const started = useRef(false);
  useEffect(() => {
    if (!direct || started.current) return;
    started.current = true;
    check.mutate({ type } as BulkAction);
  }, [direct, type, check]);

  function go(a: BulkAction, known: ConfirmNames = {}) {
    setNames({ today, ...known });
    setAction(a);
    check.mutate(a);
  }

  const dry = check.data;
  const title = action ? confirmTitle(action, n, names) : chooseTitle(type, n);
  const nothing = dry ? dry.changed.length === 0 : false;
  const checking = Boolean(action) && (check.isPending || (!dry && !check.isError));
  const stage = !action ? 'choose' : checking ? 'checking' : check.isError ? 'error' : nothing ? 'nothing' : 'confirm';
  // Each step replaces the button that was used: focus goes on to the step's own (the safe way out once
  // the check is in, as every question here), never lost to the page.
  const firstStage = useRef(true);
  useEffect(() => {
    if (firstStage.current) {
      firstStage.current = false;
      return;
    }
    const panel = dialogRef.current;
    if (!panel) return;
    const target = panel.querySelector<HTMLElement>('[data-bulk-focus]') ?? (stage === 'choose' ? panel.querySelector<HTMLElement>('input, button') : null) ?? panel;
    target.focus();
  }, [stage, dialogRef]);
  const footer = 'flex flex-none flex-col-reverse gap-2 border-t border-line px-5 py-3 sm:flex-row sm:justify-end';

  let body: ReactNode;
  let foot: ReactNode;
  if (!action) {
    body = <Choose type={type} projectIds={projectIds} assigned={assigned} onGo={go} onCancel={onClose} />;
    foot = null;
  } else if (checking) {
    body = (
      <p role="status" className="text-sm text-ink-2">
        Checking what will change…
      </p>
    );
    foot = (
      <div className={footer}>
        <Button variant="secondary" onClick={onClose} data-bulk-focus className={TOUCH_TALL}>
          Cancel
        </Button>
      </div>
    );
  } else if (check.isError) {
    body = (
      <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
        {failureText(check.error, 'Couldn’t check what would change.')}
      </p>
    );
    foot = (
      <div className={footer}>
        <Button variant="secondary" onClick={onClose} className={TOUCH_TALL}>
          Close
        </Button>
        <Button variant="secondary" onClick={() => check.mutate(action)} data-bulk-focus className={TOUCH_TALL}>
          Try again
        </Button>
      </div>
    );
  } else {
    const lines = dry ? confirmLines(dry) : [];
    body = (
      <div className="flex flex-col gap-3">
        <ul id={bodyId} className="flex flex-col gap-1.5 text-sm text-ink">
          {lines.map((line, i) => (
            <li key={line} className={i === 0 ? 'font-medium' : 'text-ink-2'}>
              {line}
            </li>
          ))}
        </ul>
        {apply.isError ? (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            {failureText(apply.error, 'Couldn’t apply the change.')}
          </p>
        ) : null}
      </div>
    );
    foot = nothing ? (
      <div className={footer}>
        <Button onClick={onClose} data-bulk-focus className={TOUCH_TALL}>
          Close
        </Button>
      </div>
    ) : (
      <div className={footer}>
        {!direct ? (
          <Button
            variant="ghost"
            onClick={() => {
              check.reset();
              apply.reset();
              setAction(null);
            }}
            disabled={busy}
            className={`sm:me-auto ${TOUCH_TALL}`}
          >
            Back
          </Button>
        ) : null}
        <Button variant="secondary" onClick={onClose} disabled={busy} data-bulk-focus className={TOUCH_TALL}>
          Cancel
        </Button>
        <Button variant={type === 'delete' ? 'danger' : 'primary'} loading={busy} onClick={() => apply.mutate(action)} className={TOUCH_TALL}>
          Apply
        </Button>
      </div>
    );
  }

  return (
    <ModalPortal>
      <div className={dialogLayer('small')}>
        <div className="absolute inset-0 bg-scrim animate-fade-in" onClick={busy ? undefined : onClose} aria-hidden="true" />
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={dry ? bodyId : undefined}
          tabIndex={-1}
          className={`card relative flex outline-none ${dialogPanel('small')} animate-scale-in flex-col overflow-hidden`}
        >
          <h2 id={titleId} className="flex-none px-5 pb-2 pt-4 font-display text-lg font-semibold text-ink">
            {title}
          </h2>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{body}</div>
          {foot}
        </div>
      </div>
    </ModalPortal>
  );
}

/** The people who can be assigned in these projects (each project's team), A to Z, with their pictures. */
function usePeople(projectIds: string[], extra: { id: string; name: string }[]): { people: PersonOption[]; loading: boolean } {
  const qs = useQueries({ queries: projectIds.map((id) => ({ queryKey: ['members', id], queryFn: () => membersApi(apiClient).list(id), staleTime: 60_000 })) });
  const dirQ = useQuery({ queryKey: ['directory'], queryFn: () => usersApi(apiClient).directory(), staleTime: 60_000 });
  const loading = qs.some((q) => q.isLoading);
  // (A few dozen people at most: worked out on each draw.)
  const dir = Array.isArray(dirQ.data) ? dirQ.data : [];
  const m = new Map<string, PersonOption>();
  for (const q of qs) {
    for (const p of Array.isArray(q.data) ? q.data : []) {
      if (p.hasAccess === false || m.has(p.id)) continue;
      m.set(p.id, { id: p.id, name: fullName(p), username: p.username, avatarUrl: dir.find((d) => d.id === p.id)?.avatarUrl ?? null });
    }
  }
  for (const a of extra) if (!m.has(a.id)) m.set(a.id, { id: a.id, name: a.name });
  const people = [...m.values()].sort((a, b) => a.name.localeCompare(b.name, 'en'));
  return { people, loading };
}

const choiceRow = `flex w-full items-center gap-2.5 rounded-lg border border-line px-3 py-2 text-start text-sm font-medium text-ink transition-colors hover:border-brand hover:bg-brand/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${TOUCH_TALL}`;
const radioRow = `flex cursor-pointer items-center gap-2.5 rounded-md px-1 text-sm text-ink ${TOUCH_TALL}`;

/** The choose step: what the change is (a status, people, a date, categories, guests). */
function Choose({ type, projectIds, assigned, onGo, onCancel }: { type: BulkDialogType; projectIds: string[]; assigned: { id: string; name: string }[]; onGo: (a: BulkAction, names?: ConfirmNames) => void; onCancel: () => void }) {
  switch (type) {
    case 'status':
      return (
        <>
          <div role="group" aria-label="Status" className="flex flex-col gap-1.5">
            {STATUS_ORDER.map((s) => (
              <button key={s} type="button" onClick={() => onGo({ type: 'status', status: s as BulkStatus })} className={choiceRow}>
                <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: statusMeta(s).color }} aria-hidden="true" />
                {statusMeta(s).label}
              </button>
            ))}
          </div>
          <ContinueRow onCancel={onCancel} />
        </>
      );
    case 'priority':
      return (
        <>
          <div role="group" aria-label="Priority" className="flex flex-col gap-1.5">
            {PRIORITIES.map((p) => (
              <button key={p.value} type="button" aria-label={p.label} onClick={() => onGo({ type: 'priority', priority: p.value })} className={choiceRow}>
                <PriorityBadge priority={p.value} />
              </button>
            ))}
          </div>
          <ContinueRow onCancel={onCancel} />
        </>
      );
    case 'assign':
    case 'reassign':
    case 'unassign':
      return <ChoosePeople type={type} projectIds={projectIds} assigned={assigned} onGo={onGo} onCancel={onCancel} />;
    case 'dueDate':
      return <ChooseDueDate onGo={onGo} onCancel={onCancel} />;
    case 'category':
      return <ChooseCategories projectId={projectIds.length === 1 ? projectIds[0]! : undefined} onGo={onGo} onCancel={onCancel} />;
    case 'guests':
      return <ChooseGuests projectId={projectIds.length === 1 ? projectIds[0]! : undefined} onGo={onGo} onCancel={onCancel} />;
    default:
      return null;
  }
}

/** The choose step's buttons: Cancel, and Continue (to the check) once something is chosen. */
function ContinueRow({ disabled, onClick, onCancel }: { disabled?: boolean; onClick?: () => void; onCancel: () => void }) {
  return (
    <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <Button variant="secondary" onClick={onCancel} className={TOUCH_TALL}>
        Cancel
      </Button>
      {onClick ? (
        <Button onClick={onClick} disabled={disabled} className={TOUCH_TALL}>
          Continue
        </Button>
      ) : null}
    </div>
  );
}

function ChoosePeople({ type, projectIds, assigned, onGo, onCancel }: { type: 'assign' | 'reassign' | 'unassign'; projectIds: string[]; assigned: { id: string; name: string }[]; onGo: (a: BulkAction, names?: ConfirmNames) => void; onCancel: () => void }) {
  const { people, loading } = usePeople(projectIds, type === 'unassign' ? assigned : []);
  const [picked, setPicked] = useState<string[]>([]);
  const [everyone, setEveryone] = useState(false);
  const group = useId();
  const nameOf = Object.fromEntries(people.map((p) => [p.id, p.name]));
  const full = picked.length >= MAX_PEOPLE;
  const select = (
    <AssigneeSelect
      people={full ? people.filter((p) => picked.includes(p.id)) : people}
      value={picked}
      onChange={(ids) => setPicked(ids.slice(0, MAX_PEOPLE))}
      disabled={everyone}
      listLabel="Picked people"
      addLabel="Add people"
      noPeopleText={loading ? 'Loading people…' : 'No one can be assigned here'}
      allChosenText={full ? `Up to ${MAX_PEOPLE} people at a time.` : 'Everyone is picked.'}
      note={
        type === 'reassign'
          ? 'Everyone assigned now is replaced by the people picked here.'
          : projectIds.length > 1
            ? 'People of every selected task’s project. A task whose team doesn’t have someone is skipped.'
            : undefined
      }
    />
  );
  return (
    <div className="flex flex-col gap-3">
      {type === 'unassign' ? (
        <div role="radiogroup" aria-label="Who to take off" className="flex flex-col gap-1">
          <label className={radioRow}>
            <input type="radio" name={group} checked={everyone} onChange={() => setEveryone(true)} className="h-4 w-4 accent-brand" />
            Everyone
          </label>
          <label className={radioRow}>
            <input type="radio" name={group} checked={!everyone} onChange={() => setEveryone(false)} className="h-4 w-4 accent-brand" />
            Pick people
          </label>
        </div>
      ) : null}
      {type !== 'unassign' || !everyone ? select : null}
      <ContinueRow
        onCancel={onCancel}
        disabled={!everyone && picked.length === 0}
        onClick={() =>
          onGo(
            type === 'unassign' && everyone ? { type: 'unassign' } : { type, userIds: picked },
            { people: nameOf },
          )
        }
      />
    </div>
  );
}

function ChooseDueDate({ onGo, onCancel }: { onGo: (a: BulkAction) => void; onCancel: () => void }) {
  const [mode, setMode] = useState<'set' | 'clear' | 'shift'>('set');
  const [date, setDate] = useState('');
  const [days, setDays] = useState('1');
  const [later, setLater] = useState(true);
  const modeName = useId();
  const dirName = useId();
  const dateId = useId();
  const count = Number(days);
  const okDays = Number.isInteger(count) && count >= 1 && count <= 365;
  const ready = mode === 'clear' || (mode === 'set' ? isCompleteDate(date) : okDays);
  return (
    <div className="flex flex-col gap-2">
      <div role="radiogroup" aria-label="Due date change" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <label className={radioRow}>
            <input type="radio" name={modeName} checked={mode === 'set'} onChange={() => setMode('set')} className="h-4 w-4 accent-brand" />
            Set a date
          </label>
          <label htmlFor={dateId} className="sr-only">
            Due date
          </label>
          <input
            id={dateId}
            type="date"
            value={date}
            onFocus={() => setMode('set')}
            onChange={(e) => {
              setDate(e.target.value);
              setMode('set');
            }}
            className={fieldClass(false, 'h-9')}
          />
        </div>
        <label className={radioRow}>
          <input type="radio" name={modeName} checked={mode === 'clear'} onChange={() => setMode('clear')} className="h-4 w-4 accent-brand" />
          Clear the due date
        </label>
        <div className="flex flex-col gap-1.5">
          <label className={radioRow}>
            <input type="radio" name={modeName} checked={mode === 'shift'} onChange={() => setMode('shift')} className="h-4 w-4 accent-brand" />
            Move by days
          </label>
          <div className="flex flex-wrap items-center gap-3 ps-7">
            <input
              type="number"
              aria-label="Days"
              min={1}
              max={365}
              value={days}
              onFocus={() => setMode('shift')}
              onChange={(e) => {
                setDays(e.target.value);
                setMode('shift');
              }}
              className={fieldClass(mode === 'shift' && !okDays, 'h-9 w-20')}
            />
            <div role="radiogroup" aria-label="Which way" className="flex items-center gap-3">
              <label className={radioRow}>
                <input type="radio" name={dirName} checked={later} onChange={() => { setLater(true); setMode('shift'); }} className="h-4 w-4 accent-brand" />
                Later
              </label>
              <label className={radioRow}>
                <input type="radio" name={dirName} checked={!later} onChange={() => { setLater(false); setMode('shift'); }} className="h-4 w-4 accent-brand" />
                Earlier
              </label>
            </div>
          </div>
          {mode === 'shift' && !okDays ? <p className="ps-7 text-xs text-danger">Between 1 and 365 days.</p> : null}
        </div>
      </div>
      <ContinueRow
        onCancel={onCancel}
        disabled={!ready}
        onClick={() => onGo(mode === 'clear' ? { type: 'dueDate', mode: 'clear' } : mode === 'set' ? { type: 'dueDate', mode: 'set', date } : { type: 'dueDate', mode: 'shift', days: later ? count : -count })}
      />
    </div>
  );
}

function ChooseCategories({ projectId, onGo, onCancel }: { projectId: string | undefined; onGo: (a: BulkAction, names?: ConfirmNames) => void; onCancel: () => void }) {
  const list = useProjectCategories(projectId);
  const [add, setAdd] = useState<string[]>([]);
  const [remove, setRemove] = useState<string[]>([]);
  const only = (text: string, status = false) => (
    <>
      <p role={status ? 'status' : undefined} className="text-sm text-ink-2">
        {text}
      </p>
      <ContinueRow onCancel={onCancel} />
    </>
  );
  if (!projectId) return only('Select tasks of one project to change their categories.');
  if (list === undefined) return only('Loading the categories…', true);
  const categories = list?.categories ?? [];
  if (categories.length === 0) return only('This project has no categories yet.');
  const names = Object.fromEntries(categories.map((c) => [c.id, c.name]));
  const all = categories.map((c) => c.id);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium text-ink" aria-hidden="true">
          Add
        </p>
        <CategoryPicker label="Add" categories={categories} value={add} onChange={(ids) => { setAdd(ids); setRemove((r) => r.filter((x) => !ids.includes(x))); }} />
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium text-ink" aria-hidden="true">
          Take off
        </p>
        <CategoryPicker label="Take off" categories={categories} kept={all} value={remove} onChange={(ids) => { setRemove(ids); setAdd((a) => a.filter((x) => !ids.includes(x))); }} />
      </div>
      {list?.requireCategory ? <p className="text-xs text-ink-2">Every task in this project needs a category: a task left with none is skipped.</p> : null}
      <ContinueRow
        onCancel={onCancel}
        disabled={add.length === 0 && remove.length === 0}
        onClick={() => onGo({ type: 'category', ...(add.length ? { add } : {}), ...(remove.length ? { remove } : {}) }, { categories: names })}
      />
    </div>
  );
}

function ChooseGuests({ projectId, onGo, onCancel }: { projectId: string | undefined; onGo: (a: BulkAction, names?: ConfirmNames) => void; onCancel: () => void }) {
  const [picked, setPicked] = useState<PickedGuest[]>([]);
  if (!projectId) {
    return (
      <>
        <p className="text-sm text-ink-2">Select tasks of one project to add guests.</p>
        <ContinueRow onCancel={onCancel} />
      </>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {picked.length ? (
        <ul aria-label="Guests to add" className="flex flex-wrap gap-1.5">
          {picked.map((g) => (
            <li key={g.id} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-ground py-1 pe-1 ps-2.5 text-sm text-ink">
              <GuestBadge />
              <span dir="auto" className="min-w-0 truncate">
                {guestChipText(g)}
              </span>
              <button
                type="button"
                onClick={() => setPicked((p) => p.filter((x) => x.id !== g.id))}
                aria-label={`Remove ${g.name}`}
                className="grid h-6 w-6 flex-none place-items-center rounded-full text-ink-2 hover:bg-danger-soft hover:text-danger [@media(pointer:coarse)]:-my-2.5 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
              >
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <GuestPicker projectId={projectId} exclude={picked.map((g) => g.id)} onPick={(g) => setPicked((p) => (p.length >= MAX_TASK_GUESTS || p.some((x) => x.id === g.id) ? p : [...p, g]))} />
      <p className="text-xs text-ink-2">A task gets a guest only when it has someone from the team on it too; the others are skipped.</p>
      <ContinueRow
        onCancel={onCancel}
        disabled={picked.length === 0}
        onClick={() => onGo({ type: 'guests', add: picked.map((g) => g.id) }, { guests: Object.fromEntries(picked.map((g) => [g.id, g.name])) })}
      />
    </div>
  );
}
