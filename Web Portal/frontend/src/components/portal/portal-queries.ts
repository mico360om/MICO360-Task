import { useQuery, type QueryClient } from '@tanstack/react-query';
import { portal, type PortalMeetingView, type PortalTaskView } from '../../api/portal';

/** 1.23 The Client portal's reads, one cache key each (signing out drops them all). */
export const portalKeys = {
  all: ['portal'] as const,
  me: ['portal', 'me'] as const,
  project: (p: string) => ['portal', 'project', p] as const,
  task: (p: string, t: string) => ['portal', 'task', p, t] as const,
  meetings: (p: string) => ['portal', 'meetings', p] as const,
  meeting: (p: string, m: string) => ['portal', 'meeting', p, m] as const,
  whereIs: (m: string) => ['portal', 'where', m] as const,
};

export const usePortalMe = () => useQuery({ queryKey: portalKeys.me, queryFn: () => portal.me() });
export const usePortalProject = (p: string) => useQuery({ queryKey: portalKeys.project(p), queryFn: () => portal.project(p), enabled: Boolean(p) });
export const usePortalTask = (p: string, t: string) => useQuery({ queryKey: portalKeys.task(p, t), queryFn: () => portal.task(p, t), enabled: Boolean(p && t) });
export const usePortalMeetings = (p: string) => useQuery({ queryKey: portalKeys.meetings(p), queryFn: () => portal.meetings(p), enabled: Boolean(p) });
export const usePortalMeeting = (p: string, m: string) => useQuery({ queryKey: portalKeys.meeting(p, m), queryFn: () => portal.meeting(p, m), enabled: Boolean(p && m) });

/** A task changed (a comment, accepted, sent back): its page shows the answer; the lists and progress read again. */
export function taskChanged(qc: QueryClient, p: string, t: string, view: PortalTaskView): void {
  qc.setQueryData(portalKeys.task(p, t), view);
  void qc.invalidateQueries({ queryKey: portalKeys.project(p) });
  void qc.invalidateQueries({ queryKey: portalKeys.me });
}

/** A meeting changed (their answer, an action item done): its page shows the answer; the list reads again. */
export function meetingChanged(qc: QueryClient, p: string, view: PortalMeetingView): void {
  qc.setQueryData(portalKeys.meeting(p, view.meeting.id), view);
  void qc.invalidateQueries({ queryKey: portalKeys.meetings(p) });
}
