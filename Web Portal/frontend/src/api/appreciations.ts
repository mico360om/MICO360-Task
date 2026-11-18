import type { ApiClient } from '../lib/api-client';
import type { AppreciationAnimation, AppreciationIcon, AppreciationStatus, AppreciationTheme } from '../lib/appreciation';

/**
 * Employee Appreciation (1.24.0): the person's own appreciations (Dashboard theme, banner, popup, My appreciations)
 * and the Appreciations page (administrators and Appreciation managers — the server decides).
 */
export interface ApiAppreciation {
  id: string;
  batchId: string;
  title: string;
  /** The message with {name}, {company} and {date} filled in. */
  message: string;
  theme: AppreciationTheme;
  icon: AppreciationIcon;
  animation: AppreciationAnimation;
  day: string;
  startsAt: string;
  endsAt: string;
  status: AppreciationStatus;
  acceptedAt: string | null;
  /** 1.24.1: the note for the manager left with the accept (the person, the sender and managers in scope see it). */
  acceptNote: string | null;
  popupClosedAt: string | null;
  sender: { id: string; name: string };
  company: { name: string; logoUrl: string | null };
}

export interface ApiAppreciationsMe {
  canManage: boolean;
  /** Today (company time zone), 'YYYY-MM-DD'. */
  today: string;
  serverNow: string;
  /** Today's, newest first (accepted ones too: the theme stays all day). */
  live: ApiAppreciation[];
}

export interface ApiManagedAppreciation extends ApiAppreciation {
  recipient: { id: string; name: string };
  companyId: string | null;
  templateId: string | null;
  templateName: string | null;
  createdAt: string;
  cancelledAt: string | null;
  rawMessage: string;
}

export interface AppreciationContent {
  title: string;
  message: string;
  theme: AppreciationTheme;
  icon: AppreciationIcon;
  animation: AppreciationAnimation;
}

export interface ApiAppreciationTemplate extends AppreciationContent {
  id: string;
  name: string;
  builtIn: boolean;
  archived: boolean;
  updatedAt: string;
}

export interface ApiAppreciationPerson {
  id: string;
  name: string;
  avatarUrl: string | null;
  companies: { id: string; name: string }[];
}

export interface AppreciationFilters {
  /** 1.24.1: one record (the sender's bell notice opens it). */
  id?: string;
  personId?: string;
  status?: AppreciationStatus | '';
  templateId?: string;
  from?: string;
  to?: string;
  page?: number;
}

const query = (f: Record<string, string | number | undefined | null>) => {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== '' && v !== null) qs.set(k, String(v));
  const s = qs.toString();
  return s ? `?${s}` : '';
};

export const APPRECIATIONS_ME_KEY = ['appreciations', 'me'] as const;

export function appreciationsApi(client: ApiClient) {
  return {
    me: () => client.get<{ data: ApiAppreciationsMe }>('/appreciations/me').then((r) => r.data),
    history: () => client.get<{ data: ApiAppreciation[] }>('/appreciations/me/history').then((r) => r.data),
    /** 1.24.1: with an optional note for the manager (never changed after; noteSaved false when it was already accepted). */
    accept: (id: string, note: string | null = null) =>
      client.post<{ data: { acceptedAt: string; already: boolean; noteSaved?: boolean } }>(`/appreciations/me/${encodeURIComponent(id)}/accept`, note ? { note } : {}).then((r) => r.data),
    closePopup: (id: string) => client.post<{ data: { popupClosedAt: string } }>(`/appreciations/me/${encodeURIComponent(id)}/close`, {}).then((r) => r.data),
    // ---- managing ----
    templates: (archived = false) => client.get<{ data: ApiAppreciationTemplate[] }>(`/appreciations/manage/templates${archived ? '?archived=1' : ''}`).then((r) => r.data),
    createTemplate: (t: AppreciationContent & { name: string }) => client.post<{ data: ApiAppreciationTemplate }>('/appreciations/manage/templates', t).then((r) => r.data),
    updateTemplate: (id: string, t: Partial<AppreciationContent & { name: string }>) => client.put<{ data: ApiAppreciationTemplate }>(`/appreciations/manage/templates/${id}`, t).then((r) => r.data),
    copyTemplate: (id: string) => client.post<{ data: ApiAppreciationTemplate }>(`/appreciations/manage/templates/${id}/copy`, {}).then((r) => r.data),
    archiveTemplate: (id: string, archived: boolean) => client.post<{ data: ApiAppreciationTemplate }>(`/appreciations/manage/templates/${id}/${archived ? 'archive' : 'unarchive'}`, {}).then((r) => r.data),
    companies: () => client.get<{ data: { id: string; name: string }[] }>('/appreciations/manage/companies').then((r) => r.data),
    people: (search = '', companyId = '') => client.get<{ data: ApiAppreciationPerson[] }>(`/appreciations/manage/people${query({ search: search.trim(), companyId })}`).then((r) => r.data),
    schedule: (input: AppreciationContent & { recipientIds: string[]; templateId: string | null; day: string }) =>
      client.post<{ data: { batchId: string; ids: string[] } }>('/appreciations/manage', input).then((r) => r.data),
    list: (f: AppreciationFilters = {}) =>
      client.get<{ data: { total: number; page: number; pageSize: number; rows: ApiManagedAppreciation[] } }>(`/appreciations/manage${query({ ...f })}`).then((r) => r.data),
    exportFile: (f: AppreciationFilters = {}) => client.getBlob(`/appreciations/manage/export.xlsx${query({ ...f, page: undefined })}`),
    update: (id: string, patch: Partial<AppreciationContent & { day: string }>) => client.patch<{ data: ApiManagedAppreciation }>(`/appreciations/manage/${id}`, patch).then((r) => r.data),
    cancel: (id: string) => client.post<{ data: ApiManagedAppreciation }>(`/appreciations/manage/${id}/cancel`, {}).then((r) => r.data),
  };
}
