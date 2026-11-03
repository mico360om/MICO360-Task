import type { ApiProject } from '../../api/projects';
import { useMyCompanies } from '../../hooks/useMyCompanies';
import { CompanyLogo } from './CompanyLogo';

/**
 * Under a project's title: the companies it belongs to, its main company first and marked "Main"
 * (its logo and week are the project's). Shown only on a site with two or more companies — or when
 * the project itself is in two or more — so a one-company site looks as before.
 */
export function ProjectCompanies({ project }: { project: ApiProject }) {
  const { siteCompanyCount } = useMyCompanies();
  const companies = Array.isArray(project.companies) ? project.companies : [];
  if (companies.length === 0 || (siteCompanyCount < 2 && companies.length < 2)) return null;
  const ordered = [...companies.filter((c) => c.isMain), ...companies.filter((c) => !c.isMain)];
  return (
    <ul aria-label="Companies" className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {ordered.map((c) => (
        <li key={c.id} className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-0.5 text-xs text-ink">
          <CompanyLogo company={c} size={16} />
          <bdi className="min-w-0 truncate">{c.name}</bdi>
          {c.isMain ? <span className="rounded bg-brand/10 px-1 text-[10px] font-semibold uppercase tracking-wide text-brand">Main</span> : null}
        </li>
      ))}
    </ul>
  );
}
