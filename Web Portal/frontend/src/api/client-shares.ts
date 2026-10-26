import type { ApiClient } from '../lib/api-client';
import type { ApiTask } from './tasks';
import type { FinalMinutesContent } from './meetings';

/** A client a project is shared with (the Share with client panel). */
export interface ClientShare {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  linkSentAt: string | null;
  lastViewedAt: string | null;
}

/** Whether a meeting's approved minutes are shown to the project's client, and who may change it. */
export interface MinutesClientVisibility {
  /** It belongs to a project (a standalone meeting has no client page). */
  projectMeeting: boolean;
  approved: boolean;
  clientVisible: boolean;
  /** Shown with their Risks & open issues (they stay internal otherwise). */
  includeRisks?: boolean;
  /** The person asking runs the project (or is an admin). */
  canChange: boolean;
}

/** Exactly what the client would see of approved minutes (owners off the next steps), and the names to highlight. */
export interface MinutesClientPreview {
  content: FinalMinutesContent;
  names: string[];
}

const seg = encodeURIComponent;

/** Sharing a project with a client, and marking its items "Show to client" (its runners and admins). */
export function clientSharesApi(client: ApiClient) {
  return {
    list: (projectId: string) => client.get<{ data: ClientShare[] }>(`/projects/${seg(projectId)}/client-shares`).then((r) => r.data),
    add: (projectId: string, input: { name: string; email: string }) =>
      client.post<{ data: ClientShare }>(`/projects/${seg(projectId)}/client-shares`, input).then((r) => r.data),
    resend: (projectId: string, shareId: string) =>
      client.post<{ data: ClientShare }>(`/projects/${seg(projectId)}/client-shares/${seg(shareId)}/resend`, {}).then((r) => r.data),
    remove: (projectId: string, shareId: string) => client.del<void>(`/projects/${seg(projectId)}/client-shares/${seg(shareId)}`),
    setTaskVisible: (taskId: string, visible: boolean) => client.put<{ data: ApiTask }>(`/tasks/${seg(taskId)}/client-visible`, { visible }).then((r) => r.data),
    minutesVisibility: (meetingId: string) => client.get<{ data: MinutesClientVisibility }>(`/meetings/${seg(meetingId)}/client-visibility`).then((r) => r.data),
    minutesPreview: (meetingId: string) => client.get<{ data: MinutesClientPreview }>(`/meetings/${seg(meetingId)}/client-visibility/preview`).then((r) => r.data),
    setMinutesVisible: (meetingId: string, visible: boolean, includeRisks?: boolean) =>
      client
        .put<{ data: MinutesClientVisibility }>(`/meetings/${seg(meetingId)}/client-visibility`, visible ? { visible, includeRisks: includeRisks === true } : { visible })
        .then((r) => r.data),
  };
}
