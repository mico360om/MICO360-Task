import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { PROJECT_TEMPLATES_KEY, TASK_TEMPLATES_KEY, templatesApi } from '../../api/templates';
import { ApiError } from '../../lib/api-client';
import { useDialog } from '../../hooks/useDialog';
import { dayLabel } from '../../lib/day-label';
import { stayOnEnter } from '../../lib/enter-key';
import { roleCounts } from './role-counts';
import { ModalPortal } from '../ui/ModalPortal';
import { Button } from '../ui/Button';
import { count, TemplateGlyph } from './TemplateCard';

const NAME_MAX = 191;
const ROLE_MAX = 80;
const reason = (err: unknown) =>
  err instanceof ApiError && err.message && !/^Request failed/.test(err.message)
    ? err.message
    : err instanceof TypeError
      ? 'The server couldn’t be reached.'
      : 'Please try again.';
const field = 'w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-brand focus:ring-2 focus:ring-brand/20';

/** "Sun 1 Nov 2026". */
const longDay = (key: string) => dayLabel(key, { year: true });

/** The small dialog both "Save as template" share: a heading, a body, and Cancel / Save — or, once saved, Done. */
function Shell({ title, onClose, busy, children, footer }: { title: string; onClose: () => void; busy: boolean; children: ReactNode; footer: ReactNode }) {
  const headingId = useId();
  const dialogRef = useDialog(busy ? () => {} : onClose);
  return (
    <ModalPortal>
      <div className="above-keyboard fixed inset-0 z-50 flex items-stretch justify-center sm:items-center sm:p-4">
        <div className="absolute inset-0 bg-ink/40 animate-fade-in" onClick={busy ? undefined : onClose} aria-hidden="true" />
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={headingId}
          className="keyboard-flow-cramped relative flex h-full w-full flex-col overflow-hidden bg-surface shadow-lift animate-scale-in sm:h-auto sm:max-h-[calc(var(--visible-height)*0.9)] sm:max-w-lg sm:rounded-2xl"
        >
          <div className="flex flex-none items-center gap-3 border-b border-line px-5 py-4">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand/10 text-brand">{TemplateGlyph.save}</span>
            <h2 id={headingId} className="flex-1 font-display text-xl font-bold text-ink">{title}</h2>
            <button type="button" onClick={onClose} disabled={busy} aria-label="Close" title="Close (Esc)" className="grid h-10 w-10 place-items-center rounded-lg text-ink-2 hover:bg-ground hover:text-ink disabled:opacity-40 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>
          {children}
          <div className="flex flex-none items-center gap-2 border-t border-line bg-surface px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:justify-end">{footer}</div>
        </div>
      </div>
    </ModalPortal>
  );
}

function Saved({ text, where }: { text: string; where: string }) {
  return (
    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 py-6 text-center">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-success-soft text-success" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
      </span>
      <p role="status" className="font-semibold text-ink">{text}</p>
      <p className="text-sm text-ink-2">{where}</p>
    </div>
  );
}

/** Said before saving: a template is company-wide. */
const publishWarning = (what: string) => `Everyone in the company will be able to see this template’s ${what}.`;

