import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { companiesApi, type CompanyPersonOption } from '../../api/companies';
import { useMyCompanies } from '../../hooks/useMyCompanies';
import { useAuthStore } from '../../stores/auth-store';

/**
 * One of a project's companies as its payload names them (`GET /projects`, `/projects/:id`: main
 * first). The project type carries the same fields once the read side of companies is in
 * (`ApiProject.companies`); this is what the team pickers and the project form read from it.
 */
export interface ProjectCompanyRef {
  id: string;
  name: string;
  logoUrl: string | null;
  isMain: boolean;
}

/** A project's companies, main first as the server sends them; none from a payload without them. */
export function projectCompaniesOf(project: object | null | undefined): ProjectCompanyRef[] {
  const list = (project as { companies?: unknown } | null | undefined)?.companies;
  return Array.isArray(list) ? [...(list as ProjectCompanyRef[])] : [];
}

const NOBODY: CompanyPersonOption[] = [];

/**
 * Who may join a team in these companies (`GET /people/candidates`), on a site with two or more
 * active companies; `null` — one company, or not known yet — means the people directory, as before.
 * Someone who isn't an administrator asks only about their own companies (the server refuses the
 * others: a Beta manager of an Alpha + Beta project is offered Beta people), so none of theirs
 * offers nobody. While a new choice of companies is asked about, the last answer stays.
 */
export function useTeamCandidates(companyIds: readonly string[] | null): CompanyPersonOption[] | null {
  const { data, companies, siteCompanyCount } = useMyCompanies();
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const several = !!data && siteCompanyCount >= 2;
  const mine = new Set(companies.map((c) => c.id));
  const ids = [...new Set(companyIds ?? [])].filter((id) => isAdmin || mine.has(id));
  const q = useQuery({
    queryKey: ['people', 'candidates', ...ids],
    queryFn: () => companiesApi(apiClient).candidates(ids),
    enabled: several && ids.length > 0,
    staleTime: 60_000,
    // A company added or taken off: the people offered so far stay until the new answer comes.
    placeholderData: keepPreviousData,
  });
  if (!several) return null;
  if (ids.length === 0) return NOBODY;
  return Array.isArray(q.data) ? q.data : NOBODY;
}
