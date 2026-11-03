import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import type { CompanyPersonOption } from '../../api/companies';
import { meetingsApi } from '../../api/meetings';
import { useMyCompanies } from '../../hooks/useMyCompanies';

const NOBODY: CompanyPersonOption[] = [];

/**
 * Who may be invited to a meeting (`GET /meetings/invite-candidates`): of its project, or — without a
 * project — of its company. Only on a site with two or more active companies; `null` (one company, not
 * known yet, or a meeting with neither, made before companies) means the people directory, as before.
 * While a new project or company is asked about, the last answer stays.
 */
export function useInviteCandidates(target: { projectId?: string | null; companyId?: string | null }, enabled = true): CompanyPersonOption[] | null {
  const { data, siteCompanyCount } = useMyCompanies();
  const several = !!data && siteCompanyCount >= 2;
  const projectId = target.projectId || null;
  const companyId = projectId ? null : target.companyId || null;
  const ask = projectId !== null || companyId !== null;
  const q = useQuery({
    queryKey: ['meeting-invite-candidates', projectId, companyId],
    queryFn: () => meetingsApi(apiClient).inviteCandidates({ projectId, companyId }),
    enabled: enabled && several && ask,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
  if (!several || !ask) return null;
  return Array.isArray(q.data) ? q.data : NOBODY;
}
