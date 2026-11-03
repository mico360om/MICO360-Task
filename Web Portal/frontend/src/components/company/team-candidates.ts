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

/** The people offered for a team, and whether that is the server's settled answer for these companies. */
export interface TeamCandidates {
  /** `null`: one company, or not known yet — the people directory, as before. */
  people: CompanyPersonOption[] | null;
  /**
   * The answer is for these very companies and was read: picked people it lacks can be dropped.
   * False while it is being read (the last answer may still show), after a reset, or when it failed.
   */
  settled: boolean;
}

/**
 * Who may join a team in these companies (`GET /people/candidates`), on a site with two or more
 * active companies; `people: null` — one company, or not known yet — means the people directory, as
 * before. Someone who isn't an administrator asks only about their own companies (the server refuses
 * the others: a Beta manager of an Alpha + Beta project is offered Beta people), so none of theirs
 * offers nobody. While a new choice of companies is asked about, the last answer stays.
 */
export function useTeamCandidateState(companyIds: readonly string[] | null): TeamCandidates {
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
  if (!several) return { people: null, settled: false };
  if (ids.length === 0) return { people: NOBODY, settled: true };
  return { people: Array.isArray(q.data) ? q.data : NOBODY, settled: q.isSuccess && !q.isPlaceholderData && Array.isArray(q.data) };
}

/** The people offered for a team in these companies (see useTeamCandidateState); null: the directory. */
export function useTeamCandidates(companyIds: readonly string[] | null): CompanyPersonOption[] | null {
  return useTeamCandidateState(companyIds).people;
}
