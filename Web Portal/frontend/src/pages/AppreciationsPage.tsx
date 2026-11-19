import { useId, useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { apiClient } from '../api/client';
import {
  appreciationsApi,
  type ApiAppreciationTemplate,
  type ApiManagedAppreciation,
  type AppreciationContent,
  type AppreciationFilters,
} from '../api/appreciations';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { EmptyState } from '../components/ui/EmptyState';
import { LoadError } from '../components/ui/LoadError';
import { FieldLabel, fieldClass } from '../components/ui/Field';
import { Toggle } from '../components/ui/Toggle';
import { AppreciationPreview, ContentFields, FormDialog, LIMITS } from '../components/appreciation/AppreciationFields';
import { AppreciationIconSvg } from '../components/appreciation/AppreciationArt';
import { SendTab } from '../components/appreciation/SendAppreciation';
import { useMyAppreciations } from '../components/appreciation/useMyAppreciations';
import { ANIMATION_LABEL, APPRECIATION_STATUSES, dayWords, STATUS_TONE, STATUS_WORDS, themeStyle, type AppreciationStatus } from '../lib/appreciation';
import { ApiError } from '../lib/api-client';
import { downloadBlob } from '../lib/download';
import { TOUCH_SQUARE, TOUCH_TALL } from '../lib/touch';
import { AcceptNoteQuote, acceptedWords } from './MyAppreciationsPage';
import { useCompanyTimeZone } from '../lib/company-clock';

const api = appreciationsApi(apiClient);
const KEYS = {
  templates: (archived: boolean) => ['appreciations', 'templates', archived] as const,
  people: (search: string, companyId: string) => ['appreciations', 'people', search, companyId] as const,
  companies: ['appreciations', 'companies'] as const,
  list: (f: AppreciationFilters) => ['appreciations', 'list', f] as const,
};
type Tab = 'send' | 'history' | 'templates';
const TABS: { key: Tab; label: string }[] = [
  { key: 'send', label: 'Send' },
  { key: 'history', label: 'Scheduled & history' },
  { key: 'templates', label: 'Templates' },
];
const problemOf = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Something went wrong. Please try again.');
const BLANK: AppreciationContent = { title: '', message: '', theme: 'ruby', icon: 'star', animation: 'confetti' };
const contentOf = (t: AppreciationContent): AppreciationContent => ({ title: t.title, message: t.message, theme: t.theme, icon: t.icon, animation: t.animation });

/**
 * Employee Appreciation (1.24.0): the Appreciations page (Admin) — administrators and Appreciation managers. Send
 * (1.24.2: three steps + the popup's live preview, components/appreciation/SendAppreciation), Scheduled & history (filters, Edit / Cancel before the day,
 * Excel) and Templates (built-ins read-only — "Save as a copy" — and the company's own).
 */
export function AppreciationsPage() {
  const mine = useMyAppreciations();
  const [params, setParams] = useSearchParams();
  const tab: Tab = (TABS.find((t) => t.key === params.get('tab'))?.key ?? 'send') as Tab;
  const tabsId = useId();
  if (mine.query.isPending) return <div role="status" aria-label="Loading" className="skeleton h-40 rounded-2xl" />;
  if (mine.query.isError) return <LoadError what="appreciations" onRetry={() => void mine.query.refetch()} />;
  if (!mine.data?.canManage) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader eyebrow="Admin" title="Appreciations" />
        <EmptyState titleAs="h2" title="Not available" description="Only administrators and Appreciation managers can send appreciations." />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="Admin" title="Appreciations" subtitle="Thank your people on a day of your choice." />
      <div role="tablist" aria-label="Appreciations" className="flex flex-wrap gap-1 rounded-xl border border-line bg-surface p-1 self-start">
        {TABS.map((t) => (
          <button
            key={t.key}
            id={`${tabsId}-${t.key}`}
            role="tab"
            type="button"
            aria-selected={tab === t.key}
            aria-controls={`${tabsId}-panel`}
            onClick={() => setParams((p) => {
              const n = new URLSearchParams(p);
              n.set('tab', t.key);
              return n;
            }, { replace: true })}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${TOUCH_SQUARE} ${tab === t.key ? 'bg-brand text-white shadow-brand' : 'text-ink-2 hover:bg-ground hover:text-ink'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div id={`${tabsId}-panel`} role="tabpanel" aria-labelledby={`${tabsId}-${tab}`}>
        {tab === 'send' ? <SendTab today={mine.data.today} onSent={() => setParams({ tab: 'history' }, { replace: true })} /> : tab === 'history' ? <HistoryTab today={mine.data.today} /> : <TemplatesTab today={mine.data.today} />}
      </div>
    </div>
  );
}

// ── Scheduled & history ──────────────────────────────────────────────────────
function HistoryTab({ today }: { today: string }) {
  const qc = useQueryClient();
  const id = useId();
  const timeZone = useCompanyTimeZone();
  // 1.24.1: the sender's bell notice opens one record (?row=<id>); "Show all" goes back to the whole list.
  const [params, setParams] = useSearchParams();
  // Read from the address on every render, so a notice opened while this tab is already showing still applies.
  const [base, setF] = useState<AppreciationFilters>({ page: 1 });
  const rowId = params.get('row');
  const f: AppreciationFilters = rowId ? { ...base, id: rowId, page: 1 } : base;
  const showAll = () => {
    setParams((p) => {
      const n = new URLSearchParams(p);
      n.delete('row');
      return n;
    }, { replace: true });
  };
  const list = useQuery({ queryKey: KEYS.list(f), queryFn: () => api.list(f), placeholderData: keepPreviousData });
  const people = useQuery({ queryKey: KEYS.people('', ''), queryFn: () => api.people('', '') });
  const templates = useQuery({ queryKey: KEYS.templates(true), queryFn: () => api.templates(true) });
  const [editing, setEditing] = useState<ApiManagedAppreciation | null>(null);
  const [cancelling, setCancelling] = useState<ApiManagedAppreciation | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const set = (k: keyof AppreciationFilters, v: string) => {
    setF((o) => ({ ...o, [k]: v || undefined, page: 1 }));
    if (rowId) showAll(); // filtering means the whole list again
  };
  const refresh = () => void qc.invalidateQueries({ queryKey: ['appreciations'] });
  const cancel = useMutation({
    mutationFn: (rowId: string) => api.cancel(rowId),
    onSuccess: () => {
      setCancelling(null);
      refresh();
    },
    onError: (e) => setProblem(problemOf(e)),
  });
  const data = list.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <div className="flex flex-col gap-4">
      <div className="card card-pad grid gap-3 sm:grid-cols-2 lg:grid-cols-6 lg:items-end">
        <div className="flex flex-col gap-1 lg:col-span-2">
          <FieldLabel htmlFor={`${id}-person`}>Person</FieldLabel>
          <select id={`${id}-person`} className={fieldClass(false)} value={f.personId ?? ''} onChange={(e) => set('personId', e.target.value)}>
            <option value="">Everyone</option>
            {(people.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor={`${id}-status`}>Status</FieldLabel>
          <select id={`${id}-status`} className={fieldClass(false)} value={f.status ?? ''} onChange={(e) => set('status', e.target.value)}>
            <option value="">Any</option>
            {APPRECIATION_STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_WORDS[s]}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor={`${id}-tpl`}>Template</FieldLabel>
          <select id={`${id}-tpl`} className={fieldClass(false)} value={f.templateId ?? ''} onChange={(e) => set('templateId', e.target.value)}>
            <option value="">Any</option>
            {(templates.data ?? []).map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor={`${id}-from`}>From</FieldLabel>
          <input id={`${id}-from`} type="date" className={fieldClass(false)} value={f.from ?? ''} onChange={(e) => set('from', e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor={`${id}-to`}>To</FieldLabel>
          <input id={`${id}-to`} type="date" className={fieldClass(false)} value={f.to ?? ''} onChange={(e) => set('to', e.target.value)} />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-2" aria-live="polite">{data ? `${data.total} ${data.total === 1 ? 'appreciation' : 'appreciations'}` : ''}</p>
        <Button
          variant="secondary"
          loading={exporting}
          className={TOUCH_TALL}
          onClick={async () => {
            setExporting(true);
            setProblem(null);
            try {
              const blob = await api.exportFile(f);
              downloadBlob(blob instanceof File ? blob.name : `Appreciations ${dayWords(today)}.xlsx`, blob);
            } catch (e) {
              setProblem(problemOf(e));
            } finally {
              setExporting(false);
            }
          }}
        >
          Export to Excel
        </Button>
      </div>
      {problem ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{problem}</p> : null}
      {f.id ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink-2" data-one-record>
          Showing one appreciation.
          <Button variant="secondary" size="sm" className={TOUCH_TALL} onClick={showAll}>Show all</Button>
        </div>
      ) : null}
      {list.isError ? (
        <LoadError what="the history" onRetry={() => void list.refetch()} />
      ) : !data ? (
        <div role="status" aria-label="Loading the history" className="skeleton h-40 rounded-2xl" />
      ) : data.rows.length === 0 ? (
        <EmptyState titleAs="h2" title="Nothing here yet" description="Appreciations you send appear here, with their status." />
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Appreciations">
          {data.rows.map((r) => (
            <li key={r.id} className="card flex flex-wrap items-center gap-3 p-3" data-row={r.id} data-status={r.status}>
              <span className="ap-band grid h-10 w-10 flex-none place-items-center rounded-xl" style={themeStyle(r.theme)}>
                <AppreciationIconSvg icon={r.icon} size={20} />
              </span>
              <div className="min-w-0 flex-1 basis-56">
                <p className="flex flex-wrap items-center gap-x-2 text-sm">
                  <bdi className="font-semibold text-ink">{r.recipient.name}</bdi>
                  <span dir="auto" className="text-ink-2">{r.title}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[r.status as AppreciationStatus]}`}>{STATUS_WORDS[r.status as AppreciationStatus]}</span>
                </p>
                <p className="mt-0.5 text-xs text-ink-2">
                  {dayWords(r.day)} · <bdi>{r.company.name}</bdi> · by <bdi>{r.sender.name}</bdi>
                  {r.acceptedAt ? <> · accepted {acceptedWords(r.acceptedAt, timeZone)}</> : null}
                </p>
                {r.acceptNote ? <AcceptNoteQuote label={`Note from ${r.recipient.name}`} note={r.acceptNote} /> : null}
              </div>
              {r.status === 'SCHEDULED' ? (
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" className={TOUCH_TALL} onClick={() => setEditing(r)} aria-label={`Edit the appreciation for ${r.recipient.name}`}>Edit</Button>
                  <Button variant="ghost" size="sm" className={TOUCH_TALL} onClick={() => { setProblem(null); setCancelling(r); }} aria-label={`Cancel the appreciation for ${r.recipient.name}`}>Cancel</Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {data && pages > 1 ? (
        <nav aria-label="Pages" className="flex items-center justify-end gap-2">
          <Button variant="secondary" size="sm" className={TOUCH_TALL} disabled={(f.page ?? 1) <= 1} onClick={() => setF((o) => ({ ...o, page: (o.page ?? 1) - 1 }))}>Previous</Button>
          <span className="text-sm text-ink-2">Page {f.page ?? 1} of {pages}</span>
          <Button variant="secondary" size="sm" className={TOUCH_TALL} disabled={(f.page ?? 1) >= pages} onClick={() => setF((o) => ({ ...o, page: (o.page ?? 1) + 1 }))}>Next</Button>
        </nav>
      ) : null}
      {editing ? <EditDialog row={editing} today={today} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} /> : null}
      {cancelling ? (
        <ConfirmDialog
          title="Cancel this appreciation?"
          confirmLabel="Cancel appreciation"
          keepLabel="Keep it"
          busy={cancel.isPending}
          error={problem}
          onConfirm={() => cancel.mutate(cancelling.id)}
          onClose={() => setCancelling(null)}
        >
          <bdi>{cancelling.recipient.name}</bdi> won’t see “{cancelling.title}” on {dayWords(cancelling.day)}.
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

function EditDialog({ row, today, onClose, onSaved }: { row: ApiManagedAppreciation; today: string; onClose: () => void; onSaved: () => void }) {
  const id = useId();
  const [content, setContent] = useState<AppreciationContent>({ title: row.title, message: row.rawMessage, theme: row.theme, icon: row.icon, animation: row.animation });
  const [day, setDay] = useState(row.day);
  const save = useMutation({ mutationFn: () => api.update(row.id, { ...content, day }), onSuccess: onSaved });
  return (
    <FormDialog
      title={`Edit the appreciation for ${row.recipient.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} className={TOUCH_TALL}>Close</Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!content.title.trim() || !content.message.trim() || day < today} className={TOUCH_TALL}>Save</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {save.isError ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{problemOf(save.error)}</p> : null}
        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor={`${id}-day`} required>Day</FieldLabel>
          <input id={`${id}-day`} type="date" min={today} className={fieldClass(day < today)} value={day} onChange={(e) => setDay(e.target.value)} />
        </div>
        <ContentFields value={content} onChange={setContent} />
        <AppreciationPreview value={content} name={row.recipient.name} company={row.company} day={day} sender={row.sender.name} />
      </div>
    </FormDialog>
  );
}

// ── Templates ────────────────────────────────────────────────────────────────
function TemplatesTab({ today }: { today: string }) {
  const qc = useQueryClient();
  const [archived, setArchived] = useState(false);
  const templates = useQuery({ queryKey: KEYS.templates(archived), queryFn: () => api.templates(archived) });
  const [editing, setEditing] = useState<{ template: ApiAppreciationTemplate | null } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['appreciations'] });
  const act = useMutation({
    mutationFn: (a: { kind: 'copy' | 'archive' | 'unarchive'; id: string }) => (a.kind === 'copy' ? api.copyTemplate(a.id) : api.archiveTemplate(a.id, a.kind === 'archive')),
    onSuccess: () => {
      setProblem(null);
      refresh();
    },
    onError: (e) => setProblem(problemOf(e)),
  });
  const rows = useMemo(() => templates.data ?? [], [templates.data]);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-ink">
          <Toggle on={archived} onChange={() => setArchived((v) => !v)} label="Show archived templates" />
          <span>Show archived</span>
        </div>
        <Button onClick={() => setEditing({ template: null })} className={TOUCH_TALL}>New template</Button>
      </div>
      {problem ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{problem}</p> : null}
      {templates.isError ? (
        <LoadError what="the templates" onRetry={() => void templates.refetch()} />
      ) : templates.isPending ? (
        <div role="status" aria-label="Loading the templates" className="skeleton h-40 rounded-2xl" />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Templates">
          {rows.map((t) => (
            <li key={t.id} className="card flex flex-col overflow-hidden" data-template={t.id}>
              <div className="ap-band flex items-center gap-3 px-4 py-3" style={themeStyle(t.theme)}>
                <AppreciationIconSvg icon={t.icon} size={22} />
                <h3 dir="auto" className="min-w-0 flex-1 truncate font-display font-semibold">{t.name}</h3>
                {t.builtIn ? <span className="ap-chip rounded-full px-2 py-0.5 text-[11px] font-semibold">Built-in</span> : null}
                {t.archived ? <span className="ap-chip rounded-full px-2 py-0.5 text-[11px] font-semibold">Archived</span> : null}
              </div>
              <div className="flex flex-1 flex-col gap-2 p-4">
                <p dir="auto" className="text-sm font-medium text-ink">{t.title}</p>
                <p dir="auto" className="line-clamp-3 text-sm text-ink-2">{t.message}</p>
                <p className="text-xs text-ink-2">Animation: {ANIMATION_LABEL[t.animation]}</p>
                <div className="mt-auto flex flex-wrap gap-2 pt-2">
                  <Button variant="secondary" size="sm" className={TOUCH_TALL} onClick={() => setEditing({ template: t })} aria-label={`${t.builtIn ? 'Open' : 'Edit'} ${t.name}`}>
                    {t.builtIn ? 'Open' : 'Edit'}
                  </Button>
                  <Button variant="ghost" size="sm" className={TOUCH_TALL} onClick={() => act.mutate({ kind: 'copy', id: t.id })} aria-label={`Duplicate ${t.name}`}>Duplicate</Button>
                  {!t.builtIn ? (
                    <Button variant="ghost" size="sm" className={TOUCH_TALL} onClick={() => act.mutate({ kind: t.archived ? 'unarchive' : 'archive', id: t.id })} aria-label={`${t.archived ? 'Restore' : 'Archive'} ${t.name}`}>
                      {t.archived ? 'Restore' : 'Archive'}
                    </Button>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing ? <TemplateDialog today={today} template={editing.template} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} /> : null}
    </div>
  );
}

function TemplateDialog({ template, today, onClose, onSaved }: { template: ApiAppreciationTemplate | null; today: string; onClose: () => void; onSaved: () => void }) {
  const id = useId();
  const builtIn = !!template?.builtIn;
  const [name, setName] = useState(template ? (builtIn ? `${template.name} (copy)` : template.name) : '');
  const [content, setContent] = useState<AppreciationContent>(template ? contentOf(template) : BLANK);
  const save = useMutation({
    // A built-in is never changed: saving makes a copy (the owner's rule).
    mutationFn: () => (template && !builtIn ? api.updateTemplate(template.id, { name, ...content }) : api.createTemplate({ name, ...content })),
    onSuccess: onSaved,
  });
  const valid = name.trim() && content.title.trim() && content.message.trim();
  return (
    <FormDialog
      title={template ? (builtIn ? `${template.name} (built-in)` : `Edit ${template.name}`) : 'New template'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} className={TOUCH_TALL}>Close</Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!valid} className={TOUCH_TALL}>{builtIn ? 'Save as a copy' : 'Save'}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {builtIn ? <p className="rounded-lg bg-info-soft px-3 py-2 text-sm text-info">Built-in templates can’t be changed. Your changes are saved as a new template.</p> : null}
        {save.isError ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{save.error instanceof ApiError ? save.error.message : problemOf(save.error)}</p> : null}
        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor={`${id}-name`} required>Template name</FieldLabel>
          <input id={`${id}-name`} className={fieldClass(false)} maxLength={LIMITS.name} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <ContentFields value={content} onChange={setContent} />
        <AppreciationPreview value={content} name="Sara Khan" company={{ name: 'Contoso', logoUrl: null }} day={today} sender="Omar Said" />
      </div>
    </FormDialog>
  );
}
