import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { projectsApi, projectStatusLabel, type ApiProject, type NewProjectInput, type ProjectStatus } from '../../api/projects';
import { usersApi } from '../../api/users';
import type { Priority } from '../../api/tasks';
import { ApiError } from '../../lib/api-client';
import { codeProblem, suggestCode } from '../../lib/project-icons';
import { useDialog } from '../../hooks/useDialog';
import { ModalPortal } from '../ui/ModalPortal';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { SearchableSelect } from '../ui/SearchableSelect';
import { Avatar } from '../ui/Avatar';
import { ProjectAvatar } from '../ProjectAvatar';
import { IdentityEditor, type ImageChoice } from './IdentityEditor';
import { priorityOptions } from '../priority-option';

const NAME_MAX = 191;
const DESCRIPTION_MAX = 20_000;
const DEFAULT_COLOR = '#8B1E1E';

const STATUS_DOT: Record<ProjectStatus, string> = { PLANNING: 'bg-info', ACTIVE: 'bg-success', ON_HOLD: 'bg-warning', COMPLETED: 'bg-brand', ARCHIVED: 'bg-ink-3' };

interface Draft {
  name: string;
  code: string;
  clientName: string;
  description: string;
  status: ProjectStatus;
  priority: Priority;
  ownerId: string;
  color: string;
  icon: string | null;
}

const draftOf = (p?: ApiProject | null): Draft => ({
  name: p?.name ?? '',
  code: p?.code ?? '',
  clientName: p?.clientName ?? '',
  description: p?.description ?? '',
  status: p?.status ?? 'PLANNING',
  priority: p?.priority ?? 'NORMAL',
  ownerId: p?.ownerId ?? '',
  color: p?.color ?? DEFAULT_COLOR,
  icon: p?.icon ?? null,
});

