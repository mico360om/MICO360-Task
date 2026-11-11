import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useInRouterContext } from 'react-router-dom';
import { notificationSettingsPath } from '../../lib/notification-settings-path';
import { apiClient } from '../../api/client';
import { companiesApi, type ApiCompany, type CompanyInput, type CompanyWeekStart, type CompanyWorkingHours } from '../../api/companies';
import { configApi } from '../../api/config';
import { systemSettingsApi } from '../../api/system-settings';
import { useDialog } from '../../hooks/useDialog';
import { DEFAULT_WORKING_HOURS, workingHoursText } from '../admin/MeetingHoursSettings';
import { Button } from '../ui/Button';
import { FieldLabel, fieldClass } from '../ui/Field';
import { ModalPortal } from '../ui/ModalPortal';
import { dialogLayer, dialogPanel, useTwoColumns } from '../ui/dialog-size';
import { Toggle } from '../ui/Toggle';
import { BuildingIcon, CompanyLogo } from './CompanyLogo';
import { CompanyPeoplePanel } from './CompanyPeoplePanel';
import { CompanyProjectsPanel } from './CompanyProjectsPanel';
import { companyPeopleKey, companyProjectsKey, problemText, refreshCompanies, WEEK_START_OPTIONS, weekStartName } from './company-admin';

export type CompanyTab = 'details' | 'people' | 'projects';

export interface CompanyFormDialogProps {
  /** The company to show; null for "New company". */
  company: ApiCompany | null;
  initialTab?: CompanyTab;
  onClose: () => void;
  /** Saved (`created`: it was made by this dialog's first save). */
  onSaved?: (company: ApiCompany, created: boolean) => void;
}

// The server's words (backend company-service COMPANY_ADMIN_WORDS), so a check here reads as its own.
const NAME_PROBLEM = 'Give the company a name of up to 120 characters.';
const CODE_PROBLEM = 'Use 2–10 capital letters or digits for the short code.';
const LOGO_PROBLEM = 'The logo must be a PNG, JPEG or WebP picture up to 2 MB.';
const CODE = /^[A-Z0-9]{2,10}$/;
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TABS: CompanyTab[] = ['details', 'people', 'projects'];

const isHours = (v: unknown): v is CompanyWorkingHours =>
  !!v && typeof v === 'object' && Array.isArray((v as CompanyWorkingHours).days) && typeof (v as CompanyWorkingHours).start === 'string' && typeof (v as CompanyWorkingHours).end === 'string';

type Logo = { kind: 'keep' } | { kind: 'remove' } | { kind: 'new'; file: File; preview: string | null };

/** What the days and times the form holds are missing, else null (the same words as System Settings → Meeting hours). */
function hoursProblem(h: CompanyWorkingHours): string | null {
  if (h.days.length === 0) return 'Choose at least one working day.';
  if (!/^\d{2}:\d{2}$/.test(h.start) || !/^\d{2}:\d{2}$/.test(h.end)) return 'Choose a start and an end time.';
  if (h.end <= h.start) return 'The day has to end after it starts.';
  return null;
}

/**
 * A company, as an administrator manages it on the Companies page: its details (name, short code,
 * logo, week start, working days and hours, email sender name — every company uses the site's
 * time zone) and, once it exists, its people and its projects, each on a tab. Settings left empty
 * follow the site's.
 */
