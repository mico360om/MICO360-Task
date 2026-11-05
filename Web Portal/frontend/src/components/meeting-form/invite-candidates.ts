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

/**
 * 1.23: the project's clients who may be invited to its meetings (those with its Meetings module),
 * for a site with one company — whose pickers offer the people directory, which has no clients. The
 * same question as above (one answer cached for both); with several companies the clients are among
 * the candidates already, so this is empty. Nothing for a meeting without a project.
 */
export function useClientInvitees(projectId: string | null | undefined, enabled = true): CompanyPersonOption[] {
  const { data, siteCompanyCount } = useMyCompanies();
  const several = !!data && siteCompanyCount >= 2;
  const id = projectId || null;
  const q = useQuery({
    queryKey: ['meeting-invite-candidates', id, null],
    queryFn: () => meetingsApi(apiClient).inviteCandidates({ projectId: id, companyId: null }),
    enabled: enabled && !!data && !several && id !== null,
    staleTime: 60_000,
  });
  if (several || id === null || !Array.isArray(q.data)) return NOBODY;
  return q.data.filter((p) => p.client === true);
}

/**
 * The people a meeting picker offers: the server's candidates (several companies), else the
 * directory's colleagues and — for a project meeting — the project's clients the directory lacks.
 */
export function invitablePeople<T extends { id: string }>(candidates: CompanyPersonOption[] | null, colleagues: T[], clients: CompanyPersonOption[]): (T | CompanyPersonOption)[] {
  if (candidates) return candidates;
  const known = new Set(colleagues.map((c) => c.id));
  return [...colleagues, ...clients.filter((c) => !known.has(c.id))];
}

/** "Client · PDO" for a client (1.23), else "@username" — the hint beside a name in a people picker. */
export function personHint(p: { username?: string; client?: boolean; organisation?: string | null }): string | undefined {
  if (p.client) return p.organisation ? `Client · ${p.organisation}` : 'Client';
  return p.username ? `@${p.username}` : undefined;
}