/** The changes worth sending for an existing project (the code never changes). */
function changes(before: Draft, after: Draft): Partial<NewProjectInput> {
  const patch: Partial<NewProjectInput> = {};
  if (after.name.trim() !== before.name.trim()) patch.name = after.name.trim();
  if (after.clientName.trim() !== before.clientName.trim()) patch.clientName = after.clientName.trim();
  if (after.description.trim() !== before.description.trim()) patch.description = after.description.trim();
  if (after.status !== before.status) patch.status = after.status;
  if (after.priority !== before.priority) patch.priority = after.priority;
  if (after.ownerId !== before.ownerId) patch.ownerId = after.ownerId || null;
  if (after.color.toUpperCase() !== before.color.toUpperCase()) patch.color = after.color;
  if (after.icon !== before.icon) patch.icon = after.icon;
  return patch;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const reason = (err: unknown) => (err instanceof ApiError && err.message && !/^Request failed/.test(err.message) ? err.message : err instanceof TypeError ? 'The server couldn’t be reached.' : 'Please try again.');

function Label({ htmlFor, required, optional, children }: { htmlFor: string; required?: boolean; optional?: boolean; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 flex items-baseline gap-1.5 text-sm font-semibold text-ink">
      {children}
      {required ? <span aria-hidden="true" className="text-danger">*</span> : null}
      {optional ? <span className="text-xs font-normal text-ink-2">(optional)</span> : null}
    </label>
  );
}

const input = (bad: boolean) =>
  `w-full rounded-xl border bg-surface px-3.5 py-2.5 text-sm text-ink outline-none transition-colors placeholder:text-ink-3 focus:ring-2 ${
    bad ? 'border-danger focus:border-danger focus:ring-danger/20' : 'border-line focus:border-brand focus:ring-brand/20'
  }`;

/**
 * Create or edit a project: its look (icon and colour, or a cropped picture), name and code,
 * client, description, status, priority and owner. Saving shows progress and can't be sent twice;
 * what was typed stays after an error; closing with changes asks first.
 */
export function ProjectFormDialog({ project, onClose, onSaved }: { project?: ApiProject | null; onClose: () => void; onSaved?: (p: ApiProject) => void }) {
  const qc = useQueryClient();
  // After "create" succeeds but its picture doesn't, the dialog carries on editing the new project.
  const [saved, setSaved] = useState<ApiProject | null>(project ?? null);
  const editing = !!saved;
  const [initial, setInitial] = useState<Draft>(() => draftOf(project));
  const [draft, setDraft] = useState<Draft>(() => draftOf(project));
  const [image, setImage] = useState<ImageChoice>({ kind: 'keep' });
  const [codeTouched, setCodeTouched] = useState(editing);
  const [errors, setErrors] = useState<{ name?: string; code?: string }>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const busy = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const ids = { title: useId(), name: useId(), code: useId(), codeNote: useId(), client: useId(), clients: useId(), desc: useId(), owner: useId() };

  const dirty = image.kind !== 'keep' || JSON.stringify(draft) !== JSON.stringify(initial);
  const requestClose = () => {
    if (busy.current) return;
    if (dirty) setConfirmClose(true);
    else onClose();
  };
  const dialogRef = useDialog(requestClose, { initialFocus: 'field' });

  useEffect(() => () => { if (image.kind === 'new') URL.revokeObjectURL(image.previewUrl); }, [image]);

  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi(apiClient).list() });
  const dirQ = useQuery({ queryKey: ['directory'], queryFn: () => usersApi(apiClient).directory() });
  const clients = useMemo(() => {
    const names = new Set<string>();
    for (const p of Array.isArray(projectsQ.data) ? projectsQ.data : []) if (p.clientName?.trim()) names.add(p.clientName.trim());
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [projectsQ.data]);
  const ownerOptions = useMemo(() => [
    { value: '', label: 'No owner' },
    ...(Array.isArray(dirQ.data) ? dirQ.data : []).map((u) => {
      const name = `${u.firstName} ${u.lastName}`.trim() || u.username;
      return { value: u.id, label: name, hint: `@${u.username}`, icon: <Avatar name={name} size="sm" src={u.avatarUrl} /> };
    }),
  ], [dirQ.data]);
  const statusOptions = (['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', ...(initial.status === 'ARCHIVED' ? ['ARCHIVED'] : [])] as ProjectStatus[]).map((s) => ({
    value: s,
    label: projectStatusLabel(s),
    icon: <span className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT[s]}`} />,
  }));
  const priorities = priorityOptions();

  // Code: suggested from the name until it is typed in; checked as it changes (new projects only).
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const onName = (name: string) => {
    const suggesting = !codeTouched && !editing;
    set({ name, ...(suggesting ? { code: suggestCode(name) } : {}) });
    // A new suggested code replaces any message about the old one.
    if (errors.name || (suggesting && errors.code)) setErrors((e) => ({ ...e, name: undefined, ...(suggesting ? { code: undefined } : {}) }));
  };
  const onCode = (code: string) => {
    setCodeTouched(true);
    set({ code: code.toUpperCase().replace(/\s+/g, '') });
    setErrors((e) => ({ ...e, code: undefined }));
  };
  const formatProblem = draft.code ? codeProblem(draft.code) : null;
  const checkedCode = useDebounced(draft.code, 350);
  const codeQ = useQuery({
    queryKey: ['project-code-check', checkedCode],
    queryFn: () => projectsApi(apiClient).checkCode(checkedCode),
    enabled: !editing && !!checkedCode && !codeProblem(checkedCode),
    staleTime: 10_000,
  });
  const check = !editing && codeQ.data && codeQ.data.code === draft.code ? codeQ.data : null;
  const codeError = errors.code ?? formatProblem ?? (check && !check.available ? `${draft.code} is already used by another project.` : null);

  const look = { name: draft.name || 'New project', color: draft.color, icon: draft.icon, imageUrl: image.kind === 'new' ? image.previewUrl : image.kind === 'remove' ? null : saved?.imageUrl ?? null };

  async function uploadPicture(id: string): Promise<ApiProject | null> {
    if (image.kind === 'new') {
      setProgress(0);
      try {
        const ext = image.blob.type === 'image/webp' ? 'webp' : 'png';
        return await projectsApi(apiClient).uploadImage(id, image.blob, { filename: `project.${ext}`, onProgress: setProgress });
      } finally {
        setProgress(null);
      }
    }
    if (image.kind === 'remove') return projectsApi(apiClient).removeImage(id);
    return null;
  }

  function finish(result: ApiProject) {
    void qc.invalidateQueries({ queryKey: ['projects'] });
    void qc.invalidateQueries({ queryKey: ['project', result.id] });
    onSaved?.(result);
    onClose();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy.current) return;
    const problems: { name?: string; code?: string } = {};
    if (!draft.name.trim()) problems.name = 'Give the project a name.';
    if (!editing) {
      const p = codeProblem(draft.code);
      if (p) problems.code = p;
      else if (check && !check.available) problems.code = `${draft.code} is already used by another project.`;
    }
    setErrors(problems);
    if (problems.name) return nameRef.current?.focus();
    if (problems.code) return codeRef.current?.focus();

    busy.current = true;
    setSaving(true);
    setBanner(null);
    try {
      if (!saved) {
        let created: ApiProject;
        try {
          created = await projectsApi(apiClient).create({
            code: draft.code,
            name: draft.name.trim(),
            ...(draft.clientName.trim() ? { clientName: draft.clientName.trim() } : {}),
            ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
            status: draft.status,
            priority: draft.priority,
            ownerId: draft.ownerId || null,
            icon: draft.icon,
            color: draft.color,
          });
        } catch (err) {
          if (err instanceof ApiError && err.status === 409) {
            setErrors({ code: err.message || `${draft.code} is already used by another project.` });
            codeRef.current?.focus();
          } else {
            setBanner(`Couldn’t create the project. ${reason(err)}`);
          }
          return;
        }
        try {
          finish((await uploadPicture(created.id)) ?? created);
        } catch (err) {
          // The project exists: keep editing it, with the picture still here to try again.
          setSaved(created);
          setInitial(draftOf(created));
          setDraft(draftOf(created));
          void qc.invalidateQueries({ queryKey: ['projects'] });
          setBanner(`The project was created, but its picture wasn’t saved: ${reason(err)} Try again, or remove the picture and save.`);
        }
        return;
      }
      const patch = changes(initial, draft);
      let result: ApiProject;
      try {
        result = Object.keys(patch).length ? await projectsApi(apiClient).update(saved.id, patch) : saved;
      } catch (err) {
        setBanner(`Couldn’t save the changes. ${reason(err)}`);
        return;
      }
      // The details are saved: a retry only sends the picture.
      const detailsSaved = Object.keys(patch).length > 0;
      setSaved(result);
      setInitial(draft);
      try {
        finish((await uploadPicture(saved.id)) ?? result);
      } catch (err) {
        if (detailsSaved) {
          void qc.invalidateQueries({ queryKey: ['projects'] });
          void qc.invalidateQueries({ queryKey: ['project', saved.id] });
        }
        setBanner(detailsSaved ? `The other changes were saved, but the picture wasn’t: ${reason(err)}` : `Couldn’t save the picture. ${reason(err)}`);
      }
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  return (
    <ModalPortal>
      <div className="above-keyboard fixed inset-0 z-50 flex items-stretch justify-center sm:items-center sm:p-4">
        <div className="absolute inset-0 bg-ink/40 animate-fade-in" onClick={requestClose} aria-hidden="true" />
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={editing ? 'Edit project' : 'New project'}
          className="keyboard-flow-cramped relative flex h-full w-full flex-col overflow-hidden bg-surface shadow-lift animate-scale-in sm:h-auto sm:max-h-[min(calc(var(--visible-height)*0.92),54rem)] sm:max-w-2xl sm:rounded-2xl"
        >
          <div className="flex flex-none items-center gap-3 border-b border-line px-5 py-4">
            <h2 id={ids.title} className="flex-1 font-display text-xl font-bold text-ink">{editing ? 'Edit project' : 'New project'}</h2>
            <button type="button" onClick={requestClose} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-lg text-ink-2 hover:bg-ground hover:text-ink">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>

          <form onSubmit={(e) => void submit(e)} noValidate className="keyboard-flow-body flex min-h-0 flex-1 flex-col">
            <div className="keyboard-flow-body min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
              {banner ? <p role="alert" className="rounded-xl border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-sm text-danger">{banner}</p> : null}

              {/* Identity: the picture beside the name and code. */}
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                <div className="flex items-center gap-3 sm:flex-col sm:items-center">
                  <span role="img" aria-label="Project picture preview" className="inline-flex">
                    <ProjectAvatar project={look} size="2xl" />
                  </span>
                  <button
                    type="button"
                    onClick={() => setAppearanceOpen((o) => !o)}
                    aria-expanded={appearanceOpen}
                    className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:border-brand hover:text-brand"
                  >
                    Change icon or image
                  </button>
                </div>
                <div className="grid min-w-0 flex-1 gap-4 sm:grid-cols-[minmax(0,1fr)_9.5rem]">
                  <div>
                    <Label htmlFor={ids.name} required>Name</Label>
                    <input
                      id={ids.name}
                      ref={nameRef}
                      value={draft.name}
                      onChange={(e) => onName(e.target.value)}
                      dir="auto"
                      maxLength={NAME_MAX}
                      aria-required="true"
                      aria-invalid={errors.name ? true : undefined}
                      aria-describedby={errors.name ? `${ids.name}-err` : undefined}
                      placeholder="e.g. Rig Inspection Portal"
                      className={input(!!errors.name)}
                    />
                    {errors.name ? <p id={`${ids.name}-err`} className="mt-1 text-xs font-medium text-danger">{errors.name}</p> : null}
                  </div>
                  <div>
                    <Label htmlFor={ids.code} required>Code</Label>
                    <input
                      id={ids.code}
                      ref={codeRef}
                      value={draft.code}
                      onChange={(e) => onCode(e.target.value)}
                      readOnly={editing}
                      maxLength={10}
                      autoCapitalize="characters"
                      spellCheck={false}
                      aria-required="true"
                      aria-invalid={codeError ? true : undefined}
                      aria-describedby={ids.codeNote}
                      placeholder="RIP"
                      className={`${input(!!codeError)} font-mono uppercase tracking-wide ${editing ? 'cursor-not-allowed bg-ground text-ink-2' : ''}`}
                    />
                    <div id={ids.codeNote} aria-live="polite" className="mt-1 min-h-[1rem] text-xs">
                      {editing ? (
                        <span className="text-ink-2">Task keys use this code, so it can’t be changed.</span>
                      ) : codeError ? (
                        <span className="font-medium text-danger">
                          {codeError}
                          {check?.suggestion ? (
                            <>
                              {' '}
                              <button type="button" onClick={() => onCode(check.suggestion!)} className="font-semibold text-brand underline-offset-2 hover:underline">
                                Use {check.suggestion}
                              </button>
                            </>
                          ) : null}
                        </span>
                      ) : check?.available ? (
                        <span className="text-success">{draft.code} is free.</span>
                      ) : draft.code ? (
                        <span className="text-ink-2">Task keys look like {draft.code}-12.</span>
                      ) : (
                        <span className="text-ink-2">Suggested from the name — you can change it.</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {appearanceOpen ? (
                <IdentityEditor
                  color={draft.color}
                  icon={draft.icon}
                  hasImage={look.imageUrl !== null}
                  onColor={(color) => set({ color })}
                  onIcon={(icon) => set({ icon })}
                  onImage={(choice) => setImage(choice.kind === 'remove' && image.kind === 'new' && !saved?.imageUrl ? { kind: 'keep' } : choice)}
                />
              ) : null}

              <div>
                <Label htmlFor={ids.client} optional>Client</Label>
                <input
                  id={ids.client}
                  list={ids.clients}
                  value={draft.clientName}
                  onChange={(e) => set({ clientName: e.target.value })}
                  dir="auto"
                  maxLength={NAME_MAX}
                  placeholder={clients.length ? 'Type or pick a client' : 'e.g. Petroleum Development Oman'}
                  className={input(false)}
                />
                <datalist id={ids.clients}>{clients.map((c) => <option key={c} value={c} />)}</datalist>
              </div>

              <div>
                <Label htmlFor={ids.desc} optional>Description</Label>
                <textarea
                  id={ids.desc}
                  value={draft.description}
                  onChange={(e) => set({ description: e.target.value })}
                  dir="auto"
                  rows={4}
                  maxLength={DESCRIPTION_MAX}
                  placeholder="What the project is for, its scope and goals"
                  className={`${input(false)} min-h-[6.5rem] resize-y leading-relaxed`}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <span className="mb-1.5 block text-sm font-semibold text-ink">Status</span>
                  <SearchableSelect ariaLabel="Status" options={statusOptions} value={draft.status} onChange={(v) => set({ status: v as ProjectStatus })} />
                </div>
                <div>
                  <span className="mb-1.5 block text-sm font-semibold text-ink">Priority</span>
                  <SearchableSelect ariaLabel="Priority" options={priorities} value={draft.priority} onChange={(v) => set({ priority: v as Priority })} />
                </div>
              </div>

              <div>
                <span className="mb-1.5 flex items-baseline gap-1.5 text-sm font-semibold text-ink">Owner <span className="text-xs font-normal text-ink-2">(optional)</span></span>
                <SearchableSelect ariaLabel="Owner" placeholder="No owner" options={ownerOptions} value={draft.ownerId} onChange={(v) => set({ ownerId: v })} describedBy={ids.owner} />
                <p id={ids.owner} className="mt-1.5 text-xs text-ink-2">
                  New tasks in this project are assigned to the owner unless you pick someone else — and anyone can reassign a task later.
                </p>
              </div>
            </div>

            <div className="flex flex-none flex-col gap-2 border-t border-line bg-surface px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
              {progress !== null ? (
                <div role="progressbar" aria-label="Uploading the picture" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} className="h-1 overflow-hidden rounded-full bg-line">
                  <div className="h-full bg-brand transition-[width]" style={{ width: `${Math.max(5, Math.round(progress * 100))}%` }} />
                </div>
              ) : null}
              <div className="flex gap-2 sm:justify-end">
                <button type="button" onClick={requestClose} disabled={saving} className="!min-h-[44px] flex-1 rounded-xl border border-line px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-ground disabled:opacity-50 sm:flex-none">
                  Cancel
                </button>
                <Button type="submit" loading={saving} className="!min-h-[44px] flex-[2] sm:flex-none sm:min-w-[10rem]">
                  {saving ? (editing ? 'Saving…' : 'Creating…') : editing ? 'Save changes' : 'Create project'}
                </Button>
              </div>
            </div>
          </form>
        </div>
      </div>
      {confirmClose ? (
        <ConfirmDialog title="Discard your changes?" confirmLabel="Discard" keepLabel="Keep editing" onConfirm={() => { setConfirmClose(false); onClose(); }} onClose={() => setConfirmClose(false)}>
          What you entered for this project hasn’t been saved.
        </ConfirmDialog>
      ) : null}
    </ModalPortal>
  );
}
