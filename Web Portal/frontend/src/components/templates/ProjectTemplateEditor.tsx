import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import type { Priority } from '../../api/tasks';
import {
  PROJECT_TEMPLATES_KEY,
  offsetLabel,
  offsetShort,
  templatesApi,
  type ColumnCategory,
  type ProjectTemplate,
  type ProjectTemplateInput,
  type TemplateColumn,
} from '../../api/templates';
import { ApiError } from '../../lib/api-client';
import { STATUS_META, STATUS_ORDER } from '../../lib/taskStatus';
import { useDialog } from '../../hooks/useDialog';
import { ModalPortal } from '../ui/ModalPortal';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { PriorityBadge } from '../ui/PriorityBadge';
import { ChecklistField } from '../task-form/ChecklistField';
import { PRIORITIES, priorityLabel } from '../priority-option';
import { count, TemplateGlyph } from './TemplateCard';

/** What the server keeps (see the backend's TEMPLATE_LIMITS). */
export const LIMITS = { columns: 20, roles: 30, tasks: 500, roleName: 80, title: 191, description: 20_000, minOffset: -365, maxOffset: 3650 };

/** The board a new project gets when nothing else is chosen (the backend's DEFAULT_COLUMNS). */
export const DEFAULT_BOARD: TemplateColumn[] = [
  { name: 'Backlog', category: 'BACKLOG', color: '#948985' },
  { name: 'To Do', category: 'TODO', color: '#3A6EA5' },
  { name: 'In Progress', category: 'IN_PROGRESS', color: '#B87611' },
  { name: 'Review', category: 'REVIEW', color: '#7A5AA8' },
  { name: 'Done', category: 'DONE', color: '#2E7D53' },
];

interface DraftTask {
  /** This editor's own key for the row (React's list key). */
  id: string;
  title: string;
  description: string;
  priority: Priority;
  dueOffsetDays: number | null;
  roleKey: string | null;
  checklist: string[];
}

interface Draft {
  name: string;
  description: string;
  columns: TemplateColumn[];
  /** `key`: an existing role's id (kept as it is), or a new one's own key. */
  roles: { key: string; name: string }[];
  tasks: DraftTask[];
}

let seq = 0;
const newKey = (prefix: string) => `${prefix}-${++seq}-${Date.now().toString(36)}`;

const draftOf = (t?: ProjectTemplate | null): Draft =>
  t
    ? {
        name: t.name,
        description: t.description ?? '',
        columns: t.columns.map((c) => ({ ...c })),
        roles: t.roles.map((r) => ({ key: r.id, name: r.name })),
        tasks: t.tasks.map((x) => ({ id: x.id, title: x.title, description: x.description ?? '', priority: x.priority, dueOffsetDays: x.dueOffsetDays, roleKey: x.roleId, checklist: [...x.checklist] })),
      }
    : { name: '', description: '', columns: DEFAULT_BOARD.map((c) => ({ ...c })), roles: [], tasks: [] };

/** Everything wrong with a draft, in plain words (empty when it can be saved). */
export function draftProblems(d: Draft): string[] {
  const out: string[] = [];
  if (!d.name.trim()) out.push('Give the template a name.');
  d.columns.forEach((c, i) => { if (!c.name.trim()) out.push(`Column ${i + 1} needs a name.`); });
  if (!d.columns.some((c) => c.category !== 'DONE')) out.push('The board needs at least one column that isn’t Done, for the tasks to start in.');
  const seen = new Set<string>();
  d.roles.forEach((r, i) => {
    const n = r.name.trim().toLocaleLowerCase();
    if (!n) out.push(`Role ${i + 1} needs a name.`);
    else if (seen.has(n)) out.push(`Two roles are called “${r.name.trim()}”. Give each role its own name.`);
    seen.add(n);
  });
  d.tasks.forEach((t, i) => { if (!t.title.trim()) out.push(`Task ${i + 1} needs a title.`); });
  return out;
}

const clampOffset = (n: number) => Math.max(LIMITS.minOffset, Math.min(LIMITS.maxOffset, Math.trunc(n)));

