import type { ApiClient } from '../lib/api-client';

/**
 * Companies. `GET /me/companies` is the signed-in person's own companies (the company picker);
 * everything else is the administrators' Companies page. Types follow the server
 * (Web Portal/backend/src/modules/companies/company-service.ts). Every company uses the site's time
 * zone (owner, 31 Oct): there is no time zone to set.
 */

/** The day a company's week starts on: 0 Sunday, 1 Monday, 6 Saturday. */
export type CompanyWeekStart = 0 | 1 | 6;

export interface CompanyWorkingHours {
  /** 0 Sunday … 6 Saturday. */
  days: number[];
  /** "08:00" */
  start: string;
  end: string;
}

/** One of my companies, with the site's values filled in where the company has none of its own. */
export interface MyCompany {
  id: string;
  name: string;
  code: string;
  logoUrl: string | null;
  /** The site's time zone (every company uses it). */
  timeZone: string;
  weekStart: CompanyWeekStart;
  workingHours: CompanyWorkingHours;
}

export interface MyCompanies {
  /** My active companies (administrators: every active company), A–Z. */
  companies: MyCompany[];
  primaryCompanyId: string | null;
  /** Not an administrator and no active company: the site shows "Your company is archived — ask an administrator." */
  allArchived: boolean;
  /** Active companies on the site. */
  siteCompanyCount: number;
}

export type CompanyStatus = 'ACTIVE' | 'ARCHIVED';

/** A company as the Companies page shows it. Null settings mean "the site's" (`effective` has the values used). */
export interface ApiCompany {
  id: string;
  name: string;
  code: string;
  logoUrl: string | null;
  /** Always null: companies use the site's time zone (`effective.timeZone`). */
  timeZone: string | null;
  weekStart: CompanyWeekStart | null;
  workingHours: CompanyWorkingHours | null;
  senderName: string | null;
  status: CompanyStatus;
  archivedAt: string | null;
  createdAt: string;
  counts: { people: number; projects: number };
  effective: { timeZone: string; weekStart: CompanyWeekStart; workingHours: CompanyWorkingHours; senderName: string };
}

/** A company's details as typed on the Companies page (null = the site's value). No time zone. */
export interface CompanyInput {
  name: string;
  code: string;
  weekStart?: CompanyWeekStart | null;
  workingHours?: CompanyWorkingHours | null;
  senderName?: string | null;
}

/** One of a company's people (not deleted), A–Z. */
export interface CompanyPerson {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  /** It is their primary company (their emails' logo and name). */
  isPrimary: boolean;
}

/** One of a company's projects, A–Z. */
export interface CompanyProject {
  id: string;
  code: string;
  name: string;
  /** It is the project's main company. */
  isMain: boolean;
  /** Its own status is archived, or all of its companies are. */
  archived: boolean;
}

/** People put in (or taken out of) a company, and those who couldn't be, with why. */
export interface CompanyPeopleChange {
  changed: number;
  refused: { userId: string; name: string; reason: string }[];
}

/** Someone who can be picked (a project's team, a meeting's people). */
export interface CompanyPersonOption {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  avatarUrl: string | null;
}

/** The query key of `GET /me/companies`: kept when the pick changes (the picker reads it). */
export const MY_COMPANIES_KEY = ['me', 'companies'] as const;

export function companiesApi(client: ApiClient) {
  const one = (id: string) => `/companies/${encodeURIComponent(id)}`;
  return {
    mine: () => client.get<{ data: MyCompanies }>('/me/companies').then((r) => r.data),
    list: () => client.get<{ data: ApiCompany[] }>('/companies').then((r) => r.data),
    get: (id: string) => client.get<{ data: ApiCompany }>(one(id)).then((r) => r.data),
    create: (input: CompanyInput) => client.post<{ data: ApiCompany }>('/companies', input).then((r) => r.data),
    update: (id: string, patch: Partial<CompanyInput>) => client.put<{ data: ApiCompany }>(one(id), patch).then((r) => r.data),
    /** A PNG, JPEG or WebP picture up to 2 MB; the server keeps it at most 512 px wide. */
    uploadLogo: (id: string, file: File | Blob) => {
      const form = new FormData();
      form.append('file', file);
      return client.upload<{ data: ApiCompany }>(`${one(id)}/logo`, form).then((r) => r.data);
    },
    removeLogo: (id: string) => client.del<{ data: ApiCompany }>(`${one(id)}/logo`).then((r) => r.data),
    archive: (id: string) => client.post<{ data: ApiCompany }>(`${one(id)}/archive`).then((r) => r.data),
    unarchive: (id: string) => client.post<{ data: ApiCompany }>(`${one(id)}/unarchive`).then((r) => r.data),
    people: (id: string) => client.get<{ data: CompanyPerson[] }>(`${one(id)}/people`).then((r) => r.data),
    addPeople: (id: string, userIds: string[]) => client.post<{ data: CompanyPeopleChange }>(`${one(id)}/people`, { userIds }).then((r) => r.data),
    /** Refused (409 LAST_COMPANY, with the rule's words) when they must keep this company. */
    removePerson: (id: string, userId: string) => client.del(`${one(id)}/people/${encodeURIComponent(userId)}`).then(() => undefined),
    projects: (id: string) => client.get<{ data: CompanyProject[] }>(`${one(id)}/projects`).then((r) => r.data),
    /** Who may be on the team of a project in these companies (each must be one of mine; administrators: any). */
    candidates: (companyIds: string[]) =>
      client.get<{ data: CompanyPersonOption[] }>(`/people/candidates?companyIds=${companyIds.map(encodeURIComponent).join(',')}`).then((r) => r.data),
    /** Who may join this project's team: the people of ANY of its companies (for those who may run its team). */
    projectCandidates: (projectId: string) =>
      client.get<{ data: CompanyPersonOption[] }>(`/people/candidates?projectId=${encodeURIComponent(projectId)}`).then((r) => r.data),
  };
}
