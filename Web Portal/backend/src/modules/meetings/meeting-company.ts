import { ValidationError } from '../../lib/http-errors';
import { COMPANY_WORDS } from '../companies/company-rules';
import type { Viewer } from '../companies/company-access';

/**
 * Companies: a meeting without a project belongs to a company (MC1 Ruling 11); a project meeting's
 * company is its project's, so it keeps none of its own (null).
 *
 * The company a new standalone meeting gets: the one named — which must be one of the person's active
 * companies (admins: any company), else 403 COMPANY_NOT_AVAILABLE — else the picked company, else the
 * organizer's primary company, else the site's only active company; failing those, 400 "Pick the
 * company this meeting belongs to.".
 */
export interface MeetingCompanyRule {
  forNew(viewer: Viewer, meeting: { projectId?: string | null; companyId?: string | null; organizerId: string }, pick: string | null): Promise<string | null>;
  /** The company after a change: undefined leaves it as it is. */
  forChange(
    viewer: Viewer,
    before: { projectId: string | null; companyId?: string | null; organizerId: string },
    patch: { projectId?: string | null; companyId?: string | null; organizerId?: string },
    pick: string | null,
  ): Promise<string | null | undefined>;
}

export interface MeetingCompanyDeps {
  /** The company if this person may use it (their active company; admins any), else CompanyNotAvailableError. */
  checkPick: (viewer: Viewer, companyId: string) => Promise<string | null>;
  /** The organizer's primary company (active and theirs), else the site's only active company, else null. */
  fallbackCompanyId: (organizerId: string) => Promise<string | null>;
}

export function createMeetingCompanyRule(deps: MeetingCompanyDeps): MeetingCompanyRule {
  async function byDefault(organizerId: string, pick: string | null): Promise<string> {
    const company = pick ?? (await deps.fallbackCompanyId(organizerId));
    if (!company) throw new ValidationError(COMPANY_WORDS.meetingCompany, { field: 'companyId' });
    return company;
  }

  return {
    async forNew(viewer, meeting, pick) {
      if (meeting.projectId) return null;
      if (meeting.companyId) return deps.checkPick(viewer, meeting.companyId);
      return byDefault(meeting.organizerId, pick);
    },

    async forChange(viewer, before, patch, pick) {
      const projectId = patch.projectId !== undefined ? patch.projectId : before.projectId;
      if (projectId) return before.companyId ? null : undefined;
      const current = before.projectId ? null : (before.companyId ?? null);
      // Sending the company it already has (a whole form saved) changes nothing and asks nothing.
      if (patch.companyId && patch.companyId === current) return undefined;
      if (patch.companyId) return deps.checkPick(viewer, patch.companyId);
      if (patch.companyId === undefined && current) return undefined;
      return byDefault(patch.organizerId ?? before.organizerId, pick);
    },
  };
}
