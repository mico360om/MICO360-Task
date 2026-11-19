import { useEffect, useId, useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiClient } from '../../api/client';
import {
  appreciationsApi,
  APPRECIATIONS_ME_KEY,
  type ApiAppreciation,
  type ApiAppreciationPerson,
  type ApiAppreciationTemplate,
  type AppreciationContent,
} from '../../api/appreciations';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { LoadError } from '../ui/LoadError';
import { FieldLabel, fieldClass } from '../ui/Field';
import { ContentFields } from './AppreciationFields';
import { AppreciationIconSvg } from './AppreciationArt';
import { AppreciationPopupPreview } from './AppreciationPopup';
import { dayShort, dayWords, fillPlaceholders, themeGradient } from '../../lib/appreciation';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { TOUCH_TALL } from '../../lib/touch';
import { useAuthStore } from '../../stores/auth-store';

/**
 * 1.24.2 Appreciations → Send (the owner's "Three steps + live preview", 19 Nov): 1 People (search, company, Select
 * all shown / Clear, picked chips and count, one company chip per person), 2 Template (cards), 3 Message & day; the
 * popup's live preview beside them (a folded "Preview" section on narrower screens) and an action bar that stays in
 * view. The server, permissions and scheduling rules are unchanged.
 */
const api = appreciationsApi(apiClient);
export const SEND_KEYS = {
  templates: ['appreciations', 'templates', false] as const,
  people: (search: string, companyId: string) => ['appreciations', 'people', search, companyId] as const,
  companies: ['appreciations', 'companies'] as const,
};
/** Two columns (steps | preview) from about 1100 px — in the site's em units (1100 / 16). */
export const SEND_WIDE = '(min-width: 68.75em)';
const BLANK: AppreciationContent = { title: '', message: '', theme: 'ruby', icon: 'star', animation: 'confetti' };
const contentOf = (t: AppreciationContent): AppreciationContent => ({ title: t.title, message: t.message, theme: t.theme, icon: t.icon, animation: t.animation });
const problemOf = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Something went wrong. Please try again.');
const peopleWord = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;

type Picked = { name: string; avatarUrl: string | null; company: { name: string; logoUrl: string | null } };

function useSettled(value: string, ms = 300): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return settled;
}

/** Why Schedule can't be pressed yet (the first thing missing), or null. */
export function sendBlocker(s: { picked: number; templateId: string; content: AppreciationContent; day: string; today: string }): string | null {
  if (s.picked === 0) return 'Pick at least one person.';
  if (!s.templateId) return 'Choose a template.';
  if (!s.content.title.trim()) return 'Add a title.';
  if (!s.content.message.trim()) return 'Write a message.';
  if (!s.day || s.day < s.today) return 'Choose today or a later day.';
  return null;
}

