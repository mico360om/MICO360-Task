import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { companiesApi, type ApiCompany } from '../api/companies';
import { CompanyFormDialog, type CompanyTab } from '../components/company/CompanyFormDialog';
import { CompanyLogo } from '../components/company/CompanyLogo';
import { COMPANIES_KEY, peopleCount, problemText, projectsCount, refreshCompanies, weekStartName } from '../components/company/company-admin';
import { useShortcut } from '../components/shortcuts/ShortcutProvider';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { PageHeader } from '../components/ui/PageHeader';
import { instantDayText } from '../lib/day-words';
import { useCompanyTimeZone } from '../lib/useCompanyTimeZone';
import { useMediaQuery } from '../lib/useMediaQuery';

/** Below 768px (the md width, in em as the layout's widths are): one card per company instead of the table. */
const PHONE_QUERY = '(max-width: 47.9375em)';
/** A finger-sized target on a touch screen ('!': over the base rule's 32px for every button). */
const TOUCH = '[@media(pointer:coarse)]:!min-h-11';
const ACTION = `rounded-lg border border-line px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${TOUCH}`;

/**
 * Companies (Admin), administrators only: every company on the site with its people, projects,
 * week start and status. A company opens in a dialog (its details, people and projects); "New
 * company" makes one. Companies are never deleted, only archived (and unarchived).
 */
