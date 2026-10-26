import { useId, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { projectsApi } from '../../api/projects';
import { columnsApi } from '../../api/columns';
import { membersApi } from '../../api/members';
import { usersApi } from '../../api/users';
import type { Priority } from '../../api/tasks';
import type { CreateTaskChange, MeetingChange, MicoAiNamed, MinutesChange, ProposalChange, UpdateTaskChange } from '../../api/mico-ai';
import type { FinalMinutesContent } from '../../api/meetings';
import { lengthLabel, linesOf, meetingWhen, shortDay, textOf } from '../../lib/mico-ai-proposal';
import { todayKey, zonedDayKey } from '../../lib/due-date';
import { useAuthStore } from '../../stores/auth-store';
import { SearchableSelect } from '../ui/SearchableSelect';
import { AssigneeSelect, type PersonOption } from '../task-form/AssigneeSelect';
import { priorityLabel, priorityOptions, PriorityBars } from '../priority-option';
import { projectOption } from '../project-option';
import { useSourceTarget } from './AnswerParts';

/**
 * One change on MICO AI's card: what it will do (a new task's details; a task change as
 * before → after; a meeting's day, time, people, agenda and description; a draft of final
 * minutes), and its inline editor, built from the app's own controls. Everything Confirm will
 * write is shown — nothing is hidden or silently cut (text MICO AI wrote may come from the data it
 * read). Editors report the values the person chose (ids, days, times) and the names to show for
 * them; the server checks every value again.
 */

/** How the card's days and times read: in the company's zone, named when the person's own differs. */
export interface When {
  /** The company's time zone (meeting times are in it). */
  timeZone: string;
  /** The person's own zone is a different one: the company's is named after meeting times. */
  otherZone: boolean;
}
const yearOf = (when: When) => todayKey(when.timeZone).slice(0, 4);

/** Names to show for edited values (the card's labels are for what was proposed). */
export interface Shown {
  project?: string | null;
  assignees?: MicoAiNamed[];
  column?: string;
  attendees?: MicoAiNamed[];
}
export type EditFn = (patch: Record<string, unknown>, shown?: Shown) => void;

const fullName = (u: { firstName?: string | null; lastName?: string | null; username: string }) => [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username;
const names = (list: MicoAiNamed[]) => (list.length ? list.map((p) => p.name).join(', ') : 'No one');
const field =
  'w-full min-w-0 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/20 [@media(pointer:coarse)]:!min-h-[44px]';
const labelText = 'mb-1 block text-xs font-semibold text-ink-2';

/** The change's kind, as a small badge. */
export function KindBadge({ item }: { item: ProposalChange }) {
  const text = { create_task: 'New task', update_task: 'Change', draft_minutes: 'Final minutes', schedule_meeting: 'Meeting' }[item.type];
  return <span className="inline-flex flex-none items-center rounded-full bg-brand/10 px-2 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-brand">{text}</span>;
}

function Chips({ people, label }: { people: MicoAiNamed[]; label: string }) {
  if (!people.length) return <span className="text-ink-3">No one</span>;
  return (
    <ul aria-label={label} className="inline-flex min-w-0 flex-wrap gap-1">
      {people.map((p) => (
        <li key={p.id} dir="auto" className="max-w-full truncate rounded-full border border-line bg-ground px-2 py-0.5 text-xs text-ink">
          {p.name}
        </li>
      ))}
    </ul>
  );
}

/** "before → after": the arrow is read as "to". */
function Change({ label, from, to }: { label: string; from: ReactNode; to: ReactNode }) {
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-baseline gap-x-2 text-sm">
      <dt className="text-xs font-semibold text-ink-2">{label}</dt>
      <dd className="min-w-0 [overflow-wrap:anywhere]">
        <span className="text-ink-2 line-through decoration-ink-3/50">{from}</span>
        <span role="img" aria-label="to" className="mx-1.5 text-ink-3">→</span>
        <span className="font-medium text-ink">{to}</span>
      </dd>
    </div>
  );
}

/** A long text in full behind "Show all" (never cut off without saying so); a short one as it is. */
function LongText({ text, what }: { text: string; what: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 160 || text.split('\n').length > 3;
  return (
    <div className="space-y-0.5">
      <p dir="auto" className={`whitespace-pre-wrap text-sm text-ink-2 [overflow-wrap:anywhere] ${long && !open ? 'line-clamp-3' : ''}`}>{text}</p>
      {long ? (
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${open ? 'Show less' : 'Show all'} of the ${what}`}
          onClick={() => setOpen((o) => !o)}
          className="inline-flex min-h-7 items-center text-xs font-semibold text-brand hover:underline [@media(pointer:coarse)]:!min-h-[44px]"
        >
          {open ? 'Show less' : 'Show all'}
        </button>
      ) : null}
    </div>
  );
}

/** A section shown open (it has content): the person sees all of it, and may fold it away. */
function Disclosure({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <details open className="rounded-lg border border-line bg-ground/40 px-2.5 py-1.5">
      <summary className="flex min-h-7 cursor-pointer items-center text-xs font-semibold text-ink-2 [@media(pointer:coarse)]:!min-h-[44px]">{title}</summary>
      <div className="mt-1.5 space-y-2 pb-1">{children}</div>
    </details>
  );
}

function Detail({ children }: { children: ReactNode }) {
  return <span className="inline-flex min-w-0 items-center gap-1 [overflow-wrap:anywhere]">{children}</span>;
}
const Dot = () => <span aria-hidden="true" className="text-ink-3">·</span>;

// ── What each change will do ───────────────────────────────────────────────────
function CreateSummary({ item, when }: { item: CreateTaskChange; when: When }) {
  const f = item.fields;
  return (
    <div className="space-y-1.5">
      <p dir="auto" className="font-medium text-ink [overflow-wrap:anywhere]">{f.title.trim() || 'Untitled task'}</p>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2">
        <Detail>{item.labels.project ?? 'No project'}</Detail>
        <Dot />
        <Detail>{f.due ? `Due ${shortDay(f.due, yearOf(when))}` : 'No due date'}</Detail>
        <Dot />
        <Detail>
          <PriorityBars priority={f.priority} />
          {priorityLabel(f.priority)}
        </Detail>
      </p>
      <div className="flex flex-wrap items-center gap-1.5 text-sm text-ink-2">
        <span className="text-xs font-semibold">Assigned</span>
        <Chips people={item.labels.assignees} label="Assigned people" />
      </div>
      {item.ownerDefault ? <p className="text-xs text-ink-3">No one was named, so it goes to the project’s owner, as any new task does.</p> : null}
      {f.description.trim() ? <LongText text={f.description} what="description" /> : null}
    </div>
  );
}

function UpdateSummary({ item, when }: { item: UpdateTaskChange; when: When }) {
  const target = useSourceTarget();
  const f = item.fields;
  const day = (d: string | null | undefined) => (d ? shortDay(d, yearOf(when)) : 'No due date');
  return (
    <div className="space-y-2">
      <p className="min-w-0 [overflow-wrap:anywhere]">
        <Link to={target(item.task.url)} className="font-medium text-ink underline-offset-2 hover:underline">
          <span className="me-1.5 rounded-md bg-ground px-1.5 py-0.5 font-mono text-xs text-ink-2">{item.task.key}</span>
          <span dir="auto">{item.task.title}</span>
        </Link>
        <span className="ms-1.5 text-xs text-ink-3">{item.task.project}</span>
      </p>
      <dl className="space-y-1">
        {f.due !== undefined ? <Change label="Due" from={day(item.before.due)} to={day(f.due)} /> : null}
        {f.columnId !== undefined ? <Change label="Status" from={item.before.column} to={item.labels.column ?? '—'} /> : null}
        {f.priority !== undefined ? <Change label="Priority" from={priorityLabel(item.before.priority)} to={priorityLabel(f.priority)} /> : null}
        {f.assigneeIds !== undefined ? <Change label="Assigned" from={names(item.before.assignees)} to={names(item.labels.assignees ?? [])} /> : null}
      </dl>
    </div>
  );
}

/** A titled list of the minutes (decisions, risks, next steps), when it has anything. */
function MinutesList({ title, list }: { title: string; list: string[] }) {
  if (!list.length) return null;
  return (
    <div>
      <p className="text-xs font-semibold text-ink-2">{title}</p>
      <ul className="mt-0.5 list-disc space-y-0.5 ps-5 text-sm text-ink marker:text-ink-3">
        {list.map((x, i) => (
          <li key={i} dir="auto" className="[overflow-wrap:anywhere]">{x}</li>
        ))}
      </ul>
    </div>
  );
}

function MinutesSummary({ item, when }: { item: MinutesChange; when: When }) {
  const c = item.fields.content;
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  return (
    <div className="space-y-1.5">
      <p className="font-medium text-ink [overflow-wrap:anywhere]">
        <span dir="auto">{item.meeting.title}</span>
        <span className="ms-1.5 text-xs font-normal text-ink-3">{shortDay(zonedDayKey(new Date(item.meeting.startAt), when.timeZone), yearOf(when))}</span>
      </p>
      <p className="text-xs text-ink-3">Saved as a draft for review on the meeting page — never final or emailed.</p>
      {/* The whole draft, as the meeting page will get it. */}
      <Disclosure title={`The draft · ${plural(c.decisions.length, 'decision')} · ${plural(c.nextSteps.length, 'next step')}${c.risks.length ? ` · ${plural(c.risks.length, 'risk')}` : ''}`}>
        {c.summary ? (
          <div>
            <p className="text-xs font-semibold text-ink-2">Summary</p>
            <p dir="auto" className="whitespace-pre-wrap text-sm text-ink [overflow-wrap:anywhere]">{c.summary}</p>
          </div>
        ) : null}
        {c.discussion.length ? (
          <div>
            <p className="text-xs font-semibold text-ink-2">Discussion</p>
            <dl className="mt-0.5 space-y-1">
              {c.discussion.map((d, i) => (
                <div key={i}>
                  <dt dir="auto" className="text-sm font-medium text-ink [overflow-wrap:anywhere]">{d.topic}</dt>
                  <dd dir="auto" className="whitespace-pre-wrap text-sm text-ink-2 [overflow-wrap:anywhere]">{d.text}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}
        <MinutesList title="Decisions" list={c.decisions} />
        <MinutesList title="Risks and open questions" list={c.risks} />
        <MinutesList title="Next steps" list={c.nextSteps} />
      </Disclosure>
    </div>
  );
}

function MeetingSummary({ item, when }: { item: MeetingChange; when: When }) {
  const f = item.fields;
  return (
    <div className="space-y-1.5">
      <p dir="auto" className="font-medium text-ink [overflow-wrap:anywhere]">{f.title.trim() || 'Untitled meeting'}</p>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2">
        <Detail>{meetingWhen(f, { thisYear: yearOf(when), ...(when.otherZone ? { zone: when.timeZone } : {}) })}</Detail>
        <Dot />
        <Detail>{lengthLabel(f.minutes)}</Detail>
        {item.labels.project ? (
          <>
            <Dot />
            <Detail>{item.labels.project}</Detail>
          </>
        ) : null}
      </p>
      <div className="flex flex-wrap items-center gap-1.5 text-sm text-ink-2">
        <span className="text-xs font-semibold">Invited</span>
        <Chips people={item.labels.attendees} label="People invited" />
      </div>
      {f.agenda.length ? (
        <div className="text-sm text-ink-2">
          <span className="text-xs font-semibold">Agenda</span>
          <ol className="mt-0.5 list-decimal space-y-0.5 ps-5 marker:text-ink-3">
            {f.agenda.map((a, i) => (
              <li key={i} dir="auto" className="[overflow-wrap:anywhere]">{a}</li>
            ))}
          </ol>
        </div>
      ) : null}
      {/* The invitations carry the description: it is shown, open, before anything is sent. */}
      {f.description.trim() ? (
        <Disclosure title="Description">
          <p dir="auto" className="whitespace-pre-wrap text-sm text-ink [overflow-wrap:anywhere]">{f.description}</p>
        </Disclosure>
      ) : null}
    </div>
  );
}

export function RowSummary({ item, when }: { item: ProposalChange; when: When }) {
  switch (item.type) {
    case 'create_task':
      return <CreateSummary item={item} when={when} />;
    case 'update_task':
      return <UpdateSummary item={item} when={when} />;
    case 'draft_minutes':
      return <MinutesSummary item={item} when={when} />;
    case 'schedule_meeting':
      return <MeetingSummary item={item} when={when} />;
  }
}

// ── Editing ────────────────────────────────────────────────────────────────────
function Labelled({ label, children, htmlFor }: { label: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="min-w-0">
      {htmlFor ? (
        <label htmlFor={htmlFor} className={labelText}>
          {label}
        </label>
      ) : (
        <span className={labelText}>{label}</span>
      )}
      {children}
    </div>
  );
}

/** A project's team as picker choices (its members); before they load, the people already chosen. */
function useTeam(projectId: string | null, chosen: MicoAiNamed[]) {
  const membersQ = useQuery({ queryKey: ['members', projectId], queryFn: () => membersApi(apiClient).list(projectId!), enabled: !!projectId });
  return useMemo<PersonOption[]>(() => {
    if (!membersQ.isSuccess) return chosen.map((p) => ({ id: p.id, name: p.name }));
    return (Array.isArray(membersQ.data) ? membersQ.data : []).map((m) => ({ id: m.id, name: fullName(m), username: m.username }));
  }, [membersQ.isSuccess, membersQ.data, chosen]);
}
const named = (people: PersonOption[], ids: string[], known: MicoAiNamed[]): MicoAiNamed[] =>
  ids.map((id) => ({ id, name: people.find((p) => p.id === id)?.name ?? known.find((k) => k.id === id)?.name ?? 'Someone' }));

function useProjects() {
  const q = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi(apiClient).list() });
  return (Array.isArray(q.data) ? q.data : []).filter((p) => p.status !== 'ARCHIVED');
}

function CreateEditor({ item, onEdit }: { item: CreateTaskChange; onEdit: EditFn }) {
  const id = useId();
  const f = item.fields;
  const projects = useProjects();
  const team = useTeam(f.projectId, item.labels.assignees);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Labelled label="Title" htmlFor={`${id}-title`}>
          <input id={`${id}-title`} dir="auto" value={f.title} maxLength={190} onChange={(e) => onEdit({ title: e.target.value })} className={field} />
        </Labelled>
      </div>
      <Labelled label="Project">
        <SearchableSelect
          ariaLabel="Project"
          options={projects.map((p) => projectOption(p))}
          value={f.projectId ?? ''}
          placeholder="Pick a project"
          onChange={(v) => onEdit({ projectId: v }, { project: projects.find((p) => p.id === v)?.name ?? null })}
        />
      </Labelled>
      <Labelled label="Due date" htmlFor={`${id}-due`}>
        <input id={`${id}-due`} type="date" value={f.due ?? ''} onChange={(e) => onEdit({ due: e.target.value || null })} className={field} />
      </Labelled>
      <Labelled label="Priority">
        <SearchableSelect ariaLabel="Priority" options={priorityOptions()} value={f.priority} onChange={(v) => onEdit({ priority: v as Priority })} />
      </Labelled>
      <div className="sm:col-span-2">
        <Labelled label="Assigned to">
          <AssigneeSelect people={team} value={f.assigneeIds} onChange={(ids) => onEdit({ assigneeIds: ids }, { assignees: named(team, ids, item.labels.assignees) })} />
        </Labelled>
      </div>
      <div className="sm:col-span-2">
        <Labelled label="Description" htmlFor={`${id}-desc`}>
          <textarea id={`${id}-desc`} dir="auto" rows={3} value={f.description} maxLength={4000} onChange={(e) => onEdit({ description: e.target.value })} className={field} />
        </Labelled>
      </div>
    </div>
  );
}

function UpdateEditor({ item, onEdit }: { item: UpdateTaskChange; onEdit: EditFn }) {
  const id = useId();
  const f = item.fields;
  const columnsQ = useQuery({ queryKey: ['columns', item.task.projectId], queryFn: () => columnsApi(apiClient).list(item.task.projectId), enabled: f.columnId !== undefined });
  const columns = (Array.isArray(columnsQ.data) ? columnsQ.data : []).filter((c) => c.enabled !== false).sort((a, b) => a.position - b.position);
  const team = useTeam(f.assigneeIds !== undefined ? item.task.projectId : null, item.labels.assignees ?? []);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {f.due !== undefined ? (
        <Labelled label="Due date" htmlFor={`${id}-due`}>
          <input id={`${id}-due`} type="date" value={f.due ?? ''} onChange={(e) => onEdit({ due: e.target.value || null })} className={field} />
        </Labelled>
      ) : null}
      {f.columnId !== undefined ? (
        <Labelled label="Status">
          <SearchableSelect
            ariaLabel="Status"
            options={columns.map((c) => ({ value: c.id, label: c.name, icon: <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} /> }))}
            value={f.columnId}
            placeholder={columnsQ.isLoading ? 'Loading…' : 'Pick a status'}
            onChange={(v) => onEdit({ columnId: v }, { column: columns.find((c) => c.id === v)?.name ?? '' })}
          />
        </Labelled>
      ) : null}
      {f.priority !== undefined ? (
        <Labelled label="Priority">
          <SearchableSelect ariaLabel="Priority" options={priorityOptions()} value={f.priority} onChange={(v) => onEdit({ priority: v as Priority })} />
        </Labelled>
      ) : null}
      {f.assigneeIds !== undefined ? (
        <div className="sm:col-span-2">
          <Labelled label="Assigned to">
            <AssigneeSelect people={team} value={f.assigneeIds} onChange={(ids) => onEdit({ assigneeIds: ids }, { assignees: named(team, ids, item.labels.assignees ?? []) })} />
          </Labelled>
        </div>
      ) : null}
    </div>
  );
}

/** A list edited one item a line: what is typed stays as typed; the list is what it means. */
function LinesField({ label, list, onList }: { label: string; list: string[]; onList: (l: string[]) => void }) {
  const id = useId();
  const [text, setText] = useState(() => textOf(list));
  return (
    <Labelled label={label} htmlFor={id}>
      <textarea
        id={id}
        dir="auto"
        rows={Math.min(6, Math.max(2, list.length + 1))}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onList(linesOf(e.target.value));
        }}
        className={field}
      />
    </Labelled>
  );
}

function MinutesEditor({ item, onEdit }: { item: MinutesChange; onEdit: EditFn }) {
  const id = useId();
  const c = item.fields.content;
  const set = (patch: Partial<FinalMinutesContent>) => onEdit({ content: { ...c, ...patch } });
  return (
    <div className="grid gap-3">
      <Labelled label="Summary" htmlFor={`${id}-summary`}>
        <textarea id={`${id}-summary`} dir="auto" rows={3} value={c.summary} maxLength={4000} onChange={(e) => set({ summary: e.target.value })} className={field} />
      </Labelled>
      {c.discussion.map((d, i) => (
        <Labelled key={i} label={`Discussion: ${d.topic}`} htmlFor={`${id}-d${i}`}>
          <textarea
            id={`${id}-d${i}`}
            dir="auto"
            rows={2}
            value={d.text}
            onChange={(e) => set({ discussion: c.discussion.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })}
            className={field}
          />
        </Labelled>
      ))}
      <LinesField label="Decisions (one a line)" list={c.decisions} onList={(decisions) => set({ decisions })} />
      <LinesField label="Risks and open questions (one a line)" list={c.risks} onList={(risks) => set({ risks })} />
      <LinesField label="Next steps (one a line)" list={c.nextSteps} onList={(nextSteps) => set({ nextSteps })} />
    </div>
  );
}

const LENGTHS = [15, 30, 45, 60, 90, 120];

function MeetingEditor({ item, onEdit }: { item: MeetingChange; onEdit: EditFn }) {
  const id = useId();
  const f = item.fields;
  const me = useAuthStore((s) => s.user?.id);
  const projects = useProjects();
  const dirQ = useQuery({ queryKey: ['directory'], queryFn: () => usersApi(apiClient).directory() });
  // Anyone active can be invited; the person asking organizes it.
  const people = useMemo<PersonOption[]>(() => {
    const dir = Array.isArray(dirQ.data) ? dirQ.data : [];
    if (!dir.length) return item.labels.attendees.map((p) => ({ id: p.id, name: p.name }));
    return dir.filter((u) => u.active !== false && u.id !== me).map((u) => ({ id: u.id, name: fullName(u), username: u.username, avatarUrl: u.avatarUrl }));
  }, [dirQ.data, me, item.labels.attendees]);
  const lengths = LENGTHS.includes(f.minutes) ? LENGTHS : [...LENGTHS, f.minutes].sort((a, b) => a - b);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Labelled label="Title" htmlFor={`${id}-title`}>
          <input id={`${id}-title`} dir="auto" value={f.title} maxLength={200} onChange={(e) => onEdit({ title: e.target.value })} className={field} />
        </Labelled>
      </div>
      <Labelled label="Day" htmlFor={`${id}-day`}>
        <input id={`${id}-day`} type="date" value={f.date ?? ''} onChange={(e) => e.target.value && onEdit({ date: e.target.value })} className={field} />
      </Labelled>
      <Labelled label="Time" htmlFor={`${id}-time`}>
        <input id={`${id}-time`} type="time" value={f.time ?? ''} onChange={(e) => e.target.value && onEdit({ time: e.target.value })} className={field} />
      </Labelled>
      <Labelled label="Length">
        <SearchableSelect ariaLabel="Length" options={lengths.map((m) => ({ value: String(m), label: lengthLabel(m) }))} value={String(f.minutes)} onChange={(v) => onEdit({ minutes: Number(v) })} />
      </Labelled>
      <Labelled label="Project">
        <SearchableSelect
          ariaLabel="Project"
          options={[{ value: '', label: 'No project' }, ...projects.map((p) => projectOption(p))]}
          value={f.projectId ?? ''}
          onChange={(v) => onEdit({ projectId: v || null }, { project: v ? (projects.find((p) => p.id === v)?.name ?? null) : null })}
        />
      </Labelled>
      <div className="sm:col-span-2">
        <Labelled label="People invited">
          <AssigneeSelect people={people} value={f.attendeeIds} onChange={(ids) => onEdit({ attendeeIds: ids }, { attendees: named(people, ids, item.labels.attendees) })} />
        </Labelled>
      </div>
      <div className="sm:col-span-2">
        <LinesField label="Agenda (one item a line)" list={f.agenda} onList={(agenda) => onEdit({ agenda })} />
      </div>
      <div className="sm:col-span-2">
        <Labelled label="Description" htmlFor={`${id}-desc`}>
          <textarea id={`${id}-desc`} dir="auto" rows={2} value={f.description} maxLength={4000} onChange={(e) => onEdit({ description: e.target.value })} className={field} />
        </Labelled>
      </div>
    </div>
  );
}

export function RowEditor({ item, onEdit }: { item: ProposalChange; onEdit: EditFn }) {
  switch (item.type) {
    case 'create_task':
      return <CreateEditor item={item} onEdit={onEdit} />;
    case 'update_task':
      return <UpdateEditor item={item} onEdit={onEdit} />;
    case 'draft_minutes':
      return <MinutesEditor item={item} onEdit={onEdit} />;
    case 'schedule_meeting':
      return <MeetingEditor item={item} onEdit={onEdit} />;
  }
}
