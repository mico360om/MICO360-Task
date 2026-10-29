import { useId, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import type { Priority } from '../../api/tasks';
import { TASK_TEMPLATES_KEY, templatesApi, type TaskTemplate } from '../../api/templates';
import { ApiError } from '../../lib/api-client';
import { useDialog } from '../../hooks/useDialog';
import { ModalPortal } from '../ui/ModalPortal';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { SearchableSelect } from '../ui/SearchableSelect';
import { ChecklistField, checklistRows, checklistTexts } from '../task-form/ChecklistField';
import { stayOnEnter } from '../../lib/enter-key';
import { priorityOptions } from '../priority-option';
import { TemplateGlyph } from './TemplateCard';

const TITLE_MAX = 191;
const DESCRIPTION_MAX = 20_000;

const reason = (err: unknown) => (err instanceof ApiError && err.message && !/^Request failed/.test(err.message) ? err.message : err instanceof TypeError ? 'The server couldn’t be reached.' : 'Please try again.');
const field = 'w-full rounded-xl border bg-surface px-3.5 py-2.5 text-sm text-ink outline-none transition-colors placeholder:text-ink-3 focus:ring-2';
const ok = 'border-line focus:border-brand focus:ring-brand/20';
const bad = 'border-danger focus:border-danger focus:ring-danger/20';

/** Create or edit a task template: what it is called, and the title, description, priority and checklist it fills in. */
export function TaskTemplateEditor({ template, onClose }: { template: TaskTemplate | null; onClose: () => void }) {
  const qc = useQueryClient();
  const editing = !!template;
  const [start] = useState(() => ({
    name: template?.name ?? '',
    title: template?.title ?? '',
    description: template?.description ?? '',
    priority: (template?.priority ?? 'NORMAL') as Priority,
    checklist: checklistRows(template?.checklist ?? []),
    // Checklist text typed and not added yet: saved with the rest, and a change.
    checklistPending: '',
  }));
  const [draft, setDraft] = useState(start);
  const [errors, setErrors] = useState<{ name?: string; title?: string }>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const busy = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const ids = { heading: useId(), name: useId(), title: useId(), desc: useId(), nameNote: useId() };
  const set = (patch: Partial<typeof draft>) => setDraft((d) => ({ ...d, ...patch }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(start);
  const requestClose = () => {
    if (busy.current) return;
    if (dirty) setConfirmClose(true);
    else onClose();
  };
  const dialogRef = useDialog(requestClose);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy.current) return;
    const problems = { name: draft.name.trim() ? undefined : 'Give the template a name.', title: draft.title.trim() ? undefined : 'Give the task a title.' };
    setErrors(problems);
    if (problems.name) return nameRef.current?.focus();
    if (problems.title) return titleRef.current?.focus();
    busy.current = true;
    setSaving(true);
    setBanner(null);
    try {
      const input = { name: draft.name.trim(), title: draft.title.trim(), description: draft.description.trim() || null, priority: draft.priority, checklist: checklistTexts(draft.checklist, draft.checklistPending) };
      if (editing) await templatesApi(apiClient).updateTaskTemplate(template!.id, input);
      else await templatesApi(apiClient).createTaskTemplate(input);
      void qc.invalidateQueries({ queryKey: TASK_TEMPLATES_KEY });
      onClose();
    } catch (err) {
      setBanner(`Couldn’t save the template. ${reason(err)}`);
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
          aria-labelledby={ids.heading}
          className="keyboard-flow-cramped relative flex h-full w-full flex-col overflow-hidden bg-surface shadow-lift animate-scale-in sm:h-auto sm:max-h-[calc(var(--visible-height)*0.9)] sm:max-w-xl sm:rounded-2xl"
        >
          <div className="flex flex-none items-center gap-3 border-b border-line px-5 py-4">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand/10 text-brand">{TemplateGlyph.task}</span>
            <h2 id={ids.heading} className="flex-1 font-display text-xl font-bold text-ink">{editing ? 'Edit task template' : 'New task template'}</h2>
            <button type="button" onClick={requestClose} aria-label="Close" title="Close (Esc)" className="grid h-10 w-10 place-items-center rounded-lg text-ink-2 hover:bg-ground hover:text-ink [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>
          <form onSubmit={(e) => void submit(e)} noValidate className="keyboard-flow-body flex min-h-0 flex-1 flex-col">
            <div className="keyboard-flow-body min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
              {banner ? <p role="alert" className="rounded-xl border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-sm text-danger">{banner}</p> : null}
              <div>
                <label htmlFor={ids.name} className="mb-1.5 flex items-baseline gap-1.5 text-sm font-semibold text-ink">Template name<span aria-hidden="true" className="text-danger">*</span></label>
                <input id={ids.name} ref={nameRef} value={draft.name} onChange={(e) => { set({ name: e.target.value }); setErrors((x) => ({ ...x, name: undefined })); }} onKeyDown={stayOnEnter} dir="auto" maxLength={TITLE_MAX} aria-required="true" aria-invalid={errors.name ? true : undefined} aria-describedby={errors.name ? `${ids.name}-err` : ids.nameNote} placeholder="e.g. Weekly site check" className={`${field} ${errors.name ? bad : ok}`} />
                {errors.name ? <p id={`${ids.name}-err`} className="mt-1 text-xs font-medium text-danger">{errors.name}</p> : <p id={ids.nameNote} className="mt-1 text-xs text-ink-2">How it is listed in the New task form.</p>}
              </div>
              <div>
                <label htmlFor={ids.title} className="mb-1.5 flex items-baseline gap-1.5 text-sm font-semibold text-ink">Task title<span aria-hidden="true" className="text-danger">*</span></label>
                <input id={ids.title} ref={titleRef} value={draft.title} onChange={(e) => { set({ title: e.target.value }); setErrors((x) => ({ ...x, title: undefined })); }} onKeyDown={stayOnEnter} dir="auto" maxLength={TITLE_MAX} aria-required="true" aria-invalid={errors.title ? true : undefined} aria-describedby={errors.title ? `${ids.title}-err` : undefined} className={`${field} ${errors.title ? bad : ok}`} />
                {errors.title ? <p id={`${ids.title}-err`} className="mt-1 text-xs font-medium text-danger">{errors.title}</p> : null}
              </div>
              <div>
                <label htmlFor={ids.desc} className="mb-1.5 flex items-baseline gap-1.5 text-sm font-semibold text-ink">Description <span className="text-xs font-normal text-ink-2">(optional)</span></label>
                <textarea id={ids.desc} value={draft.description} onChange={(e) => set({ description: e.target.value })} dir="auto" rows={4} maxLength={DESCRIPTION_MAX} className={`${field} ${ok} resize-y`} />
              </div>
              <div>
                <span className="mb-1.5 block text-sm font-semibold text-ink">Priority</span>
                <SearchableSelect size="lg" ariaLabel="Priority" options={priorityOptions()} value={draft.priority} onChange={(v) => set({ priority: v as Priority })} />
              </div>
              <div>
                <span className="mb-1.5 block text-sm font-semibold text-ink">Checklist <span className="text-xs font-normal text-ink-2">(optional)</span></span>
                <ChecklistField rows={draft.checklist} onChange={(checklist) => set({ checklist })} pending={draft.checklistPending} onPendingChange={(checklistPending) => set({ checklistPending })} />
              </div>
            </div>
            <div className="flex flex-none items-center gap-2 border-t border-line bg-surface px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:justify-end">
              <button type="button" onClick={requestClose} disabled={saving} className="!min-h-[44px] flex-1 rounded-xl border border-line px-4 text-sm font-semibold text-ink transition-colors hover:bg-ground disabled:opacity-50 sm:flex-none">Cancel</button>
              <Button type="submit" shortcut={editing ? 'save' : 'submit'} showShortcut loading={saving} className="!min-h-[44px] flex-[2] sm:flex-none sm:min-w-[10rem]">
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