export function CompaniesPage() {
  const qc = useQueryClient();
  const api = companiesApi(apiClient);
  const q = useQuery({ queryKey: COMPANIES_KEY, queryFn: () => api.list() });
  const companies = (Array.isArray(q.data) ? [...q.data] : []).sort((a, b) => a.name.localeCompare(b.name, 'en'));
  const [open, setOpen] = useState<{ id: string | null; tab: CompanyTab } | null>(null);
  const [archiving, setArchiving] = useState<ApiCompany | null>(null);
  // What just happened: the company's name (its administrator's own text, shown in its own direction), then the words.
  const [notice, setNotice] = useState<{ name?: string; text: string; error?: boolean } | null>(null);
  const timeZone = useCompanyTimeZone();
  const phone = useMediaQuery(PHONE_QUERY);
  const openNew = () => setOpen({ id: null, tab: 'details' });
  useShortcut('new', openNew);

  const archiveMut = useMutation({
    mutationFn: (c: ApiCompany) => api.archive(c.id),
    onSuccess: (c) => {
      setArchiving(null);
      setNotice({ name: c.name, text: 'archived.' });
      refreshCompanies(qc);
    },
  });
  const unarchiveMut = useMutation({
    mutationFn: (c: ApiCompany) => api.unarchive(c.id),
    onMutate: () => setNotice(null),
    onSuccess: (c) => {
      setNotice({ name: c.name, text: 'unarchived.' });
      refreshCompanies(qc);
    },
    onError: (err, c) => setNotice({ text: problemText(err, `Couldn’t unarchive ${c.name}. Please try again.`), error: true }),
  });

  const opened = open?.id ? companies.find((c) => c.id === open.id) : null;

  const nameButton = (c: ApiCompany) => (
    <button type="button" onClick={() => setOpen({ id: c.id, tab: 'details' })} className={`flex min-w-0 items-center gap-2 rounded text-left font-medium text-ink hover:text-brand hover:underline ${TOUCH}`}>
      <CompanyLogo company={c} size={32} />
      <bdi className="min-w-0 [overflow-wrap:anywhere]">{c.name}</bdi>
    </button>
  );
  const countButton = (c: ApiCompany, tab: 'people' | 'projects') => {
    const n = tab === 'people' ? c.counts.people : c.counts.projects;
    return (
      <button
        type="button"
        onClick={() => setOpen({ id: c.id, tab })}
        aria-label={`${tab === 'people' ? peopleCount(n) : projectsCount(n)} in ${c.name}`}
        className={`min-w-[2rem] rounded px-1 text-left tabular-nums text-ink hover:text-brand hover:underline ${TOUCH}`}
      >
        {n}
      </button>
    );
  };
  const weekStarts = (c: ApiCompany) => (c.weekStart == null ? 'Same as the site' : weekStartName(c.weekStart));
  const status = (c: ApiCompany) =>
    c.status === 'ACTIVE' ? (
      <Badge tone="success">Active</Badge>
    ) : (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <Badge>Archived</Badge>{' '}
        {c.archivedAt ? <span className="whitespace-nowrap text-xs text-ink-2">since {instantDayText(c.archivedAt, timeZone)}</span> : null}
      </span>
    );
  const actions = (c: ApiCompany) =>
    c.status === 'ACTIVE' ? (
      <button type="button" onClick={() => { archiveMut.reset(); setArchiving(c); }} aria-label={`Archive ${c.name}`} className={`${ACTION} text-ink-2 hover:border-brand/30 hover:bg-ground hover:text-ink`}>
        Archive
      </button>
    ) : (
      <button type="button" onClick={() => unarchiveMut.mutate(c)} disabled={unarchiveMut.isPending} aria-label={`Unarchive ${c.name}`} className={`${ACTION} text-ink-2 hover:border-brand/30 hover:bg-ground hover:text-ink`}>
        Unarchive
      </button>
    );

  return (
    <div>
      <PageHeader
        eyebrow="Admin"
        title="Companies"
        subtitle="Each company’s name, logo, week and working hours, its people and its projects."
        actions={<Button onClick={openNew} title="New company" shortcut="new">+ New company</Button>}
      />

      {notice ? (
        <div role={notice.error ? 'alert' : 'status'} className={`mb-4 flex items-start justify-between gap-3 rounded-lg px-3 py-2 text-sm ${notice.error ? 'bg-danger-soft text-danger' : 'bg-success-soft text-success'}`}>
          <p>{notice.name ? <><bdi>{notice.name}</bdi> </> : null}{notice.text}</p>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="shrink-0 opacity-80 hover:opacity-100">✕</button>
        </div>
      ) : null}

      <div className={phone ? '' : 'card overflow-x-auto'} tabIndex={phone ? undefined : 0} role={phone ? undefined : 'region'} aria-label={phone ? undefined : 'Companies'}>
        {q.isLoading ? (
          <p className="p-4 text-ink-2">Loading…</p>
        ) : q.isError ? (
          <p role="alert" className="p-4 text-danger">
            Couldn’t load the companies.{' '}
            <button type="button" onClick={() => void q.refetch()} className="font-semibold underline">Retry</button>
          </p>
        ) : companies.length === 0 ? (
          <p className="p-4 text-ink-2">No companies yet.</p>
        ) : phone ? (
          <ul aria-label="Companies" className="flex flex-col gap-2">
            {companies.map((c) => (
              <li key={c.id} className="min-w-0 rounded-xl border border-line bg-surface p-3 shadow-soft">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {nameButton(c)}
                    <p className="mt-0.5 font-mono text-xs text-ink-2">{c.code}</p>
                  </div>
                  <div className="flex-none">{status(c)}</div>
                </div>
                <dl className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1 text-sm">
                  <div className="min-w-0">
                    <dt className="text-xs text-ink-3">People</dt>
                    <dd>{countButton(c, 'people')}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-xs text-ink-3">Projects</dt>
                    <dd>{countButton(c, 'projects')}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-xs text-ink-3">Week starts</dt>
                    <dd className="text-ink-2">{weekStarts(c)}</dd>
                  </div>
                </dl>
                <div className="mt-3 flex flex-wrap items-center gap-2">{actions(c)}</div>
              </li>
            ))}
          </ul>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-2">
                <th className="p-3">Company</th>
                <th className="p-3">Code</th>
                <th className="p-3">People</th>
                <th className="p-3">Projects</th>
                <th className="p-3">Week starts</th>
                <th className="p-3">Status</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => (
                <tr key={c.id} className="border-b border-line last:border-0">
                  <td className="p-3">{nameButton(c)}</td>
                  <td className="whitespace-nowrap p-3 font-mono text-xs text-ink-2">{c.code}</td>
                  <td className="p-3">{countButton(c, 'people')}</td>
                  <td className="p-3">{countButton(c, 'projects')}</td>
                  <td className="whitespace-nowrap p-3 text-ink-2">{weekStarts(c)}</td>
                  <td className="p-3">{status(c)}</td>
                  <td className="p-3">
                    <div className="flex items-center justify-end gap-2">{actions(c)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {archiving ? (
        <ConfirmDialog
          title={`Archive ${archiving.name}?`}
          confirmLabel="Archive company"
          keepLabel="Cancel"
          busy={archiveMut.isPending}
          error={archiveMut.isError ? problemText(archiveMut.error, `Couldn’t archive ${archiving.name}. Please try again.`) : null}
          onConfirm={() => archiveMut.mutate(archiving)}
          onClose={() => setArchiving(null)}
        >
          Its projects become archived, and people who belong only to <bdi>{archiving.name}</bdi> see an empty site until they get another company.
        </ConfirmDialog>
      ) : null}
      {open && (open.id === null || opened) ? (
        <CompanyFormDialog
          key={open.id ?? 'new'}
          company={opened ?? null}
          initialTab={open.tab}
          onClose={() => setOpen(null)}
          onSaved={(c, created) => setNotice({ name: c.name, text: created ? 'created.' : 'saved.' })}
        />
      ) : null}
    </div>
  );
}
