import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiClient } from '../../api/client';
import { companiesApi, type ApiCompany } from '../../api/companies';
import { Badge } from '../ui/Badge';
import { companyProjectsKey } from './company-admin';

/**
 * A company's projects (the Companies page's Projects tab), A–Z, each a link to its page: "Main"
 * where this is the project's main company (its PDFs and emails carry this company's logo and name),
 * "Archived" where it counts as archived.
 */
export function CompanyProjectsPanel({ company }: { company: ApiCompany }) {
  const q = useQuery({ queryKey: companyProjectsKey(company.id), queryFn: () => companiesApi(apiClient).projects(company.id) });
  const projects = Array.isArray(q.data) ? q.data : [];

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-ink">Projects ({q.isSuccess ? projects.length : company.counts.projects})</h3>
      {q.isLoading ? (
        <p className="text-sm text-ink-2">Loading…</p>
      ) : q.isError ? (
        <p role="alert" className="text-sm text-danger">
          Couldn’t load the projects.{' '}
          <button type="button" onClick={() => void q.refetch()} className="font-semibold underline">Retry</button>
        </p>
      ) : projects.length === 0 ? (
        <p className="text-sm text-ink-2">No projects in <bdi>{company.name}</bdi> yet.</p>
      ) : (
        <ul aria-label={`Projects of ${company.name}`} className="flex flex-col divide-y divide-line rounded-xl border border-line">
          {projects.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-3 py-2">
              <Link to={`/projects/${encodeURIComponent(p.id)}`} className="flex min-w-0 flex-1 items-baseline gap-2 rounded text-sm text-ink hover:text-brand hover:underline [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:items-center">
                <span className="flex-none font-mono text-xs text-ink-2">{p.code}</span>
                <bdi className="min-w-0 truncate font-medium">{p.name}</bdi>
              </Link>
              {p.isMain ? <span title={`Its PDFs and emails carry ${company.name}’s logo and name`}><Badge tone="brand">Main</Badge></span> : null}
              {p.archived ? <Badge>Archived</Badge> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