function toInput(d: Draft): ProjectTemplateInput {
  const roleKeys = new Set(d.roles.map((r) => r.key));
  return {
    name: d.name.trim(),
    description: d.description.trim() || null,
    columns: d.columns.map((c) => ({ name: c.name.trim(), category: c.category, color: c.color })),
    roles: d.roles.map((r) => ({ key: r.key, name: r.name.trim() })),
    tasks: d.tasks.map((t) => ({
      title: t.title.trim(),
      description: t.description.trim() || null,
      priority: t.priority,
      dueOffsetDays: t.dueOffsetDays === null ? null : clampOffset(t.dueOffsetDays),
      roleKey: t.roleKey && roleKeys.has(t.roleKey) ? t.roleKey : null,
      checklist: t.checklist.map((c) => c.trim()).filter(Boolean),
    })),
  };
}

const reason = (err: unknown) => (err instanceof ApiError && err.message && !/^Request failed/.test(err.message) ? err.message : err instanceof TypeError ? 'The server couldn’t be reached.' : 'Please try again.');

const field = 'w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-brand focus:ring-2 focus:ring-brand/20';
const iconButton = 'grid h-9 w-9 flex-none place-items-center rounded-lg text-ink-2 transition-colors hover:bg-ground hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent';
const ARROW = {
  up: <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 15l-6-6-6 6" /></svg>,
  down: <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>,
  close: <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>,
};

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

function Section({ title, aside, help, children, label }: { title: string; aside?: ReactNode; help?: ReactNode; children: ReactNode; label: string }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="rounded-2xl border border-line p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={id} className="font-display text-base font-semibold text-ink">{title}</h3>
        {aside}
      </div>
      {help ? <p className="mb-3 text-xs text-ink-2">{help}</p> : null}
      <div role="group" aria-label={label}>{children}</div>
    </section>
  );
}

/**
 * Create or edit a project template: its name and description, its board, the roles its tasks can
 * name instead of a person, and its standard tasks — each with a title, priority, a due date in days
 * from the project's start (or none), who does it (a role, or the project's owner), a description and
 * a checklist. Tasks show as one line each and open to be edited, so a long template stays easy to
 * read. Saving replaces the template whole; a role kept here keeps its place in projects being made.
 */
