import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { inspectionsApi, type InspectionForm } from '../../api/inspections';
import { ApiError } from '../../lib/api-client';
import { INSPECTION_LIMITS as L, type FormStructure, type ItemKind, type SignatureRule } from '../../lib/inspection-rules';
import { useDialog } from '../../hooks/useDialog';
import { ModalPortal } from '../ui/ModalPortal';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { EmptyState } from '../ui/EmptyState';
import { FieldError, FieldLabel, fieldClass } from '../ui/Field';
import { TemplateGlyph } from '../templates/TemplateCard';
import {
  addItem,
  addSection,
  draftFromForm,
  emptyDraft,
  itemCount,
  limitsPreview,
  moveItem,
  moveSection,
  removeItem,
  removeSection,
  updateItem,
  updateSection,
  validateDraft,
  type Draft,
  type DraftItem,
  type DraftSection,
  type Problems,
} from './form-editor';

/**
 * What deleting a form does to its scheduled checks, in words (null when nothing uses it):
 * "2 schedules use this form; they'll stop. 3 checks already created can still be done."
 */
export function formUsageText(u: { schedules: number; openChecks: number }): string | null {
  const parts = [
    u.schedules ? (u.schedules === 1 ? '1 schedule uses this form; it’ll stop.' : `${u.schedules} schedules use this form; they’ll stop.`) : '',
    u.openChecks ? `${u.openChecks} ${u.openChecks === 1 ? 'check' : 'checks'} already created can still be done.` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' ') : null;
}

/** How much a form is used, while its delete is being confirmed. */
function DeleteUsage({ formId }: { formId: string }) {
  const q = useQuery({ queryKey: ['inspection-form-usage', formId], queryFn: () => inspectionsApi(apiClient).formUsage(formId), staleTime: 0 });
  if (q.isLoading) return <p className="mb-2 text-ink-3">Checking where it’s used…</p>;
  const text = q.data ? formUsageText(q.data) : null;
  return text ? <p className="mb-2 font-medium text-ink">{text}</p> : null;
}

/** The list's and every form's query key: a saved or deleted form refreshes it. */
export const INSPECTION_FORMS_KEY = ['inspection-forms'];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};
const reason = (err: unknown, fallback: string) => (err instanceof ApiError && err.message && !/^Request failed/.test(err.message) ? err.message : fallback);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const SIGNATURE_WORDS: Record<SignatureRule, string> = { NONE: 'Not asked for', OPTIONAL: 'Asked for, optional', REQUIRED: 'Required to finish' };

/** "Inspector signs; client’s signature optional; supervisor’s signature required". */
export function signatureSummary(s: Pick<FormStructure, 'clientSignature' | 'supervisorSignature'>): string {
  const part = (who: string, rule: SignatureRule) => (rule === 'OPTIONAL' ? `${who}’s signature optional` : rule === 'REQUIRED' ? `${who}’s signature required` : null);
  return ['Inspector signs', part('client', s.clientSignature), part('supervisor', s.supervisorSignature)].filter(Boolean).join('; ');
}

/** A small square icon button; bigger under a finger. */
function IconButton({ label, onClick, disabled, danger, children }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`grid h-8 w-8 flex-none place-items-center rounded-lg border border-line bg-surface text-ink-2 transition-colors disabled:cursor-not-allowed disabled:opacity-40 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10 ${danger ? 'hover:border-danger/40 hover:bg-danger-soft hover:text-danger' : 'hover:border-brand/30 hover:text-brand'}`}
    >
      {children}
    </button>
  );
}

const svg = (d: string) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
const UP = svg('m18 15-6-6-6 6');
const DOWN = svg('m6 9 6 6 6-6');
const BIN = svg('M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6');

/**
 * Inspection forms: the checklists inspections are carried out from. Everyone sees them; anyone
 * who runs a project (and every administrator) can create one; the person who made a form, and any
 * administrator, can change or delete it (the server decides; `canEdit` says so). Self-contained, so
 * it can sit on a page of its own or in a tab.
 */
