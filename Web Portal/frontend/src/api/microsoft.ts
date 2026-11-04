import type { ApiClient } from '../lib/api-client';

/** Settings → Microsoft Teams: the signed-in person's own Microsoft connection (1.23). */
export interface MicrosoftStatus {
  /** Teams links are set up on this server. */
  available: boolean;
  connected: boolean;
  /** The Microsoft account ("Connected as …"). */
  email: string | null;
  name: string | null;
  connectedAt: string | null;
  /** Why the connection stopped working (connect again), else null. */
  problem: string | null;
}

/** Why a Teams link wasn't made (the meeting itself is always saved). */
export interface TeamsNotice {
  code: 'TEAMS_FAILED' | 'TEAMS_NOT_CONNECTED' | 'TEAMS_NOT_ORGANIZER' | 'TEAMS_UNAVAILABLE';
  message: string;
}

export interface TeamsLinkResult {
  made: boolean;
  teamsNotice: TeamsNotice | null;
  onlineLink: string | null;
  onlineMeetingProvider: 'TEAMS' | null;
  teamsLinkPending: boolean;
}

export function microsoftApi(client: ApiClient) {
  return {
    status: () => client.get<{ data: MicrosoftStatus }>('/integrations/microsoft').then((r) => r.data),
    /** The address on this server that sends the browser to Microsoft's sign-in (single use, 2 minutes). */
    connect: () => client.post<{ data: { url: string } }>('/integrations/microsoft/connect').then((r) => r.data.url),
    disconnect: () => client.del('/integrations/microsoft'),
    /** Make Teams link: a meeting waiting for its link. */
    makeTeamsLink: (meetingId: string) => client.post<{ data: TeamsLinkResult }>(`/meetings/${encodeURIComponent(meetingId)}/teams-link`).then((r) => r.data),
  };
}
