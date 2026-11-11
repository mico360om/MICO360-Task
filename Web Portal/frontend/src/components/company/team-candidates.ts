import { useEffectiveAdmin } from '../../lib/manager-view';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { companiesApi, type CompanyPersonOption } from '../../api/companies';
import type { ApiProject, ApiProjectCompany } from '../../api/projects';
import { useMyCompanies } from '../../hooks/useMyCompanies';

/** A project's companies, main first as the server sends them (`ApiProject.companies`); none from an older payload. */
export function projectCompaniesOf(project: Pick<ApiProject, 'companies'> | null | undefined): ApiProjectCompany[] {
  return Array.isArray(project?.companies) ? [...project.companies] : [];
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
export function useTeamCandidateState(companyIds: readonly string[] | null, opts: { projectId?: string | null } = {}): TeamCandidates {
  const { data, companies, siteCompanyCount } = useMyCompanies();
  // Manager View (owner, 10 Nov): adding people is a project setting — as a project's manager then.
  const isAdmin = useEffectiveAdmin();
  const several = !!data && siteCompanyCount >= 2;
  const mine = new Set(companies.map((c) => c.id));
  // A project that exists, its companies as they are: ask the project — the people of ANY of its
  // companies (owner, 31 Oct), the server checking that I may run its team.
  const projectId = opts.projectId || null;
  const ids = projectId ? [] : [...new Set(companyIds ?? [])].filter((id) => isAdmin || mine.has(id));
  const q = useQuery({
    queryKey: projectId ? ['people', 'candidates', 'project', projectId] : ['people', 'candidates', ...ids],
    queryFn: () => (projectId ? companiesApi(apiClient).projectCandidates(projectId) : companiesApi(apiClient).candidates(ids)),
    enabled: several && (!!projectId || ids.length > 0),
    staleTime: 60_000,
    // A company added or taken off: the people offered so far stay until the new answer comes.
    placeholderData: keepPreviousData,
  });
  if (!several) return { people: null, settled: false };
  if (!projectId && ids.length === 0) return { people: NOBODY, settled: true };
  return { people: Array.isArray(q.data) ? q.data : NOBODY, settled: q.isSuccess && !q.isPlaceholderData && Array.isArray(q.data) };
}

/** The people offered for a team in these companies (see useTeamCandidateState); null: the directory. */
export function useTeamCandidates(companyIds: readonly string[] | null, opts: { projectId?: string | null } = {}): CompanyPersonOption[] | null {
  return useTeamCandidateState(companyIds, opts).people;
}