/** A plain tick box with its words (24px on touch screens: index.css). */
function Tick({ checked, onChange, children }: { checked: boolean; onChange: (on: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex min-h-[36px] cursor-pointer items-center gap-2.5 text-sm text-ink">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-brand" />
      {children}
    </label>
  );
}

const cancelClass = '!min-h-[44px] flex-1 rounded-xl border border-line px-4 text-sm font-semibold text-ink transition-colors hover:bg-ground disabled:opacity-50 sm:flex-none';

/**
 * "Save as template" for a project (whoever runs it): its board and its tasks — with their checklists,
 * and their due dates as days from the project's start — under a name. Each person its tasks are
 * assigned to can become a role ("Inspector"): their tasks then name that role, and whoever makes a
 * project from the template picks who fills it. Left empty, their tasks are unassigned in the
 * template (a new project gives them to its owner). The same role name for two people makes one role.
 */
export function SaveProjectTemplateDialog({ projectId, projectName, onClose }: { projectId: string; projectName: string; onClose: () => void }) {
  const qc = useQueryClient();
  const draftQ = useQuery({ queryKey: ['templates', 'draft', projectId], queryFn: () => templatesApi(apiClient).projectDraft(projectId), staleTime: 0 });
  const [name, setName] = useState(projectName);
  const [description, setDescription] = useState('');
  const [roles, setRoles] = useState<Record<string, string>>({});
  // Everyone can see a template: the saver may keep the tasks' descriptions out of it.
  const [withDescriptions, setWithDescriptions] = useState(true);
  const [nameError, setNameError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const busy = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const ids = { name: useId(), desc: useId(), people: useId() };
  // What the server said about the project (anything else is treated as not read yet).
  const d = draftQ.data?.base && Array.isArray(draftQ.data.people) ? draftQ.data : undefined;
  const tooMany = !!d && d.taskCount > d.maxTasks;
  const tooManyItems = !!d && d.checklistItems > d.maxChecklistItems;
  const people = d?.people ?? [];
  const counts = roleCounts(d?.assignments ?? [], people.map((p) => p.id), roles);
  const assignedTo = (id: string) => (d?.assignments ?? []).filter((onTask) => onTask.includes(id)).length;
  const roleTasks = (name: string) => counts.roles.find((r) => r.name.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase())?.tasks ?? 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy.current || !d || tooMany || tooManyItems) return;
    if (!name.trim()) {
      setNameError('Give the template a name.');
      nameRef.current?.focus();
      return;
    }
    busy.current = true;
    setSaving(true);
    setBanner(null);
    try {
      const t = await templatesApi(apiClient).saveProject(projectId, {
        name: name.trim(),
        description: description.trim() || null,
        roles: d.people.map((p) => ({ userId: p.id, name: (roles[p.id] ?? '').trim() })).filter((r) => r.name),
        includeDescriptions: withDescriptions,
      });
      void qc.invalidateQueries({ queryKey: PROJECT_TEMPLATES_KEY });
      setSaved(t.name);
    } catch (err) {
      setBanner(`Couldn’t save the template. ${reason(err)}`);
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  if (saved) {
    return (
      <Shell
        title="Save as template"
        onClose={onClose}
        busy={false}
        footer={
          <>
            <Link to="/templates" onClick={onClose} className="inline-flex !min-h-[44px] flex-1 items-center justify-center rounded-xl border border-line px-4 text-sm font-semibold text-ink transition-colors hover:bg-ground sm:flex-none">
              Open Templates
            </Link>
            <Button onClick={onClose} className="!min-h-[44px] flex-1 sm:flex-none sm:min-w-[7rem]">Done</Button>
          </>
        }
      >
        <Saved text={`Saved “${saved}” as a template.`} where="Anyone can start a new project from it: it is listed on the Templates page and in the New project form." />
      </Shell>
    );
  }

  return (
    <Shell
      title="Save as template"
      onClose={onClose}
      busy={saving}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={saving} className={cancelClass}>Cancel</button>
          <Button type="submit" form="save-project-template" loading={saving} disabled={!d || tooMany || tooManyItems} className="!min-h-[44px] flex-[2] sm:flex-none sm:min-w-[9rem]">
            Save template
          </Button>
        </>
      }
    >
      <form id="save-project-template" onSubmit={(e) => void submit(e)} noValidate className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
        {banner ? <p role="alert" className="rounded-xl border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-sm text-danger">{banner}</p> : null}
        <div>
          <label htmlFor={ids.name} className="mb-1.5 flex items-baseline gap-1.5 text-sm font-semibold text-ink">Template name<span aria-hidden="true" className="text-danger">*</span></label>
          <input id={ids.name} ref={nameRef} value={name} onChange={(e) => { setName(e.target.value); setNameError(null); }} onKeyDown={stayOnEnter} dir="auto" maxLength={NAME_MAX} aria-required="true" aria-invalid={nameError ? true : undefined} aria-describedby={nameError ? `${ids.name}-err` : undefined} className={field} />
          {nameError ? <p id={`${ids.name}-err`} className="mt-1 text-xs font-medium text-danger">{nameError}</p> : null}
        </div>
        <div>
          <label htmlFor={ids.desc} className="mb-1.5 flex items-baseline gap-1.5 text-sm font-semibold text-ink">Description <span className="text-xs font-normal text-ink-2">(optional)</span></label>
          <textarea id={ids.desc} value={description} onChange={(e) => setDescription(e.target.value)} dir="auto" rows={2} maxLength={20_000} placeholder="What kind of project it is for" className={`${field} resize-y`} />
        </div>

        {draftQ.isError ? (
          <p role="alert" className="text-sm text-danger">{`Couldn’t read the project. ${reason(draftQ.error)}`} <button type="button" onClick={() => void draftQ.refetch()} className="font-semibold underline">Retry</button></p>
        ) : !d ? (
          <div className="skeleton h-24 rounded-xl" aria-label="Reading the project" />
        ) : (
          <>
            <div className="rounded-xl bg-ground px-3.5 py-3 text-sm text-ink-2">
              <p>{`Saves its board (${count(d.columnCount, 'column')}) and its ${count(d.taskCount, 'task')}, with their ${withDescriptions ? 'descriptions, ' : ''}priorities and checklists.`}</p>
              <p className="mt-1">
                {d.base.from === 'start'
                  ? `Due dates are kept as days from the project’s start, ${longDay(d.base.day)}.`
                  : `Due dates are kept as days from the day the project was created, ${longDay(d.base.day)} (it has no start date).`}
              </p>
              {d.columnsTotal > d.columnCount ? <p className="mt-1 font-medium text-warning">{`Only the first ${d.columnCount} of its ${d.columnsTotal} columns are kept.`}</p> : null}
              {d.checklistTrimmed ? (
                <p className="mt-1 font-medium text-warning">
                  {d.checklistTrimmed === 1 ? '1 task has more than 100 checklist items: only its first 100 are kept.' : `${d.checklistTrimmed} tasks have more than 100 checklist items: only their first 100 are kept.`}
                </p>
              ) : null}
              {tooMany ? <p role="alert" className="mt-2 font-medium text-danger">{`This project has ${d.taskCount} tasks; a template can hold at most ${d.maxTasks}.`}</p> : null}
              {tooManyItems ? (
                <p role="alert" className="mt-2 font-medium text-danger">{`Its checklists hold ${d.checklistItems.toLocaleString('en-US')} items in all; a template can hold at most ${d.maxChecklistItems.toLocaleString('en-US')}.`}</p>
              ) : null}
            </div>
            <div className="rounded-xl border border-warning/40 bg-warning-soft px-3.5 py-3">
              <p className="text-sm font-medium text-ink">{publishWarning(withDescriptions ? 'task titles, descriptions and checklists' : 'task titles and checklists')}</p>
              <Tick checked={withDescriptions} onChange={setWithDescriptions}>Include task descriptions</Tick>
            </div>
            {d.people.length ? (
              <fieldset aria-describedby={ids.people}>
                <legend className="mb-1 text-sm font-semibold text-ink">Roles for the people on its tasks</legend>
                <p id={ids.people} className="mb-2 text-xs text-ink-2">
                  Name a role (e.g. Inspector) and their tasks will name it: whoever makes a project from the template picks who fills it. Left empty, their tasks are unassigned in the template and go to the new project’s owner. The same name for two people makes one role.
                </p>
                <ul className="flex flex-col gap-3">
                  {d.people.map((p) => {
                    const who = p.name ?? 'Someone who has left';
                    const role = (roles[p.id] ?? '').trim();
                    const on = assignedTo(p.id);
                    const gets = counts.fromPerson.get(p.id) ?? 0;
                    const noteId = `${ids.people}-${p.id}`;
                    // What naming this role really does, by the same rule the server saves with.
                    const note = !role
                      ? `On ${count(on, 'task')}.`
                      : roleTasks(role) === 0
                        ? `“${role}” won’t become a role: each of these tasks names another role first.`
                        : gets === on
                          ? `${role} gets ${on === 1 ? 'this task' : `all ${on} of these tasks`}.`
                          : gets === 0
                            ? `These tasks name another role first: ${role} gets its tasks from others.`
                            : `${role} gets ${gets} of these ${on} tasks; the others name another role first.`;
                    return (
                      <li key={p.id} className="grid items-start gap-1 sm:grid-cols-[minmax(0,1fr)_14rem] sm:gap-3">
                        <div className="min-w-0 sm:pt-2">
                          <span className="block truncate text-sm text-ink"><bdi>{who}</bdi></span>
                          <span id={noteId} data-testid={`role-for-${p.id}`} className={`block text-xs ${role && roleTasks(role) === 0 ? 'font-medium text-warning' : 'text-ink-3'}`}>{note}</span>
                        </div>
                        <input
                          aria-label={`Role for ${who}`}
                          aria-describedby={noteId}
                          value={roles[p.id] ?? ''}
                          onChange={(e) => setRoles((r) => ({ ...r, [p.id]: e.target.value }))}
                          onKeyDown={stayOnEnter}
                          dir="auto"
                          maxLength={ROLE_MAX}
                          placeholder="No role"
                          className={field}
                        />
                      </li>
                    );
                  })}
                </ul>
                <p data-testid="role-summary" aria-live="polite" className="mt-3 text-xs text-ink-2">
                  {counts.roles.some((r) => r.tasks) ? `${counts.roles.filter((r) => r.tasks).map((r) => `${r.name}: ${count(r.tasks, 'task')}`).join(' · ')}. ` : 'No roles yet. '}
                  {counts.unassigned ? `${count(counts.unassigned, 'task')} will be unassigned (they go to the new project’s owner).` : ''}
                </p>
              </fieldset>
            ) : (
              <p className="text-sm text-ink-2">Nobody is assigned to its tasks: they are saved unassigned.</p>
            )}
          </>
        )}
      </form>
    </Shell>
  );
}

/** "Save as template" for a task (whoever runs its project): its title, description, priority and checklist, under a name. */
export function SaveTaskTemplateDialog({
  taskId,
  taskTitle,
  checklistCount,
  hasDescription = true,
  onClose,
}: {
  taskId: string;
  taskTitle: string;
  checklistCount?: number;
  /** The task has a description (else there is nothing to leave out). */
  hasDescription?: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(taskTitle);
  const [withDescription, setWithDescription] = useState(true);
  const [banner, setBanner] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const busy = useRef(false);
  const nameId = useId();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setBanner(null);
    try {
      const t = await templatesApi(apiClient).saveTask(taskId, { name: name.trim() || taskTitle, includeDescription: withDescription });
      void qc.invalidateQueries({ queryKey: TASK_TEMPLATES_KEY });
      setSaved(t.name);
    } catch (err) {
      setBanner(`Couldn’t save the template. ${reason(err)}`);
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  if (saved) {
    return (
      <Shell
        title="Save task as template"
        onClose={onClose}
        busy={false}
        footer={
          <>
            <Link to="/templates?tab=tasks" onClick={onClose} className="inline-flex !min-h-[44px] flex-1 items-center justify-center rounded-xl border border-line px-4 text-sm font-semibold text-ink transition-colors hover:bg-ground sm:flex-none">
              Open Templates
            </Link>
            <Button onClick={onClose} className="!min-h-[44px] flex-1 sm:flex-none sm:min-w-[7rem]">Done</Button>
          </>
        }
      >
        <Saved text={`Saved “${saved}” as a task template.`} where="Anyone can start a new task from it in the New task form." />
      </Shell>
    );
  }

  return (
    <Shell
      title="Save task as template"
      onClose={onClose}
      busy={saving}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={saving} className={cancelClass}>Cancel</button>
          <Button type="submit" form="save-task-template" loading={saving} className="!min-h-[44px] flex-[2] sm:flex-none sm:min-w-[9rem]">Save template</Button>
        </>
      }
    >
      <form id="save-task-template" onSubmit={(e) => void submit(e)} noValidate className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
        {banner ? <p role="alert" className="rounded-xl border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-sm text-danger">{banner}</p> : null}
        <p className="text-sm text-ink-2">
          {`Saves its title, ${withDescription && hasDescription ? 'description, ' : ''}priority and checklist${checklistCount ? ` (${count(checklistCount, 'item')})` : ''}. Its dates, people and project aren’t saved.`}
        </p>
        <div className="rounded-xl border border-warning/40 bg-warning-soft px-3.5 py-3">
          <p className="text-sm font-medium text-ink">{publishWarning(withDescription && hasDescription ? 'task title, description and checklist' : 'task title and checklist')}</p>
          {hasDescription ? <Tick checked={withDescription} onChange={setWithDescription}>Include its description</Tick> : null}
        </div>
        <div>
          <label htmlFor={nameId} className="mb-1.5 flex items-baseline gap-1.5 text-sm font-semibold text-ink">Template name</label>
          <input id={nameId} value={name} onChange={(e) => setName(e.target.value)} dir="auto" maxLength={NAME_MAX} className={field} />
          <p className="mt-1 text-xs text-ink-2">How it is listed in the New task form.</p>
        </div>
      </form>
    </Shell>
  );
}