export function SendTab({ today, onSent }: { today: string; onSent: () => void }) {
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const id = useId();
  const wide = useMediaQuery(SEND_WIDE, true);
  const [search, setSearch] = useState('');
  const [companyId, setCompanyId] = useState('');
  const settled = useSettled(search);
  const companies = useQuery({ queryKey: SEND_KEYS.companies, queryFn: () => api.companies() });
  const people = useQuery({ queryKey: SEND_KEYS.people(settled, companyId), queryFn: () => api.people(settled, companyId), placeholderData: keepPreviousData });
  const templates = useQuery({ queryKey: SEND_KEYS.templates, queryFn: () => api.templates() });
  const [picked, setPicked] = useState<Map<string, Picked>>(new Map());
  const [templateId, setTemplateId] = useState<string>('');
  const [content, setContent] = useState<AppreciationContent>(BLANK);
  const [day, setDay] = useState(today);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  // The first template once they arrive.
  useEffect(() => {
    const first = templates.data?.[0];
    if (!templateId && first) {
      setTemplateId(first.id);
      setContent(contentOf(first));
    }
  }, [templates.data, templateId]);

  const schedule = useMutation({
    mutationFn: () => api.schedule({ ...content, recipientIds: [...picked.keys()], templateId: templateId || null, day }),
    onSuccess: (r) => {
      setDone(`Scheduled for ${peopleWord(r.ids.length)} on ${dayWords(day)}.`);
      setProblem(null);
      setPicked(new Map());
      void qc.invalidateQueries({ queryKey: ['appreciations'] });
      void qc.invalidateQueries({ queryKey: APPRECIATIONS_ME_KEY });
    },
    onError: (e) => setProblem(problemOf(e)),
  });

  const entryOf = (p: ApiAppreciationPerson): Picked => ({ name: p.name, avatarUrl: p.avatarUrl, company: { name: p.companies[0]?.name ?? 'Your company', logoUrl: null } });
  const toggle = (p: ApiAppreciationPerson) =>
    setPicked((old) => {
      const n = new Map(old);
      if (n.has(p.id)) n.delete(p.id);
      else n.set(p.id, entryOf(p));
      return n;
    });
  const remove = (pid: string) =>
    setPicked((old) => {
      const n = new Map(old);
      n.delete(pid);
      return n;
    });
  const shown = people.data ?? [];
  const selectAllShown = () =>
    setPicked((old) => {
      const n = new Map(old);
      for (const p of shown) if (!n.has(p.id)) n.set(p.id, entryOf(p));
      return n;
    });

  const blocker = sendBlocker({ picked: picked.size, templateId, content, day, today });
  const dayOk = !!day && day >= today;
  const label = picked.size ? `Schedule for ${peopleWord(picked.size)}${dayOk ? ` on ${dayShort(day)}` : ''}` : dayOk ? `Schedule on ${dayShort(day)}` : 'Schedule';

  const first = [...picked.values()][0];
  const senderName = me ? [me.firstName, me.lastName].filter(Boolean).join(' ').trim() || me.username : 'You';
  const exampleCompany = first?.company ?? { name: companies.data?.find((c) => c.id === companyId)?.name ?? companies.data?.[0]?.name ?? 'Your company', logoUrl: null };
  const previewDay = dayOk ? day : today;
  const previewOf: ApiAppreciation = useMemo(
    () => ({
      id: 'send-preview',
      batchId: '',
      title: content.title || 'Title',
      message: fillPlaceholders(content.message || 'Message', { name: first?.name ?? 'Name', company: exampleCompany.name, day: previewDay }),
      theme: content.theme,
      icon: content.icon,
      animation: content.animation,
      day: previewDay,
      startsAt: '',
      endsAt: '',
      status: 'SCHEDULED',
      acceptedAt: null,
      acceptNote: null,
      popupClosedAt: null,
      sender: { id: me?.id ?? '', name: senderName },
      company: exampleCompany,
    }),
    [content, first?.name, exampleCompany, previewDay, me?.id, senderName],
  );

  const preview = (
    <div className="flex flex-col gap-2">
      <AppreciationPopupPreview a={previewOf} />
      <p className="text-xs text-ink-2">
        {first ? <>As <bdi>{first.name}</bdi> will see it{picked.size > 1 ? '; each person sees their own name' : ''}.</> : 'Pick someone to see it with their name.'}
      </p>
    </div>
  );

  return (
    <div data-appreciation-send className="flex flex-col gap-5">
      <div className={wide ? 'grid grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)] items-start gap-5' : 'flex flex-col gap-5'}>
        <div className="flex min-w-0 flex-col gap-5">
          {/* ── 1. People ─────────────────────────────────────────────── */}
          <section className="card card-pad flex min-w-0 flex-col gap-3" aria-labelledby={`${id}-people`} data-people-step>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id={`${id}-people`} className="font-display text-base font-semibold text-ink">
                <StepNumber n={1} />
                People
              </h2>
              <p className="text-sm text-ink-2" aria-live="polite">
                {`${picked.size} picked`}
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <FieldLabel htmlFor={`${id}-search`}>Search</FieldLabel>
                <input id={`${id}-search`} type="search" className={fieldClass(false)} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or email" />
              </div>
              <div className="flex min-w-0 flex-col gap-1 sm:w-52">
                <FieldLabel htmlFor={`${id}-company`}>Company</FieldLabel>
                <select id={`${id}-company`} className={fieldClass(false)} value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
                  <option value="">All my companies</option>
                  {(companies.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            </div>
            {picked.size ? (
              <ul className="flex flex-wrap gap-1.5" aria-label="Picked people" data-picked>
                {[...picked.entries()].map(([pid, p]) => (
                  <li key={pid} className="min-w-0 max-w-full">
                    <button
                      type="button"
                      onClick={() => remove(pid)}
                      className={`inline-flex max-w-full items-center gap-1.5 rounded-full bg-brand/10 py-1 pe-2.5 ps-1 text-xs font-medium text-brand hover:bg-brand/15 ${TOUCH_TALL}`}
                      aria-label={`Remove ${p.name}`}
                    >
                      <Avatar name={p.name} src={p.avatarUrl} size="sm" decorative />
                      <bdi className="truncate">{p.name}</bdi>
                      <span aria-hidden="true">×</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" size="sm" className={TOUCH_TALL} onClick={selectAllShown} disabled={shown.length === 0}>
                Select all shown
              </Button>
              <Button variant="ghost" size="sm" className={TOUCH_TALL} onClick={() => setPicked(new Map())} disabled={picked.size === 0}>
                Clear
              </Button>
              <span className="text-xs text-ink-2">{people.data ? `${shown.length} shown` : ''}</span>
            </div>
            {people.isError ? (
              <LoadError what="people" onRetry={() => void people.refetch()} />
            ) : (
              <fieldset className="max-h-[420px] overflow-y-auto rounded-xl border border-line" aria-label="People to appreciate">
                {shown.length === 0 && !people.isPending ? <p className="p-3 text-sm text-ink-2">No one matches.</p> : null}
                {people.isPending ? <div role="status" aria-label="Loading people" className="skeleton m-2 h-24 rounded-lg" /> : null}
                {shown.map((p) => (
                  <PersonRow key={p.id} person={p} checked={picked.has(p.id)} onToggle={() => toggle(p)} />
                ))}
              </fieldset>
            )}
          </section>

          {/* ── 2. Template ───────────────────────────────────────────── */}
          <section className="card card-pad flex min-w-0 flex-col gap-3" aria-labelledby={`${id}-template`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id={`${id}-template`} className="font-display text-base font-semibold text-ink">
                <StepNumber n={2} />
                Template
              </h2>
              <Link to={{ search: '?tab=templates' }} className="text-sm font-semibold text-brand underline-offset-2 hover:underline">
                Manage templates
              </Link>
            </div>
            {templates.isError ? (
              <LoadError what="the templates" onRetry={() => void templates.refetch()} />
            ) : templates.isPending ? (
              <div role="status" aria-label="Loading the templates" className="skeleton h-24 rounded-xl" />
            ) : (templates.data ?? []).length === 0 ? (
              <p className="text-sm text-ink-2">No templates yet. Make one in Manage templates.</p>
            ) : (
              <div role="radiogroup" aria-label="Template" className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2.5">
                {(templates.data ?? []).map((t) => (
                  <TemplateCard
                    key={t.id}
                    t={t}
                    name={`${id}-tpl`}
                    checked={templateId === t.id}
                    onPick={() => {
                      setTemplateId(t.id);
                      setContent(contentOf(t));
                    }}
                  />
                ))}
              </div>
            )}
          </section>

          {/* ── 3. Message & day ──────────────────────────────────────── */}
          <section className="card card-pad flex min-w-0 flex-col gap-4" aria-labelledby={`${id}-words`}>
            <h2 id={`${id}-words`} className="font-display text-base font-semibold text-ink">
              <StepNumber n={3} />
              Message &amp; day
            </h2>
            <ContentFields value={content} onChange={setContent} />
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor={`${id}-day`} required>Day</FieldLabel>
              <div className="flex flex-wrap items-center gap-3">
                <input
                  id={`${id}-day`}
                  type="date"
                  className={fieldClass(!dayOk, 'min-w-0')}
                  min={today}
                  value={day}
                  aria-describedby={`${id}-day-words ${id}-day-hint`}
                  onChange={(e) => setDay(e.target.value)}
                />
                {dayOk ? (
                  <span id={`${id}-day-words`} className="text-sm font-semibold text-ink" data-day-words>
                    {dayShort(day)}
                  </span>
                ) : (
                  <span id={`${id}-day-words`} className="text-sm text-danger">Choose today or a later day.</span>
                )}
              </div>
              <p id={`${id}-day-hint`} className="text-xs text-ink-2">Shown all day, 00:00–23:59 company time. Today starts at once.</p>
            </div>
          </section>
        </div>

        {wide ? (
          <aside className="sticky top-[4.5rem] flex min-w-0 flex-col gap-2" aria-labelledby={`${id}-preview`}>
            <h2 id={`${id}-preview`} className="font-display text-base font-semibold text-ink">Preview</h2>
            {preview}
          </aside>
        ) : null}
      </div>

      {!wide ? (
        <section className="card overflow-hidden" aria-labelledby={`${id}-preview-toggle`}>
          <h2 className="m-0">
            <button
              id={`${id}-preview-toggle`}
              type="button"
              aria-expanded={previewOpen}
              aria-controls={`${id}-preview-body`}
              onClick={() => setPreviewOpen((o) => !o)}
              className="flex min-h-11 w-full items-center justify-between gap-2 px-4 py-2 text-start font-display text-base font-semibold text-ink hover:bg-ground"
              data-preview-toggle
            >
              Preview
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`transition-transform ${previewOpen ? 'rotate-180' : ''}`}>
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
          </h2>
          {previewOpen ? (
            <div id={`${id}-preview-body`} className="border-t border-line p-3 sm:p-4">
              {preview}
            </div>
          ) : null}
        </section>
      ) : null}

      {/* ── The action bar ─────────────────────────────────────────── */}
      <div className="sticky bottom-0 z-20 -mx-1 px-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1" data-send-bar>
        <div className="flex flex-col gap-2 rounded-2xl border border-line bg-surface px-3 py-2.5 shadow-lift sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1 text-sm">
            {problem ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-danger">{problem}</p> : null}
            <p role="status" aria-live="polite" className={done ? 'rounded-lg bg-success-soft px-3 py-2 text-success' : 'sr-only'}>
              {done}
              {done ? (
                <>
                  {' '}
                  <button type="button" className="font-semibold underline" onClick={onSent}>See the history</button>
                </>
              ) : null}
            </p>
            {blocker && !done && !problem ? (
              <p id={`${id}-reason`} className="text-ink-2" data-send-reason>{blocker}</p>
            ) : blocker ? (
              <p id={`${id}-reason`} className="sr-only" data-send-reason>{blocker}</p>
            ) : null}
          </div>
          <Button
            onClick={() => {
              setDone(null);
              schedule.mutate();
            }}
            loading={schedule.isPending}
            disabled={!!blocker}
            aria-describedby={blocker ? `${id}-reason` : undefined}
            className={`w-full sm:w-auto ${TOUCH_TALL}`}
            data-schedule
          >
            {label}
          </Button>
        </div>
      </div>
    </div>
  );
}

function StepNumber({ n }: { n: number }) {
  return (
    <>
      <span aria-hidden="true" className="me-2 inline-grid h-6 w-6 place-items-center rounded-full bg-brand text-xs font-bold text-white align-[1px]">
        {n}
      </span>
      <span className="sr-only">{n}. </span>
    </>
  );
}

function PersonRow({ person: p, checked, onToggle }: { person: ApiAppreciationPerson; checked: boolean; onToggle: () => void }) {
  const [main, ...others] = p.companies;
  const all = p.companies.map((c) => c.name).join(', ');
  return (
    <label
      className={`flex min-h-11 cursor-pointer items-center gap-3 border-b border-line px-3 py-2 text-sm last:border-b-0 hover:bg-ground has-[:focus-visible]:bg-ground ${checked ? 'bg-brand/5' : ''}`}
      data-person={p.id}
    >
      <input type="checkbox" checked={checked} onChange={onToggle} className="h-4 w-4 flex-none accent-[rgb(var(--c-brand))]" />
      <Avatar name={p.name} src={p.avatarUrl} decorative />
      <bdi className="min-w-0 flex-1 truncate text-ink">{p.name}</bdi>
      {main ? (
        <span className="flex min-w-0 max-w-[45%] flex-none items-center gap-1">
          <span className="truncate rounded-full border border-line bg-ground px-2 py-0.5 text-xs text-ink-2" data-company-chip>
            <bdi>{main.name}</bdi>
          </span>
          {others.length ? (
            <span className="flex-none rounded-full bg-ground px-1.5 py-0.5 text-xs font-semibold text-ink-2" title={all} data-more-companies>
              <span aria-hidden="true">+{others.length}</span>
              <span className="sr-only">, also {others.map((c) => c.name).join(', ')}</span>
            </span>
          ) : null}
        </span>
      ) : null}
    </label>
  );
}

function TemplateCard({ t, name, checked, onPick }: { t: ApiAppreciationTemplate; name: string; checked: boolean; onPick: () => void }) {
  return (
    <label
      className={`relative flex cursor-pointer flex-col overflow-hidden rounded-xl border bg-surface transition-shadow has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[rgb(var(--c-brand-text))] ${checked ? 'border-brand ring-2 ring-brand/40' : 'border-line hover:shadow-soft'}`}
      data-template-card={t.id}
    >
      <input type="radio" name={name} value={t.id} checked={checked} onChange={onPick} className="sr-only" />
      <span className="relative flex h-14 items-center justify-between px-3 text-white" style={{ backgroundImage: themeGradient(t.theme) }} data-template-band aria-hidden="true">
        <AppreciationIconSvg icon={t.icon} size={22} />
        {checked ? (
          <span className="grid h-6 w-6 place-items-center rounded-full bg-white text-[#1F1A19]">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </span>
        ) : null}
      </span>
      <span dir="auto" className="line-clamp-2 break-words px-3 py-2 text-sm font-medium text-ink">
        {t.name}
      </span>
    </label>
  );
}
