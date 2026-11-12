import type { ApiClient } from '../lib/api-client';
import type { GuestDraft, GuestFields } from '../lib/guest-contacts';

/**
 * 1.24 Guests: each company's reusable list of people outside it, named on tasks for the record only (they
 * never sign in or get emails). A task uses its project's main company's list.
 */
export interface ApiGuest extends GuestFields {
  id: string;
  companyId: string;
  /** Admins' notes (and details found on other copies when today's contacts became guests). */
  notes: string | null;
  /** Retired: hidden from picking, kept on its tasks. */
  retiredAt: string | null;
  mergedIntoId: string | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A guest on the admin page: with the company's name and how many tasks they are on (Recycle Bin ones too). */
export interface ApiAdminGuest extends ApiGuest {
  companyName: string;
  taskCount: number;
}

/** One of a task's guests: the guest's details and this task's note for them. */
export interface ApiTaskGuest extends GuestFields {
  /** The task's row for the guest (an old external-contact id). */
  linkId: string;
  guestId: string;
  taskId: string;
  note: string | null;
  position: number;
  addedById: string | null;
  addedAt: string;
  /** Retired from the list (still on this task). */
  retired: boolean;
}

/** The New guest form's check: `same` is the same person ("… is already on the list — use them?"), `similar` share the name. */
export interface GuestDuplicates {
  same: ApiGuest[];
  similar: ApiGuest[];
}

export function guestsApi(client: ApiClient) {
  return {
    /** The project's company list for picking: active guests by name, company, email or phone (at most 50, A to Z). */
    forProject: (projectId: string, q = '') =>
      client.get<{ data: ApiGuest[] }>(`/projects/${projectId}/guests${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`).then((r) => r.data),
    /** The duplicate check while a new guest is typed. */
    check: (projectId: string, draft: GuestDraft) => client.post<{ data: GuestDuplicates }>(`/projects/${projectId}/guests/check`, draft).then((r) => r.data),
    /**
     * Add a guest to the project's company list. 409 GUEST_DUPLICATE (details.matches) when the same person is
     * already there — send `confirmNew: true` to add them anyway.
     */
    create: (projectId: string, draft: GuestDraft & { confirmNew?: boolean }) => client.post<{ data: ApiGuest }>(`/projects/${projectId}/guests`, draft).then((r) => r.data),
    /** A task's guests in full. */
    ofTask: (taskId: string) => client.get<{ data: ApiTaskGuest[] }>(`/tasks/${taskId}/guests`).then((r) => r.data),
    /** Put a guest on a task (400 when it has no team member; 409 when already on it). */
    addToTask: (taskId: string, guestId: string, note?: string | null) =>
      client.post<{ data: ApiTaskGuest }>(`/tasks/${taskId}/guests`, { guestId, ...(note !== undefined ? { note } : {}) }).then((r) => r.data),
    setNote: (taskId: string, guestId: string, note: string | null) => client.patch<{ data: ApiTaskGuest }>(`/tasks/${taskId}/guests/${guestId}`, { note }).then((r) => r.data),
    removeFromTask: (taskId: string, guestId: string) => client.del<void>(`/tasks/${taskId}/guests/${guestId}`),
    // ---- admins: Guest contacts ----
    adminList: (opts: { companyId?: string; q?: string; status?: 'active' | 'retired' | 'all' } = {}) => {
      const qs = new URLSearchParams();
      if (opts.companyId) qs.set('companyId', opts.companyId);
      if (opts.q?.trim()) qs.set('q', opts.q.trim());
      if (opts.status) qs.set('status', opts.status);
      const suffix = qs.toString();
      return client.get<{ data: ApiAdminGuest[] }>(`/guests${suffix ? `?${suffix}` : ''}`).then((r) => r.data);
    },
    adminUpdate: (guestId: string, draft: GuestDraft & { notes?: string | null }) => client.put<{ data: ApiGuest }>(`/guests/${guestId}`, draft).then((r) => r.data),
    retire: (guestId: string) => client.post<{ data: ApiGuest }>(`/guests/${guestId}/retire`, {}).then((r) => r.data),
    unretire: (guestId: string) => client.post<{ data: ApiGuest }>(`/guests/${guestId}/unretire`, {}).then((r) => r.data),
    /** Merge duplicates into the kept guest: every task link moves to it. */
    merge: (keepId: string, mergeIds: string[]) => client.post<{ data: { guest: ApiGuest; tasks: number } }>('/guests/merge', { keepId, mergeIds }).then((r) => r.data),
    /** Remove from the list — refused (409 GUEST_IN_USE) while on any task. */
    remove: (guestId: string) => client.del<void>(`/guests/${guestId}`),
  };
}

export type GuestsApi = ReturnType<typeof guestsApi>;