export function CompanyFormDialog({ company, initialTab = 'details', onClose, onSaved }: CompanyFormDialogProps) {
  // The panel link (a dialog can open outside the router in tests).
  const inRouter = useInRouterContext();
  const qc = useQueryClient();
  const dialogRef = useDialog(onClose);
  const uid = useId();
  const id = (part: string) => `${uid}-${part}`;
  const api = companiesApi(apiClient);

  const [tab, setTab] = useState<CompanyTab>(company ? initialTab : 'details');
  const tabButtons = useRef(new Map<CompanyTab, HTMLButtonElement>());
  // A company made by this dialog whose logo then failed: the next Save changes it (never a second one).
  const [made, setMade] = useState<ApiCompany | null>(null);
  const current = company ?? made;

  const [name, setName] = useState(company?.name ?? '');
  const [code, setCode] = useState(company?.code ?? '');
  const [weekStart, setWeekStart] = useState<string>(company?.weekStart == null ? '' : String(company.weekStart));
  const [sameHours, setSameHours] = useState(!company?.workingHours);
  const [hours, setHours] = useState<CompanyWorkingHours | null>(company?.workingHours ?? null);
  const [sender, setSender] = useState(company?.senderName ?? '');
  const [logo, setLogo] = useState<Logo>({ kind: 'keep' });
  const [problem, setProblem] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // The site's week start (/config) and working hours (System Settings → Meeting hours): the "Same as the site" values.
  const configQ = useQuery({ queryKey: ['app-config'], queryFn: () => configApi(apiClient).get(), staleTime: Infinity, refetchOnWindowFocus: false });
  const siteWeekStart = (configQ.data as { weekStart?: unknown } | undefined)?.weekStart;
  const settingsQ = useQuery({ queryKey: ['system-settings'], queryFn: () => systemSettingsApi(apiClient).list() });
  const storedHours = Array.isArray(settingsQ.data) ? settingsQ.data.find((s) => s.key === 'meetings.workingHours')?.value : undefined;
  const siteHours: CompanyWorkingHours = isHours(storedHours) ? storedHours : company && !company.workingHours ? company.effective.workingHours : DEFAULT_WORKING_HOURS;
  const draftHours = hours ?? siteHours;

  // The tabs' numbers: what the panel last loaded, else the list's count.
  const peopleQ = useQuery({ queryKey: companyPeopleKey(company?.id ?? ''), queryFn: () => api.people(company!.id), enabled: false });
  const projectsQ = useQuery({ queryKey: companyProjectsKey(company?.id ?? ''), queryFn: () => api.projects(company!.id), enabled: false });
  const peopleN = Array.isArray(peopleQ.data) ? peopleQ.data.length : (company?.counts.people ?? 0);
  const projectsN = Array.isArray(projectsQ.data) ? projectsQ.data.length : (company?.counts.projects ?? 0);
  const tabLabel: Record<CompanyTab, string> = { details: 'Details', people: `People (${peopleN})`, projects: `Projects (${projectsN})` };

  // A picked logo's preview: the browser's own copy of the file, let go once it isn't shown.
  const preview = logo.kind === 'new' ? logo.preview : null;
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL?.(preview);
  }, [preview]);

  function pickLogo(file: File | undefined) {
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type) || file.size > LOGO_MAX_BYTES) {
      setProblem(LOGO_PROBLEM);
      return;
    }
    setProblem(null);
    setLogo({ kind: 'new', file, preview: typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null });
  }

  const saveMut = useMutation({
    mutationFn: async (input: CompanyInput) => {
      const target = current;
      let saved = target ? await api.update(target.id, input) : await api.create(input);
      const created = !company && !made;
      if (created) setMade(saved);
      try {
        if (logo.kind === 'new') saved = await api.uploadLogo(saved.id, logo.file);
        else if (logo.kind === 'remove' && saved.logoUrl) saved = await api.removeLogo(saved.id);
      } catch (err) {
        return { saved, created, logoProblem: problemText(err, 'Please try again.') };
      }
      return { saved, created, logoProblem: null };
    },
    onSuccess: ({ saved, created, logoProblem }) => {
      refreshCompanies(qc);
      onSaved?.(saved, created);
      if (logoProblem) {
        setProblem(`${saved.name} was ${created ? 'created' : 'saved'}, but its logo wasn’t saved: ${logoProblem}`);
        return;
      }
      onClose();
    },
    onError: (err) => setProblem(problemText(err, 'Couldn’t save the company. Please try again.')),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setProblem(null);
    const cleanName = name.trim();
    if (!cleanName || cleanName.length > 120) return setProblem(NAME_PROBLEM);
    const cleanCode = code.trim();
    if (!CODE.test(cleanCode)) return setProblem(CODE_PROBLEM);
    if (!sameHours) {
      const wrong = hoursProblem(draftHours);
      if (wrong) return setProblem(wrong);
    }
    saveMut.mutate({
      name: cleanName,
      code: cleanCode,
      weekStart: weekStart === '' ? null : (Number(weekStart) as CompanyWeekStart),
      workingHours: sameHours ? null : { days: [...draftHours.days].sort((a, b) => a - b), start: draftHours.start, end: draftHours.end },
      senderName: sender.trim() || null,
    });
  }

  // Each change builds on the last one (two quick presses before a redraw both count).
  const changeHours = (change: (h: CompanyWorkingHours) => CompanyWorkingHours) => setHours((h) => change(h ?? siteHours));
  const toggleDay = (day: number) => changeHours((h) => ({ ...h, days: h.days.includes(day) ? h.days.filter((d) => d !== day) : [...h.days, day].sort((a, b) => a - b) }));

  // Arrow keys, Home and End move along the tabs (the open one is the only Tab stop).
  function onTabKey(e: KeyboardEvent<HTMLDivElement>) {
    const at = TABS.indexOf(tab);
    const go = (i: number) => {
      e.preventDefault();
      const next = TABS[(i + TABS.length) % TABS.length]!;
      setTab(next);
      tabButtons.current.get(next)?.focus();
    };
    if (e.key === 'ArrowRight') go(at + 1);
    else if (e.key === 'ArrowLeft') go(at - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(TABS.length - 1);
  }

  const shownLogoUrl = logo.kind === 'keep' ? (current?.logoUrl ?? null) : null;
  const hasLogo = logo.kind === 'new' || Boolean(shownLogoUrl);
  const title = company ? company.name : 'New company';

  // Big form (1.22): 960px and two columns from 1024px — the company on the left, its week and
  // working hours on the right. One column below (in the order the fields always had).
  const twoColumns = useTwoColumns();
  const nameFields = (
    <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
      <div className="flex flex-col gap-1.5">
        <FieldLabel htmlFor={id('name')} required>Name</FieldLabel>
        <input id={id('name')} dir="auto" value={name} maxLength={120} aria-required="true" onChange={(e) => setName(e.target.value)} className={fieldClass(false)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <FieldLabel htmlFor={id('code')} required>Short code</FieldLabel>
        <input
          id={id('code')}
          value={code}
          maxLength={10}
          aria-required="true"
          aria-describedby={id('code-hint')}
          autoCapitalize="characters"
          spellCheck={false}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          className={fieldClass(false, 'font-mono uppercase')}
        />
        <p id={id('code-hint')} className="text-xs text-ink-2">2–10 capital letters or digits</p>
      </div>
    </div>
  );
  const logoField = (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink" id={id('logo-label')}>Logo</span>
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid h-12 w-12 flex-none place-items-center rounded-lg border border-line bg-ground text-ink-3">
          {logo.kind === 'new' && logo.preview ? (
            <img src={logo.preview} alt={`${name.trim() || 'New company'} logo`} width={48} height={48} className="h-12 w-12 rounded-lg object-contain" />
          ) : shownLogoUrl && current ? (
            <CompanyLogo company={{ name: current.name, logoUrl: shownLogoUrl }} size={48} alt={`${current.name} logo`} />
          ) : (
            <BuildingIcon size={24} />
          )}
        </span>
        <input
          ref={fileRef}
          type="file"
          accept={LOGO_TYPES.join(',')}
          aria-label="Upload logo"
          tabIndex={-1}
          className="sr-only"
          onChange={(e) => {
            pickLogo(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <Button type="button" variant="secondary" size="sm" aria-describedby={id('logo-hint')} onClick={() => fileRef.current?.click()} className="[@media(pointer:coarse)]:!min-h-11">
          Upload logo
        </Button>
        {hasLogo ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => setLogo(logo.kind === 'new' && !current?.logoUrl ? { kind: 'keep' } : { kind: 'remove' })} className="[@media(pointer:coarse)]:!min-h-11">
            Remove logo
          </Button>
        ) : null}
      </div>
      <p id={id('logo-hint')} className="text-xs text-ink-2">PNG, JPEG or WebP, up to 2 MB</p>
    </div>
  );
  const weekField = (
    <div className="flex flex-col gap-1.5">
      <FieldLabel htmlFor={id('week')}>Week starts on</FieldLabel>
      <select id={id('week')} value={weekStart} onChange={(e) => setWeekStart(e.target.value)} className={fieldClass(false, 'sm:max-w-xs [@media(pointer:coarse)]:!min-h-11')}>
        <option value="">Same as the site ({weekStartName(typeof siteWeekStart === 'number' ? siteWeekStart : 0)})</option>
        {WEEK_START_OPTIONS.map((o) => (
          <option key={o.value} value={String(o.value)}>{o.label}</option>
        ))}
      </select>
    </div>
  );
  const hoursField = (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-sm font-medium text-ink">Working days and hours</legend>
      <div className="flex items-center gap-3">
        <Toggle on={sameHours} onChange={() => setSameHours((v) => !v)} label="Same as the site" describedBy={id('hours-site')} />
        <span className="text-sm text-ink">Same as the site</span>
        <span id={id('hours-site')} className="text-xs text-ink-2">{workingHoursText(siteHours)}</span>
      </div>
      {sameHours ? null : (
        <>
          <div role="group" aria-label="Working days" className="flex flex-wrap gap-1.5">
            {DAYS.map((dayName, day) => (
              <button
                key={dayName}
                type="button"
                aria-pressed={draftHours.days.includes(day)}
                onClick={() => toggleDay(day)}
                className={`min-h-9 min-w-[3rem] rounded-lg border px-2.5 text-sm font-semibold transition-colors [@media(pointer:coarse)]:!min-h-11 ${draftHours.days.includes(day) ? 'border-brand bg-brand text-white' : 'border-line text-ink-2 hover:border-brand/40'}`}
              >
                {dayName}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
              From
              <input type="time" step={60 * 30} value={draftHours.start} onChange={(e) => { const start = e.target.value; changeHours((h) => ({ ...h, start })); }} className={fieldClass(false, 'py-1.5 [@media(pointer:coarse)]:!min-h-11')} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
              To
              <input type="time" step={60 * 30} value={draftHours.end} onChange={(e) => { const end = e.target.value; changeHours((h) => ({ ...h, end })); }} className={fieldClass(false, 'py-1.5 [@media(pointer:coarse)]:!min-h-11')} />
            </label>
          </div>
        </>
      )}
      <p className="text-xs text-ink-2">
        Holidays, reminders and quiet hours for this company are in{' '}
        {inRouter ? (
          <Link to={notificationSettingsPath('working-time', company?.id)} className="font-semibold text-brand hover:underline">
            Notification &amp; Scheduling
          </Link>
        ) : (
          <a href={notificationSettingsPath('working-time', company?.id)} className="font-semibold text-brand hover:underline">
            Notification &amp; Scheduling
          </a>
        )}
        .
      </p>
    </fieldset>
  );
  const senderField = (
    <div className="flex flex-col gap-1.5">
      <FieldLabel htmlFor={id('sender')}>Email sender name</FieldLabel>
      <input id={id('sender')} dir="auto" value={sender} maxLength={120} placeholder="Same as the site" onChange={(e) => setSender(e.target.value)} className={fieldClass(false)} />
    </div>
  );

  return (
    <ModalPortal>
      <div className={dialogLayer('wide')}>
        <div className="absolute inset-0 bg-scrim animate-fade-in" onClick={onClose} aria-hidden="true" />
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className={`keyboard-flow-cramped card relative flex ${dialogPanel('wide')} animate-scale-in flex-col overflow-hidden`}
        >
          <div className="flex flex-none items-center gap-3 px-4 pb-3 pt-5 sm:px-6">
            <CompanyLogo company={current ? { name: current.name, logoUrl: current.logoUrl } : null} size={32} />
            <div className="min-w-0">
              <h2 className="font-display text-xl font-bold leading-snug text-ink [overflow-wrap:anywhere]">{company ? <bdi>{company.name}</bdi> : 'New company'}</h2>
              {company ? <p className="text-xs text-ink-2">{company.code}</p> : null}
            </div>
          </div>

          {company ? (
            <div role="tablist" aria-label={`${company.name}: details, people and projects`} onKeyDown={onTabKey} className="-mb-px flex flex-none gap-1 overflow-x-auto border-b border-line px-4">
              {TABS.map((t) => (
                <button
                  key={t}
                  ref={(el) => {
                    if (el) tabButtons.current.set(t, el);
                    else tabButtons.current.delete(t);
                  }}
                  type="button"
                  role="tab"
                  id={id(`tab-${t}`)}
                  aria-controls={id(`panel-${t}`)}
                  aria-selected={tab === t}
                  tabIndex={tab === t ? 0 : -1}
                  onClick={() => setTab(t)}
                  className={`!min-h-[44px] flex-none border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${tab === t ? 'border-brand text-brand' : 'border-transparent text-ink-2 hover:text-ink'}`}
                >
                  {tabLabel[t]}
                </button>
              ))}
            </div>
          ) : null}

          {tab === 'details' ? (
            <form
              onSubmit={submit}
              noValidate
              className="keyboard-flow-body flex min-h-0 flex-1 flex-col"
              {...(company ? { role: 'tabpanel', id: id('panel-details'), 'aria-labelledby': id('tab-details') } : {})}
            >
              <div className="keyboard-flow-body flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4 sm:px-6">
                {problem ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{problem}</p> : null}
                {twoColumns ? (
                  <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-6">
                    <div data-form-column="company" className="flex min-w-0 flex-col gap-4">
                      {nameFields}
                      {logoField}
                      {senderField}
                    </div>
                    <div data-form-column="schedule" className="flex min-w-0 flex-col gap-4">
                      {weekField}
                      {hoursField}
                    </div>
                  </div>
                ) : (
                  <>
                    {nameFields}
                    {logoField}
                    {weekField}
                    {hoursField}
                    {senderField}
                  </>
                )}
              </div>
              <div className="flex flex-none items-center gap-2 border-t border-line px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:justify-end sm:px-6">
                <button type="button" title="Cancel (Esc)" aria-keyshortcuts="Escape" onClick={onClose} className="!min-h-[44px] flex-1 rounded-xl border border-line px-4 text-sm font-semibold text-ink transition-colors hover:bg-ground sm:flex-none">
                  Cancel
                </button>
                <Button type="submit" shortcut="save" loading={saveMut.isPending} className="!min-h-[44px] flex-[2] sm:min-w-[9.5rem] sm:flex-none">
                  Save
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div role="tabpanel" id={id(`panel-${tab}`)} aria-labelledby={id(`tab-${tab}`)} className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
                {company && tab === 'people' ? <CompanyPeoplePanel company={company} /> : null}
                {company && tab === 'projects' ? <CompanyProjectsPanel company={company} /> : null}
              </div>
              <div className="flex flex-none items-center border-t border-line px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:justify-end sm:px-6">
                <button type="button" onClick={onClose} className="!min-h-[44px] w-full rounded-xl border border-line px-4 text-sm font-semibold text-ink transition-colors hover:bg-ground sm:w-auto sm:min-w-[9.5rem]">
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </ModalPortal>
  );
}
