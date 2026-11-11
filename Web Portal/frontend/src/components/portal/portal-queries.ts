import { useQuery, type QueryClient } from '@tanstack/react-query';
import type { PortalMeetingView, PortalNotices, PortalTaskView } from '../../api/portal';
import { usePortalApi, usePortalPreview } from './portal-context';

/**
 * 1.23 The Client portal's reads, one cache key each (signing out drops them all). 1.23.7: every read goes
 * through the page's API (usePortalApi): the client's own, or a Preview as client's (with its own cache).
 */
export const portalKeys = {
  all: ['portal'] as const,
  me: ['portal', 'me'] as const,
  project: (p: string) => ['portal', 'project', p] as const,
  task: (p: string, t: string) => ['portal', 'task', p, t] as const,
  meetings: (p: string) => ['portal', 'meetings', p] as const,
  meeting: (p: string, m: string) => ['portal', 'meeting', p, m] as const,
  whereIs: (m: string) => ['portal', 'where', m] as const,
  notices: ['portal', 'notices'] as const,
  settings: ['portal', 'settings'] as const,
  // Help & training (the course and lesson pages keep theirs under ['portal', 'training', …] too).
  training: ['portal', 'training', 'home'] as const,
  trainingSummary: ['portal', 'training', 'summary'] as const,
};

export function usePortalMe() {
  const api = usePortalApi();
  return useQuery({ queryKey: portalKeys.me, queryFn: () => api.me() });
}
export function usePortalProject(p: string) {
  const api = usePortalApi();
  return useQuery({ queryKey: portalKeys.project(p), queryFn: () => api.project(p), enabled: Boolean(p) });
}
/**
 * Owner, 10 Nov 2026: how often an open task is read again, so the team's replies (and files) arrive by themselves.
 * Client accounts have no live connection; the read applies their permissions every time.
 */
export const TASK_EVERY_MS = 5_000;

/**
 * One shared task — while its comments show (the Comment action), read again every few seconds while the tab is shown,
 * and on coming back to it; never in a preview.
 */
export function usePortalTask(p: string, t: string) {
  const api = usePortalApi();
  const preview = usePortalPreview();
  return useQuery({
    queryKey: portalKeys.task(p, t),
    queryFn: () => api.task(p, t),
    enabled: Boolean(p && t),
    refetchInterval: (q) => (!preview && q.state.data?.can?.comment ? TASK_EVERY_MS : false),
    refetchOnWindowFocus: !preview,
  });
}
export function usePortalMeetings(p: string) {
  const api = usePortalApi();
  return useQuery({ queryKey: portalKeys.meetings(p), queryFn: () => api.meetings(p), enabled: Boolean(p) });
}
export function usePortalMeeting(p: string, m: string) {
  const api = usePortalApi();
  return useQuery({ queryKey: portalKeys.meeting(p, m), queryFn: () => api.meeting(p, m), enabled: Boolean(p && m) });
}
export function usePortalWhereIs(m: string) {
  const api = usePortalApi();
  return useQuery({ queryKey: portalKeys.whereIs(m), queryFn: () => api.whereIs(m), enabled: Boolean(m) });
}

/** How often the bell asks again while the portal is open (and on coming back to the window). */
export const NOTICES_EVERY_MS = 60_000;

/** 1.23.7 The bell's notices: read gently — once a minute while the tab is shown, and on coming back to it (not in a preview). */
export function usePortalNotices() {
  const api = usePortalApi();
  const preview = usePortalPreview();
  return useQuery({
    queryKey: portalKeys.notices,
    queryFn: () => api.notices(),
    refetchInterval: preview ? false : NOTICES_EVERY_MS,
    refetchOnWindowFocus: !preview,
  });
}

/** 1.23.7 The client's notification switches. */
export function usePortalSettings() {
  const api = usePortalApi();
  return useQuery({ queryKey: portalKeys.settings, queryFn: () => api.settings() });
}

/** A notice was opened (`id`), or all were (null): the bell and the list show them read, with the server's unread count once known. */
export function noticesRead(qc: QueryClient, id: string | null, unread?: number): void {
  qc.setQueryData<PortalNotices>(portalKeys.notices, (old) => {
    if (!old) return old;
    const items = old.items.map((n) => (id === null || n.id === id ? { ...n, read: true } : n));
    return { items, unread: unread ?? items.filter((n) => !n.read).length };
  });
}

/** A task changed (a comment, accepted, sent back): its page shows the answer; the lists and progress read again. */
export function taskChanged(qc: QueryClient, p: string, t: string, view: PortalTaskView): void {
  // A re-read still on its way (they come every few seconds) would put the older view back over this answer: stopped
  // first (it stops at once, back to what was there), then the answer shows (review).
  void qc.cancelQueries({ queryKey: portalKeys.task(p, t), exact: true });
  qc.setQueryData(portalKeys.task(p, t), view);
  void qc.invalidateQueries({ queryKey: portalKeys.project(p) });
  void qc.invalidateQueries({ queryKey: portalKeys.me });
}

/** A meeting changed (their answer, an action item done): its page shows the answer; the list reads again. */
export function meetingChanged(qc: QueryClient, p: string, view: PortalMeetingView): void {
  qc.setQueryData(portalKeys.meeting(p, view.meeting.id), view);
  void qc.invalidateQueries({ queryKey: portalKeys.meetings(p) });
}

/** Help & training: their training, the catalogue and the tour (the server brings their assignments up to date first). */
export function usePortalTraining() {
  const api = usePortalApi();
  return useQuery({ queryKey: portalKeys.training, queryFn: () => api.training(), staleTime: 60_000 });
}

/** How often the header's Help & training count is read again while the portal is open. */
export const TRAINING_SUMMARY_EVERY_MS = 5 * 60_000;

/** Help & training's counts for the badges (assigned, overdue) and whether the tour shows by itself. */
export function usePortalTrainingSummary() {
  const api = usePortalApi();
  const preview = usePortalPreview();
  return useQuery({
    queryKey: portalKeys.trainingSummary,
    queryFn: () => api.trainingSummary(),
    refetchInterval: preview ? false : TRAINING_SUMMARY_EVERY_MS,
    staleTime: 60_000,
    retry: false,
  });
}