export function ProjectTemplateEditor({ templateId, onClose, onSaved }: { templateId: string | null; onClose: () => void; onSaved?: (t: ProjectTemplate) => void }) {
  const qc = useQueryClient();
  const editing = templateId !== null;
  const loadQ = useQuery({ queryKey: ['templates', 'projects', templateId], queryFn: () => templatesApi(apiClient).getProject(templateId!), enabled: editing });
  const [initial, setInitial] = useState<Draft>(() => draftOf(null));
  const [draft, setDraft] = useState<Draft>(() => draftOf(null));
  const [loaded, setLoaded] = useState(!editing);
  const [open, setOpen] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [banner, setBanner] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const busy = useRef(false);
  const titleRefs = useRef(new Map<string, HTMLInputElement>());
  const focusTask = useRef<string | null>(null);
  const ids = { title: useId(), name: useId(), desc: useId() };

  useEffect(() => {
    if (!editing || loaded || !loadQ.data) return;
    setInitial(draftOf(loadQ.data));
    setDraft(draftOf(loadQ.data));
    setLoaded(true);
  }, [editing, loaded, loadQ.data]);

  useEffect(() => {
    if (!focusTask.current) return;
    titleRefs.current.get(focusTask.current)?.focus();
    focusTask.current = null;
  });

  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const requestClose = () => {
    if (busy.current) return;
    if (dirty) setConfirmClose(true);
    else onClose();
  };
  const dialogRef = useDialog(requestClose);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const setTask = (id: string, patch: Partial<DraftTask>) => setDraft((d) => ({ ...d, tasks: d.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
  const setColumn = (i: number, patch: Partial<TemplateColumn>) => setDraft((d) => ({ ...d, columns: d.columns.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));
  const roleName = (key: string | null) => (key ? draft.roles.find((r) => r.key === key)?.name.trim() || null : null);

  function addTask() {
    const id = newKey('task');
    setDraft((d) => ({ ...d, tasks: [...d.tasks, { id, title: '', description: '', priority: 'NORMAL', dueOffsetDays: null, roleKey: null, checklist: [] }] }));
    setOpen(id);
    focusTask.current = id;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy.current) return;
    const found = draftProblems(draft);
    setProblems(found);
    if (found.length) return;
    busy.current = true;
    setSaving(true);
    setBanner(null);
    try {
      const input = toInput(draft);
      const saved = editing ? await templatesApi(apiClient).updateProjectTemplate(templateId!, input) : await templatesApi(apiClient).createProjectTemplate(input);
      void qc.invalidateQueries({ queryKey: PROJECT_TEMPLATES_KEY });
      void qc.invalidateQueries({ queryKey: ['templates', 'projects', saved.id] });
      onSaved?.(saved);
      onClose();
    } catch (err) {
      setBanner(`Couldn’t save the template. ${reason(err)}`);
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  const heading = editing ? 'Edit project template' : 'New project template';

  return (
    <ModalPortal>
      <div className="above-keyboard fixed inset-0 z-50 flex items-stretch justify-center sm:items-center sm:p-4">
        <div className="absolute inset-0 bg-ink/40 animate-fade-in" onClick={requestClose} aria-hidden="true" />
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={ids.title}
          className="keyboard-flow-cramped relative flex h-full w-full flex-col overflow-hidden bg-surface shadow-lift animate-scale-in sm:h-auto sm:max-h-[calc(var(--visible-height)*0.92)] sm:w-[min(880px,calc(100vw-32px))] sm:rounded-2xl"
        >
          <div className="flex flex-none items-center gap-3 border-b border-line px-4 py-3.5 sm:px-6">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand/10 text-brand">{TemplateGlyph.project}</span>
            <h2 id={ids.title} className="flex-1 font-display text-xl font-bold text-ink">{heading}</h2>
            <button type="button" onClick={requestClose} aria-label="Close" title="Close (Esc)" className="grid h-10 w-10 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-ground hover:text-ink">{ARROW.close}</button>
          </div>

          <form onSubmit={(e) => void submit(e)} noValidate className="keyboard-flow-body flex min-h-0 flex-1 flex-col">
            <div className="keyboard-flow-body min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5">
              {banner ? <p role="alert" className="rounded-xl border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-sm text-danger">{banner}</p> : null}
              {problems.length ? (
                <div role="alert" className="rounded-xl border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
                  <p className="font-semibold">Before saving:</p>
                  <ul className="mt-1 list-disc ps-5">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
                </div>
              ) : null}
              {editing && !loaded ? (
                loadQ.isError ? (
                  <p role="alert" className="text-sm text-danger">Couldn’t load the template. <button type="button" className="font-semibold underline" onClick={() => void loadQ.refetch()}>Retry</button></p>
                ) : (
                  <div className="space-y-3" aria-label="Loading the template"><div className="skeleton h-10 rounded-xl" /><div className="skeleton h-40 rounded-xl" /></div>
                )
              ) : (
                <>
                  <div className="grid gap-4">
                    <div>
                      <label htmlFor={ids.name} className="mb-1.5 flex items-baseline gap-1.5 text-sm font-semibold text-ink">Name<span aria-hidden="true" className="text-danger">*</span></label>
                      <input id={ids.name} value={draft.name} onChange={(e) => set({ name: e.target.value })} dir="auto" maxLength={LIMITS.title} aria-required="true" placeholder="e.g. Rig inspection" className={`${field} h-11`} />
                    </div>
                    <div>
                      <label htmlFor={ids.desc} className="mb-1.5 flex items-baseline gap-1.5 text-sm font-semibold text-ink">Description <span className="text-xs font-normal text-ink-2">(optional)</span></label>
                      <textarea id={ids.desc} value={draft.description} onChange={(e) => set({ description: e.target.value })} dir="auto" rows={2} maxLength={LIMITS.description} placeholder="What kind of project it is for" className={`${field} resize-y`} />
                    </div>
                  </div>

                  <Section
                    title="Board"
                    label="Board columns"
                    help="The columns a project made from this template starts with. Its tasks start in the first To Do column."
                    aside={<span className="text-xs text-ink-3">{count(draft.columns.length, 'column')}</span>}
                  >
                    <ol className="flex flex-col gap-2">
                      {draft.columns.map((c, i) => (
                        <li key={i} className="flex flex-wrap items-center gap-2 rounded-xl border border-line p-2 sm:flex-nowrap">
                          <label className="relative h-8 w-8 flex-none cursor-pointer overflow-hidden rounded-lg border border-line" style={{ background: c.color }} title="Colour">
                            <input type="color" aria-label={`Column ${i + 1} colour`} value={/^#[0-9a-f]{6}$/i.test(c.color) ? c.color : '#948985'} onChange={(e) => setColumn(i, { color: e.target.value })} className="absolute inset-0 cursor-pointer opacity-0" />
                          </label>
                          <input aria-label={`Column ${i + 1} name`} value={c.name} onChange={(e) => setColumn(i, { name: e.target.value })} dir="auto" maxLength={LIMITS.title} className={`${field} min-w-0 flex-1 basis-40`} />
                          <select aria-label={`Column ${i + 1} stage`} value={c.category} onChange={(e) => setColumn(i, { category: e.target.value as ColumnCategory })} className={`${field} w-auto flex-none basis-36`}>
                            {STATUS_ORDER.map((cat) => <option key={cat} value={cat}>{STATUS_META[cat]!.label}</option>)}
                          </select>
                          <div className="ms-auto flex flex-none items-center">
                            <button type="button" className={iconButton} disabled={i === 0} onClick={() => set({ columns: move(draft.columns, i, i - 1) })} aria-label={`Move column ${i + 1} left`}>{ARROW.up}</button>
                            <button type="button" className={iconButton} disabled={i === draft.columns.length - 1} onClick={() => set({ columns: move(draft.columns, i, i + 1) })} aria-label={`Move column ${i + 1} right`}>{ARROW.down}</button>
                            <button type="button" className={`${iconButton} hover:!bg-danger-soft hover:!text-danger`} disabled={draft.columns.length <= 1} onClick={() => set({ columns: draft.columns.filter((_, j) => j !== i) })} aria-label={`Remove column ${i + 1}: ${c.name}`}>{ARROW.close}</button>
                          </div>
                        </li>
                      ))}
                    </ol>
                    {draft.columns.length < LIMITS.columns ? (
                      <button type="button" onClick={() => set({ columns: [...draft.columns, { name: '', category: 'TODO', color: '#3A6EA5' }] })} className="mt-2 inline-flex !min-h-[40px] items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-brand hover:bg-brand/10">
                        {TemplateGlyph.plus}Add a column
                      </button>
                    ) : null}
                  </Section>

                  <Section
                    title="Roles"
                    label="Roles"
                    help="Tasks can name a role instead of a person. Whoever makes a project from the template picks who fills each role."
                    aside={<span className="text-xs text-ink-3">{count(draft.roles.length, 'role')}</span>}
                  >
                    {draft.roles.length ? (
                      <ol className="grid gap-2 sm:grid-cols-2">
                        {draft.roles.map((r, i) => (
                          <li key={r.key} className="flex items-center gap-2">
                            <input aria-label={`Role ${i + 1} name`} value={r.name} onChange={(e) => set({ roles: draft.roles.map((x) => (x.key === r.key ? { ...x, name: e.target.value } : x)) })} dir="auto" maxLength={LIMITS.roleName} placeholder="e.g. Inspector" className={`${field} min-w-0 flex-1`} />
                            <button
                              type="button"
                              className={`${iconButton} hover:!bg-danger-soft hover:!text-danger`}
                              onClick={() => setDraft((d) => ({ ...d, roles: d.roles.filter((x) => x.key !== r.key), tasks: d.tasks.map((t) => (t.roleKey === r.key ? { ...t, roleKey: null } : t)) }))}
                              aria-label={`Remove role ${i + 1}: ${r.name}`}
                            >
                              {ARROW.close}
                            </button>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="text-sm text-ink-3">No roles: every task goes to the project’s owner unless it is changed afterwards.</p>
                    )}
                    {draft.roles.length < LIMITS.roles ? (
                      <button type="button" onClick={() => set({ roles: [...draft.roles, { key: newKey('role'), name: '' }] })} className="mt-2 inline-flex !min-h-[40px] items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-brand hover:bg-brand/10">
                        {TemplateGlyph.plus}Add a role
                      </button>
                    ) : null}
                  </Section>

                  <Section
                    title="Tasks"
                    label="Template tasks"
                    help="Each is due a number of days after the project’s start (0 is the start day). A due day on a day off moves to the next working day."
                    aside={<span className="text-xs text-ink-3">{count(draft.tasks.length, 'task')}</span>}
                  >
                    {draft.tasks.length ? (
                      <ol aria-label="Tasks" className="flex flex-col divide-y divide-line rounded-xl border border-line">
                        {draft.tasks.map((t, i) => {
                          const n = i + 1;
                          const label = t.title.trim() || 'Untitled';
                          const expanded = open === t.id;
                          const summary = [offsetShort(t.dueOffsetDays), roleName(t.roleKey), t.checklist.length ? count(t.checklist.length, 'checklist item') : null].filter(Boolean).join(' · ');
                          return (
                            <li key={t.id} className="p-2">
                              <div className="flex items-center gap-2">
                                <span className="w-7 flex-none text-end text-xs tabular-nums text-ink-3">{n}</span>
                                <div className="min-w-0 flex-1">
                                  <p data-testid="task-title" dir="auto" className={`truncate text-sm font-medium ${t.title.trim() ? 'text-ink' : 'italic text-ink-3'}`}>{label}</p>
                                  <p className="flex flex-wrap items-center gap-x-2 text-xs text-ink-2">
                                    <span>{summary}</span>
                                    {t.priority !== 'NORMAL' ? <PriorityBadge priority={t.priority} /> : null}
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setOpen(expanded ? null : t.id)}
                                  aria-expanded={expanded}
                                  aria-label={`${expanded ? 'Close' : 'Edit'} task ${n}: ${label}`}
                                  className="!min-h-[36px] flex-none rounded-lg border border-line px-2.5 text-xs font-semibold text-ink transition-colors hover:border-brand hover:text-brand"
                                >
                                  {expanded ? 'Done' : 'Edit'}
                                </button>
                                <button type="button" className={iconButton} disabled={i === 0} onClick={() => set({ tasks: move(draft.tasks, i, i - 1) })} aria-label={`Move task ${n} up`}>{ARROW.up}</button>
                                <button type="button" className={iconButton} disabled={i === draft.tasks.length - 1} onClick={() => set({ tasks: move(draft.tasks, i, i + 1) })} aria-label={`Move task ${n} down`}>{ARROW.down}</button>
                                <button type="button" className={`${iconButton} hover:!bg-danger-soft hover:!text-danger`} onClick={() => set({ tasks: draft.tasks.filter((x) => x.id !== t.id) })} aria-label={`Remove task ${n}: ${label}`}>{ARROW.close}</button>
                              </div>
                              {expanded ? (
                                <TaskFields
                                  n={n}
                                  task={t}
                                  roles={draft.roles}
                                  onChange={(patch) => setTask(t.id, patch)}
                                  titleRef={(el) => { if (el) titleRefs.current.set(t.id, el); else titleRefs.current.delete(t.id); }}
                                />
                              ) : null}
                            </li>
                          );
                        })}
                      </ol>
                    ) : (
                      <p className="text-sm text-ink-3">No tasks yet.</p>
                    )}
                    {draft.tasks.length < LIMITS.tasks ? (
                      <button type="button" onClick={addTask} className="mt-2 inline-flex !min-h-[40px] items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-brand hover:bg-brand/10">
                        {TemplateGlyph.plus}Add a task
                      </button>
                    ) : (
                      <p className="mt-2 text-xs text-ink-2">A template holds up to {LIMITS.tasks} tasks.</p>
                    )}
                  </Section>
                </>
              )}
            </div>

            <div className="flex flex-none items-center gap-2 border-t border-line bg-surface px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:justify-end sm:px-6">
              <button type="button" onClick={requestClose} disabled={saving} className="!min-h-[44px] flex-1 rounded-xl border border-line px-4 text-sm font-semibold text-ink transition-colors hover:bg-ground disabled:opacity-50 sm:flex-none">
                Cancel
              </button>
              <Button type="submit" shortcut={editing ? 'save' : 'submit'} showShortcut loading={saving} disabled={editing && !loaded} className="!min-h-[44px] flex-[2] sm:flex-none sm:min-w-[10rem]">
                {saving ? 'Saving…' : editing ? 'Save template' : 'Create template'}
              </Button>
            </div>
          </form>
        </div>
      </div>
      {confirmClose ? (
        <ConfirmDialog title="Discard your changes?" confirmLabel="Discard" keepLabel="Keep editing" onConfirm={() => { setConfirmClose(false); onClose(); }} onClose={() => setConfirmClose(false)}>
          What you changed in this template hasn’t been saved.
        </ConfirmDialog>
      ) : null}
    </ModalPortal>
  );
}

/** One template task opened for editing. */
function TaskFields({ n, task, roles, onChange, titleRef }: { n: number; task: DraftTask; roles: { key: string; name: string }[]; onChange: (patch: Partial<DraftTask>) => void; titleRef: (el: HTMLInputElement | null) => void }) {
  const ids = { title: useId(), priority: useId(), offset: useId(), offsetNote: useId(), role: useId(), desc: useId() };
  const noDate = task.dueOffsetDays === null;
  return (
    <fieldset role="group" aria-label={`Task ${n}`} className="mt-2 grid gap-3 rounded-xl bg-ground/60 p-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label htmlFor={ids.title} className="mb-1 block text-xs font-semibold text-ink">Title</label>
        <input id={ids.title} ref={titleRef} value={task.title} onChange={(e) => onChange({ title: e.target.value })} dir="auto" maxLength={LIMITS.title} placeholder="What needs to be done?" className={field} />
      </div>
      <div>
        <span className="mb-1 block text-xs font-semibold text-ink">Due</span>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id={ids.offset}
            type="number"
            inputMode="numeric"
            min={LIMITS.minOffset}
            max={LIMITS.maxOffset}
            step={1}
            aria-label="Days after the start"
            aria-describedby={ids.offsetNote}
            placeholder="—"
            value={noDate ? '' : task.dueOffsetDays!}
            // Typing a number gives the task a due date; emptying the box takes it away.
            onChange={(e) => onChange({ dueOffsetDays: e.target.value === '' ? null : Math.trunc(Number(e.target.value)) || 0 })}
            className={`${field} !w-24 flex-none tabular-nums`}
          />
          <span className="text-xs text-ink-2">days after the start</span>
          <label className="inline-flex min-h-[36px] cursor-pointer items-center gap-2 text-xs text-ink">
            <input type="checkbox" checked={noDate} onChange={(e) => onChange({ dueOffsetDays: e.target.checked ? null : 0 })} className="h-4 w-4 accent-brand" />
            No due date
          </label>
        </div>
        <p id={ids.offsetNote} className="mt-1 text-xs text-ink-3">{offsetLabel(task.dueOffsetDays)}{noDate ? '' : '. A negative number is before the start.'}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 sm:gap-2">
        <div>
          <label htmlFor={ids.priority} className="mb-1 block text-xs font-semibold text-ink">Priority</label>
          <select id={ids.priority} value={task.priority} onChange={(e) => onChange({ priority: e.target.value as Priority })} className={field}>
            {PRIORITIES.map((p) => <option key={p} value={p}>{priorityLabel(p)}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={ids.role} className="mb-1 block text-xs font-semibold text-ink">Who does it</label>
          <select id={ids.role} value={task.roleKey ?? ''} onChange={(e) => onChange({ roleKey: e.target.value || null })} className={field}>
            <option value="">The project’s owner</option>
            {roles.filter((r) => r.name.trim()).map((r) => <option key={r.key} value={r.key}>{r.name.trim()}</option>)}
          </select>
        </div>
      </div>
      <div className="sm:col-span-2">
        <label htmlFor={ids.desc} className="mb-1 block text-xs font-semibold text-ink">Description <span className="font-normal text-ink-2">(optional)</span></label>
        <textarea id={ids.desc} value={task.description} onChange={(e) => onChange({ description: e.target.value })} dir="auto" rows={3} maxLength={LIMITS.description} className={`${field} resize-y`} />
      </div>
      <div className="sm:col-span-2">
        <span className="mb-1 block text-xs font-semibold text-ink">Checklist <span className="font-normal text-ink-2">(optional)</span></span>
        <ChecklistField items={task.checklist} onChange={(checklist) => onChange({ checklist })} />
      </div>
    </fieldset>
  );
}