export function InspectionFormsManager({ className = '' }: { className?: string }) {
  const qc = useQueryClient();
  const api = inspectionsApi(apiClient);
  const formsQ = useQuery({ queryKey: INSPECTION_FORMS_KEY, queryFn: () => api.listForms() });
  const [editing, setEditing] = useState<{ form: InspectionForm | null } | null>(null);
  const [deleting, setDeleting] = useState<InspectionForm | null>(null);
  const [deleteProblem, setDeleteProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const forms = formsQ.data?.forms ?? [];
  const canCreate = formsQ.data?.canCreate === true;

  const deleteM = useMutation({
    mutationFn: (form: InspectionForm) => api.deleteForm(form.id),
    onMutate: () => setDeleteProblem(null),
    onSuccess: (_r, form) => {
      setDeleting(null);
      setNotice(`Deleted “${form.title}”.`);
      void qc.invalidateQueries({ queryKey: INSPECTION_FORMS_KEY });
      // Its schedules stopped: every project's Inspections tab, and the tasks they are, change.
      void qc.invalidateQueries({ queryKey: ['project-inspections'] });
      void qc.invalidateQueries({ queryKey: ['task'] });
    },
    onError: (err) => setDeleteProblem(reason(err, 'Couldn’t delete the form. Please try again.')),
  });

  const newForm = (
    <Button
      onClick={() => {
        setNotice(null);
        setEditing({ form: null });
      }}
      className="!min-h-[44px]"
    >
      {TemplateGlyph.plus}
      New form
    </Button>
  );

  return (
    <div className={`flex flex-col gap-4 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm leading-relaxed text-ink-2">
          Checklists for inspections: sections of Pass / Fail / N/A items and readings with limits (a reading outside its limits fails), and the signatures each one asks for.
          Editing a form never changes inspections already started from it.
          {!formsQ.isLoading && formsQ.data && !canCreate ? ' Administrators and people who run a project can create forms.' : ''}
        </p>
        {canCreate && forms.length > 0 ? newForm : null}
      </div>

      {notice ? (
        <p role="status" className="rounded-lg bg-success-soft px-3 py-2 text-sm text-success">
          {notice}
        </p>
      ) : null}

      {formsQ.isLoading ? (
        <div className="flex flex-col gap-2" aria-label="Loading forms" role="status">
          <span className="skeleton h-16 rounded-xl" />
          <span className="skeleton h-16 rounded-xl" />
        </div>
      ) : formsQ.isError ? (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          Couldn’t load the forms.{' '}
          <button type="button" className="font-semibold underline" onClick={() => void formsQ.refetch()}>
            Retry
          </button>
        </p>
      ) : forms.length === 0 ? (
        <EmptyState
          title="No inspection forms yet"
          description={canCreate ? 'Make the first checklist: its sections, the items to check and the readings to take.' : 'Administrators and people who run a project can create forms.'}
          action={canCreate ? newForm : undefined}
        />
      ) : (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
          {forms.map((f) => (
            <li key={f.id} aria-label={f.title} className="flex flex-wrap items-start gap-3 px-4 py-3 sm:flex-nowrap">
              {/* On a phone Edit and Delete go under the text rather than squeezing it into a column. */}
              <div className="min-w-0 flex-[1_1_16rem]">
                <p dir="auto" className="break-words font-semibold text-ink">{f.title}</p>
                {f.description ? <p dir="auto" className="mt-0.5 line-clamp-2 text-sm text-ink-2">{f.description}</p> : null}
                <p className="mt-1 text-xs text-ink-2">
                  {plural(f.sectionCount, 'section')} · {plural(f.itemCount, 'item')}
                  {f.createdBy ? <> · Made by <bdi>{f.createdBy.name}</bdi></> : null} · Changed {day(f.updatedAt)}
                </p>
                <p className="text-xs text-ink-3">{signatureSummary(f.structure)}</p>
              </div>
              {f.canEdit ? (
                <div className="flex flex-none items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    className="[@media(pointer:coarse)]:!min-h-11"
                    aria-label={`Edit ${f.title}`}
                    onClick={() => {
                      setNotice(null);
                      setEditing({ form: f });
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="!text-danger hover:!text-danger [@media(pointer:coarse)]:!min-h-11"
                    aria-label={`Delete ${f.title}`}
                    onClick={() => {
                      setNotice(null);
                      setDeleteProblem(null);
                      setDeleting(f);
                    }}
                  >
                    Delete
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {editing ? (
        <FormEditorDialog
          form={editing.form}
          onClose={() => setEditing(null)}
          onSaved={(title) => {
            setEditing(null);
            setNotice(`Saved “${title}”.`);
            void qc.invalidateQueries({ queryKey: INSPECTION_FORMS_KEY });
          }}
        />
      ) : null}
      {deleting ? (
        <ConfirmDialog
          title={`Delete “${deleting.title}”?`}
          confirmLabel="Delete form"
          keepLabel="Keep it"
          busy={deleteM.isPending}
          error={deleteProblem}
          onConfirm={() => deleteM.mutate(deleting)}
          onClose={() => setDeleting(null)}
        >
          <DeleteUsage formId={deleting.id} />
          Nobody can start a new inspection from it. Inspections already made from it are kept, with their answers, signatures and reports.
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

/** Making a new form, or changing one: its title, description, signatures, sections and items. */
function FormEditorDialog({ form, onClose, onSaved }: { form: InspectionForm | null; onClose: () => void; onSaved: (title: string) => void }) {
  const api = inspectionsApi(apiClient);
  const uid = useId();
  const initial = useMemo(() => (form ? draftFromForm(form) : emptyDraft()), [form]);
  const [draft, setDraft] = useState<Draft>(initial);
  const savedSnapshot = useRef(JSON.stringify(initial));
  const [attempted, setAttempted] = useState(false);
  const [serverProblem, setServerProblem] = useState<string | null>(null);
  const [askDiscard, setAskDiscard] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const check = validateDraft(draft);
  const problems: Problems = check.ok ? {} : check.problems;
  // Limits are checked as they are typed (a crossed or unreadable limit is said at once); the rest
  // once Save has been tried, so a new form doesn't open covered in messages.
  const shown = (key: string) => (attempted || /:(min|max)$/.test(key) ? problems[key] : undefined);
  const fieldId = (key: string) => `${uid}-${key.replace(/[^A-Za-z0-9_-]/g, '_')}`;

  const saveM = useMutation({
    mutationFn: async () => {
      if (!check.ok) throw new Error('invalid');
      return form ? api.updateForm(form.id, { ...check.input, expectedVersion: form.version }) : api.createForm(check.input);
    },
    onMutate: () => setServerProblem(null),
    onSuccess: (saved) => onSaved(saved.title),
    onError: (err) => setServerProblem(reason(err, 'Couldn’t save the form. Please try again.')),
  });

  const dirty = () => JSON.stringify(draft) !== savedSnapshot.current;
  const requestClose = () => {
    if (saveM.isPending || askDiscard) return;
    if (dirty()) setAskDiscard(true);
    else onClose();
  };
  const dialogRef = useDialog(requestClose);

  const save = () => {
    if (!check.ok) {
      setAttempted(true);
      // To the first problem on screen.
      const first = Object.keys(check.problems)[0];
      const el = first ? (document.getElementById(fieldId(first)) as HTMLElement | null) : null;
      requestAnimationFrame(() => el?.focus());
      return;
    }
    saveM.mutate();
  };

  const count = itemCount(draft);
  const problemCount = Object.keys(problems).length;
  const titleId = `${uid}-heading`;

  return (
    <ModalPortal>
      <div className="above-keyboard fixed inset-0 z-50 grid place-items-center p-2 sm:p-4">
        <div className="absolute inset-0 bg-ink/40 animate-fade-in" onClick={requestClose} aria-hidden="true" />
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="keyboard-flow-cramped card relative flex max-h-[calc(var(--visible-height,100vh)-1rem)] w-full max-w-3xl animate-scale-in flex-col overflow-hidden sm:max-h-[calc(var(--visible-height,100vh)-2rem)]"
        >
          <div className="flex items-start justify-between gap-3 border-b border-line px-4 pb-3 pt-4 sm:px-5">
            <h2 id={titleId} className="font-display text-lg font-semibold text-ink">
              {form ? 'Edit inspection form' : 'New inspection form'}
            </h2>
            <button type="button" onClick={requestClose} aria-label="Close" className="grid h-9 w-9 flex-none place-items-center rounded-lg text-ink-2 hover:bg-ground hover:text-ink">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div ref={bodyRef} className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-4 sm:px-5">
            {form ? (
              <p className="rounded-lg bg-ground px-3 py-2 text-xs leading-relaxed text-ink-2">
                Inspections already started from this form keep the checklist they started with. Your changes apply to inspections started from now on.
              </p>
            ) : null}

            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor={fieldId('title')} required>
                Title
              </FieldLabel>
              <input
                id={fieldId('title')}
                dir="auto"
                aria-required="true"
                maxLength={L.titleMax}
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                aria-invalid={shown('title') ? true : undefined}
                aria-describedby={shown('title') ? `${fieldId('title')}-error` : undefined}
                className={fieldClass(!!shown('title'), 'w-full')}
              />
              <FieldError id={`${fieldId('title')}-error`}>{shown('title')}</FieldError>
            </div>

            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor={fieldId('description')}>Description (optional)</FieldLabel>
              <textarea
                id={fieldId('description')}
                dir="auto"
                rows={2}
                maxLength={L.descriptionMax}
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                aria-invalid={shown('description') ? true : undefined}
                className={fieldClass(!!shown('description'), 'w-full resize-y')}
              />
              <FieldError>{shown('description')}</FieldError>
            </div>

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium text-ink">Signatures</legend>
              <p id={`${uid}-sig-hint`} className="text-xs text-ink-2">
                The inspector always signs. A client’s or a supervisor’s signature can be asked for too, drawn on the same screen.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {(
                  [
                    ['clientSignature', 'Client’s signature'],
                    ['supervisorSignature', 'Supervisor’s signature'],
                  ] as const
                ).map(([field, label]) => (
                  <div key={field} className="flex flex-col gap-1">
                    <FieldLabel htmlFor={fieldId(field)}>{label}</FieldLabel>
                    <select
                      id={fieldId(field)}
                      aria-describedby={`${uid}-sig-hint`}
                      value={draft[field]}
                      onChange={(e) => setDraft({ ...draft, [field]: e.target.value as SignatureRule })}
                      className={fieldClass(false, 'w-full')}
                    >
                      {(['NONE', 'OPTIONAL', 'REQUIRED'] as const).map((rule) => (
                        <option key={rule} value={rule}>
                          {SIGNATURE_WORDS[rule]}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </fieldset>

            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold text-ink">Checklist</h3>
                <p className="text-xs text-ink-2">
                  {plural(draft.sections.length, 'section')} · {plural(count, 'item')} (at most {L.itemsMax})
                </p>
              </div>
              {draft.sections.map((s, si) => (
                <SectionEditor
                  key={s.key}
                  section={s}
                  index={si}
                  total={draft.sections.length}
                  full={count >= L.itemsMax}
                  shown={shown}
                  fieldId={fieldId}
                  onChange={setDraft}
                  draft={draft}
                />
              ))}
              <div>
                <Button variant="secondary" size="sm" onClick={() => setDraft(addSection(draft))} disabled={draft.sections.length >= L.sectionsMax || count >= L.itemsMax}>
                  Add a section
                </Button>
                {draft.sections.length >= L.sectionsMax ? <p className="mt-1 text-xs text-ink-2">A form can have at most {L.sectionsMax} sections.</p> : null}
              </div>
              <FieldError>{shown('form')}</FieldError>
            </div>
          </div>

          <div className="flex flex-col gap-2 border-t border-line px-4 py-3 sm:px-5">
            {attempted && problemCount > 0 ? (
              <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
                Fix {plural(problemCount, 'problem')} before saving: they are marked above.
              </p>
            ) : null}
            {serverProblem ? (
              <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
                {serverProblem}
              </p>
            ) : null}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="secondary" onClick={requestClose} disabled={saveM.isPending}>
                Cancel
              </Button>
              <Button onClick={save} loading={saveM.isPending}>
                Save form
              </Button>
            </div>
          </div>
        </div>
      </div>
      {askDiscard ? (
        <ConfirmDialog
          title="Discard this form?"
          confirmLabel="Discard"
          keepLabel="Keep editing"
          onConfirm={() => {
            setAskDiscard(false);
            onClose();
          }}
          onClose={() => setAskDiscard(false)}
        >
          Your changes haven’t been saved.
        </ConfirmDialog>
      ) : null}
    </ModalPortal>
  );
}

interface PartProps {
  draft: Draft;
  onChange: (d: Draft) => void;
  shown: (key: string) => string | undefined;
  fieldId: (key: string) => string;
}

function SectionEditor({ section: s, index, total, full, draft, onChange, shown, fieldId }: PartProps & { section: DraftSection; index: number; total: number; full: boolean }) {
  const name = s.title.trim() || `Section ${index + 1}`;
  const titleKey = `section:${s.key}:title`;
  const add = (kind: ItemKind) => onChange(addItem(draft, s.key, kind));
  return (
    <fieldset className="flex flex-col gap-3 rounded-2xl border border-line bg-ground/40 p-3 sm:p-4">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-2">Section {index + 1}</legend>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-[12rem] flex-1 flex-col gap-1">
          <FieldLabel htmlFor={fieldId(titleKey)} required>
            Section name
          </FieldLabel>
          <input
            id={fieldId(titleKey)}
            dir="auto"
            aria-required="true"
            maxLength={L.sectionTitleMax}
            value={s.title}
            onChange={(e) => onChange(updateSection(draft, s.key, { title: e.target.value }))}
            aria-invalid={shown(titleKey) ? true : undefined}
            aria-describedby={shown(titleKey) ? `${fieldId(titleKey)}-error` : undefined}
            className={fieldClass(!!shown(titleKey), 'w-full')}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <IconButton label={`Move section up: ${name}`} onClick={() => onChange(moveSection(draft, s.key, -1))} disabled={index === 0}>
            {UP}
          </IconButton>
          <IconButton label={`Move section down: ${name}`} onClick={() => onChange(moveSection(draft, s.key, 1))} disabled={index === total - 1}>
            {DOWN}
          </IconButton>
          <IconButton label={`Remove section: ${name}`} onClick={() => onChange(removeSection(draft, s.key))} disabled={total === 1} danger>
            {BIN}
          </IconButton>
        </div>
      </div>
      <FieldError id={`${fieldId(titleKey)}-error`}>{shown(titleKey)}</FieldError>

      <div className="flex flex-col gap-2">
        {s.items.map((it, ii) => (
          <ItemEditor key={it.key} item={it} sectionKey={s.key} index={ii} total={s.items.length} draft={draft} onChange={onChange} shown={shown} fieldId={fieldId} />
        ))}
      </div>
      <FieldError id={fieldId(`section:${s.key}:items`)}>{shown(`section:${s.key}:items`)}</FieldError>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => add('CHECK')} disabled={full}>
          Add a Pass / Fail / N/A item
        </Button>
        <Button variant="secondary" size="sm" onClick={() => add('READING')} disabled={full}>
          Add a reading
        </Button>
      </div>
    </fieldset>
  );
}

function ItemEditor({ item: it, sectionKey, index, total, draft, onChange, shown, fieldId }: PartProps & { item: DraftItem; sectionKey: string; index: number; total: number }) {
  const key = (field: string) => `item:${it.key}:${field}`;
  const name = it.label.trim() || `Item ${index + 1}`;
  const set = (patch: Partial<DraftItem>) => onChange(updateItem(draft, it.key, patch));
  const preview = it.kind === 'READING' ? limitsPreview(it) : null;
  const text = (field: 'label' | 'help' | 'unit' | 'min' | 'max', label: string, opts: { required?: boolean; max?: number; className?: string; hint?: string } = {}) => {
    const k = key(field);
    const error = shown(k);
    const describedBy = [error ? `${fieldId(k)}-error` : null, opts.hint ? `${fieldId(k)}-hint` : null].filter(Boolean).join(' ') || undefined;
    return (
      <div className={`flex min-w-0 flex-col gap-1 ${opts.className ?? ''}`}>
        <FieldLabel htmlFor={fieldId(k)} required={opts.required}>
          {label}
        </FieldLabel>
        <input
          id={fieldId(k)}
          dir={field === 'min' || field === 'max' ? 'ltr' : 'auto'}
          autoComplete="off"
          aria-required={opts.required ? 'true' : undefined}
          maxLength={opts.max}
          value={it[field]}
          onChange={(e) => set({ [field]: e.target.value })}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={fieldClass(!!error, 'w-full')}
        />
        {opts.hint ? (
          <p id={`${fieldId(k)}-hint`} className="text-xs text-ink-3">
            {opts.hint}
          </p>
        ) : null}
        <FieldError id={`${fieldId(k)}-error`}>{error}</FieldError>
      </div>
    );
  };
  return (
    <fieldset className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-3">
      <legend className="px-1 text-xs font-semibold text-ink-2">Item {index + 1}</legend>
      <div className="grid gap-2 sm:grid-cols-[11rem_minmax(0,1fr)]">
        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor={fieldId(key('kind'))}>Type</FieldLabel>
          <select id={fieldId(key('kind'))} value={it.kind} onChange={(e) => set({ kind: e.target.value as ItemKind })} className={fieldClass(false, 'w-full')}>
            <option value="CHECK">Pass / Fail / N/A</option>
            <option value="READING">Reading (a number)</option>
          </select>
        </div>
        {text('label', 'What to check', { required: true, max: L.labelMax })}
      </div>
      {it.kind === 'READING' ? (
        <>
          <div className="grid gap-2 sm:grid-cols-3">
            {text('unit', 'Unit (optional)', { max: L.unitMax, hint: 'psi, bar, °C, mm…' })}
            {text('min', 'Lowest allowed', { hint: 'Empty: no lowest' })}
            {text('max', 'Highest allowed', { hint: 'Empty: no highest' })}
          </div>
          {preview ? <p className="text-xs font-medium text-ink-2">{preview}</p> : null}
        </>
      ) : null}
      {text('help', 'Hint for the inspector (optional)', { max: L.helpMax })}
      <div className="flex items-center justify-end gap-1.5">
        <IconButton label={`Move item up: ${name}`} onClick={() => onChange(moveItem(draft, sectionKey, it.key, -1))} disabled={index === 0}>
          {UP}
        </IconButton>
        <IconButton label={`Move item down: ${name}`} onClick={() => onChange(moveItem(draft, sectionKey, it.key, 1))} disabled={index === total - 1}>
          {DOWN}
        </IconButton>
        <IconButton label={`Remove item: ${name}`} onClick={() => onChange(removeItem(draft, it.key))} danger>
          {BIN}
        </IconButton>
      </div>
    </fieldset>
  );
}
