import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { PROJECT_TEMPLATES_KEY, TASK_TEMPLATES_KEY, templatesApi } from '../../api/templates';
import { ApiError } from '../../lib/api-client';
import { useDialog } from '../../hooks/useDialog';
import { dayLabel } from '../../lib/day-label';
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
            <button type="button" onClick={onClose} disabled={busy} aria-label="Close" title="Close (Esc)" className="grid h-10 w-10 place-items-center rounded-lg text-ink-2 hover:bg-ground hover:text-ink disabled:opacity-40">
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

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy.current || !d || tooMany) return;
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
          <Button type="submit" form="save-project-template" loading={saving} disabled={!d || tooMany} className="!min-h-[44px] flex-[2] sm:flex-none sm:min-w-[9rem]">
            Save template
          </Button>
        </>
      }
    >
      <form id="save-project-template" onSubmit={(e) => void submit(e)} noValidate className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
        {banner ? <p role="alert" className="rounded-xl border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-sm text-danger">{banner}</p> : null}
        <div>
          <label htmlFor={ids.name} className="mb-1.5 flex items-baseline gap-1.5 text-sm font-semibold text-ink">Template name<span aria-hidden="true" className="text-danger">*</span></label>
          <input id={ids.name} ref={nameRef} value={name} onChange={(e) => { setName(e.target.value); setNameError(null); }} dir="auto" maxLength={NAME_MAX} aria-required="true" aria-invalid={nameError ? true : undefined} aria-describedby={nameError ? `${ids.name}-err` : undefined} className={field} />
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
              <p>{`Saves its board (${count(d.columnCount, 'column')}) and its ${count(d.taskCount, 'task')}, with their descriptions, priorities and checklists.`}</p>
              <p className="mt-1">
                {d.base.from === 'start'
                  ? `Due dates are kept as days from the project’s start, ${longDay(d.base.day)}.`
                  : `Due dates are kept as days from the day the project was created, ${longDay(d.base.day)} (it has no start date).`}
              </p>
              {tooMany ? <p role="alert" className="mt-2 font-medium text-danger">{`This project has ${d.taskCount} tasks; a template can hold at most ${d.maxTasks}.`}</p> : null}
            </div>
            {d.people.length ? (
              <fieldset aria-describedby={ids.people}>
                <legend className="mb-1 text-sm font-semibold text-ink">Roles for the people on its tasks</legend>
                <p id={ids.people} className="mb-2 text-xs text-ink-2">
                  Name a role (e.g. Inspector) and their tasks will name it: whoever makes a project from the template picks who fills it. Left empty, their tasks are unassigned in the template and go to the new project’s owner. The same name for two people makes one role.
                </p>
                <ul className="flex flex-col gap-2">
                  {d.people.map((p) => {
                    const who = p.name ?? 'Someone who has left';
                    return (
                      <li key={p.id} className="grid items-center gap-1 sm:grid-cols-[minmax(0,1fr)_14rem] sm:gap-3">
                        <span className="min-w-0 truncate text-sm text-ink">
                          <bdi>{who}</bdi> <span className="text-xs text-ink-3">· {count(p.taskCount, 'task')}</span>
                        </span>
                        <input
                          aria-label={`Role for ${who} (${count(p.taskCount, 'task')})`}
                          value={roles[p.id] ?? ''}
                          onChange={(e) => setRoles((r) => ({ ...r, [p.id]: e.target.value }))}
                          dir="auto"
                          maxLength={ROLE_MAX}
                          placeholder="No role"
                          className={field}
                        />
                      </li>
                    );
                  })}
                </ul>
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
export function SaveTaskTemplateDialog({ taskId, taskTitle, checklistCount, onClose }: { taskId: string; taskTitle: string; checklistCount?: number; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(taskTitle);
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
      const t = await templatesApi(apiClient).saveTask(taskId, name.trim() || taskTitle);
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
          {`Saves its title, description, priority and checklist${checklistCount ? ` (${count(checklistCount, 'item')})` : ''}. Its dates, people and project aren’t saved.`}
        </p>
        <div>
          <label htmlFor={nameId} className="mb-1.5 flex items-baseline gap-1.5 text-sm font-semibold text-ink">Template name</label>
          <input id={nameId} value={name} onChange={(e) => setName(e.target.value)} dir="auto" maxLength={NAME_MAX} className={field} />
          <p className="mt-1 text-xs text-ink-2">How it is listed in the New task form.</p>
        </div>
      </form>
    </Shell>
  );
}
