import { ApiError, type ApiClient } from '../lib/api-client';
import { apiClient } from './client';
import type { FinalMinutesContent } from './meetings';
import type { ClientGrant } from './clients';

/**
 * 1.23 The Client portal's API (server: backend/src/modules/clients/portal-routes.ts and
 * portal-payload.ts for every shape). A client session may call only these routes and its own
 * password change — every staff route answers 403 CLIENT_NOT_ALLOWED — so nothing the portal shows
 * uses any other API module.
 */

export interface PortalModules {
  progress: boolean;
  meetings: boolean;
}

export interface PortalActions {
  comment: boolean;
  signOff: boolean;
  respond: boolean;
  download: boolean;
  /** 1.23.7: upload documents to shared tasks. */
  upload?: boolean;
  /** 1.23.7: notices about this project reach them. */
  notify?: boolean;
}

export interface PortalCompany {
  name: string;
  /** An /uploads/… path, or null (the built-in logo). */
  logoUrl: string | null;
}

export interface PortalProjectLook {
  id: string;
  code: string;
  number: string | null;
  name: string;
  status: string;
  statusLabel: string;
  color: string;
  icon: string | null;
  imageUrl: string | null;
  company: PortalCompany | null;
}

export interface PortalProjectCard extends PortalProjectLook {
  /** Null without the Progress module (the card shows no figure). */
  percentDone: number | null;
  modules: PortalModules;
  actions: PortalActions;
}

export interface PortalHome {
  me: { name: string; email: string; organisation: string | null };
  projects: PortalProjectCard[];
  timeZone: string;
}

export type PortalTaskStatus = 'Not started' | 'In progress' | 'In review' | 'On hold' | 'Done';

export interface PortalTaskItem {
  id: string;
  /** The task number (MICO-142). */
  key: string;
  title: string;
  status: PortalTaskStatus;
  /** 'YYYY-MM-DD'. */
  dueDate: string | null;
  late: boolean;
  /** 'YYYY-MM-DD' (company time) when the client accepted this finish. */
  acceptedOn: string | null;
  /** Done and not accepted yet: Accept / Send back are offered (with the Sign off action). */
  awaitingSignOff: boolean;
  hasDescription: boolean;
}

export interface PortalProjectView {
  project: PortalProjectLook & { clientName: string | null };
  modules: PortalModules;
  actions: PortalActions;
  /** The Progress module (null without it). */
  progress: {
    percentDone: number;
    timeline: { startDate: string | null; targetDate: string | null; today: string; elapsedPercent: number | null };
    milestones: PortalTaskItem[];
    tasks: PortalTaskItem[];
  } | null;
  generatedAt: string;
  timeZone: string;
}

export interface PortalComment {
  id: string;
  /** 'you': the client's own; 'team': a reply marked "Visible to client" (shown as "Project team"). */
  from: 'you' | 'team';
  /** For a team reply: the client comment it answers. */
  replyTo: string | null;
  body: string;
  createdAt: string;
  edited: boolean;
}

/** 1.23.7 A file on a shared task: shown to clients by the team, or the client's own upload. */
export interface PortalFile {
  id: string;
  name: string;
  /** Its type ('application/pdf'). */
  type: string;
  sizeBytes: number;
  addedAt: string;
  /** 'you': their own upload; 'team': shared by the project team (never a name). */
  from: 'you' | 'team';
}

export interface PortalTaskView {
  task: PortalTaskItem & { description: string | null };
  /** Null without the Comment action: no thread is shown. */
  comments: PortalComment[] | null;
  /** 1.23.7 (an older server sends none). */
  files?: PortalFile[];
  can: { comment: boolean; signOff: boolean; upload?: boolean };
}

/** 1.23.7 One notice on the portal's bell. */
export interface PortalNotice {
  id: string;
  kind: 'reply' | 'signOff' | 'document' | 'minutes' | 'invitation';
  title: string;
  /** A file's name for a document; null otherwise. */
  body: string | null;
  project: { id: string; name: string };
  taskId: string | null;
  meetingId: string | null;
  read: boolean;
  createdAt: string;
}

export interface PortalNotices {
  items: PortalNotice[];
  unread: number;
}

/** 1.23.7 The kinds of notice a client may switch off (meeting invitations always go). */
export interface PortalNoticeSwitches {
  reply: boolean;
  signOff: boolean;
  minutes: boolean;
  document: boolean;
}

export interface PortalNoticeSettings {
  settings: PortalNoticeSwitches;
  /** Their projects, and whether the project team lets notices about each reach them. */
  projects: { id: string; name: string; notify: boolean }[];
}

export type PortalResponse = 'PENDING' | 'ACCEPTED' | 'TENTATIVE' | 'DECLINED';

export interface PortalMeetingItem {
  id: string;
  title: string;
  /** Its day ('YYYY-MM-DD', in its own time zone). */
  date: string;
  startAt: string;
  endAt: string | null;
  timeZone: string;
  status: string;
  cancelled: boolean;
  invited: boolean;
  /** Their answer (null when not invited). */
  response: PortalResponse | null;
  hasMinutes: boolean;
}

export interface PortalActionItem {
  id: string;
  description: string;
  dueDate: string | null;
  done: boolean;
  cancelled: boolean;
}

export interface PortalMeetingView {
  meeting: PortalMeetingItem & { location: string | null; onlineLink: string | null; description: string | null };
  /** The agenda's topics (invited only). */
  agenda: { title: string; minutes: number | null }[];
  minutes: { approvedOn: string | null; content: FinalMinutesContent } | null;
  actionItems: PortalActionItem[];
  can: { respond: boolean; markDone: boolean; downloadMinutes: boolean };
}

type Data<T> = { data: T };
const seg = encodeURIComponent;

export function portalApi(client: ApiClient) {
  const project = (p: string) => `/portal/projects/${seg(p)}`;
  const task = (p: string, t: string) => `${project(p)}/tasks/${seg(t)}`;
  const meeting = (p: string, m: string) => `${project(p)}/meetings/${seg(m)}`;
  return {
    me: () => client.get<Data<PortalHome>>('/portal/me').then((r) => r.data),
    project: (p: string) => client.get<Data<PortalProjectView>>(project(p)).then((r) => r.data),
    task: (p: string, t: string) => client.get<Data<PortalTaskView>>(task(p, t)).then((r) => r.data),
    comment: (p: string, t: string, body: string) => client.post<Data<PortalTaskView>>(`${task(p, t)}/comments`, { body }).then((r) => r.data),
    accept: (p: string, t: string) => client.post<Data<PortalTaskView>>(`${task(p, t)}/accept`).then((r) => r.data),
    sendBack: (p: string, t: string, reason: string) => client.post<Data<PortalTaskView>>(`${task(p, t)}/send-back`, { reason }).then((r) => r.data),
    /** The project's client task list (Progress + Download); a File named by the server. */
    taskListPdf: (p: string) => client.getBlob(`${project(p)}/tasks.pdf`),
    meetings: (p: string) => client.get<Data<PortalMeetingItem[]>>(`${project(p)}/meetings`).then((r) => r.data),
    meeting: (p: string, m: string) => client.get<Data<PortalMeetingView>>(meeting(p, m)).then((r) => r.data),
    respond: (p: string, m: string, response: Exclude<PortalResponse, 'PENDING'>) =>
      client.post<Data<PortalMeetingView>>(`${meeting(p, m)}/response`, { response }).then((r) => r.data),
    /** The approved minutes' client copy (Download); a File named by the server. */
    minutesPdf: (p: string, m: string) => client.getBlob(`${meeting(p, m)}/minutes.pdf`),
    markDone: (p: string, itemId: string) => client.post<Data<PortalMeetingView>>(`${project(p)}/action-items/${seg(itemId)}/done`).then((r) => r.data),
    /** Where an invitation email's meeting is in the portal. */
    whereIs: (m: string) => client.get<Data<{ projectId: string; meetingId: string }>>(`/portal/meetings/${seg(m)}`).then((r) => r.data),
    /** 1.23.7 Upload a document to a shared task (Upload); the task as it is now. */
    upload: (p: string, t: string, file: File, onProgress?: (fraction: number) => void) => {
      const form = new FormData();
      form.append('file', file, file.name);
      return client.upload<Data<PortalTaskView>>(`${task(p, t)}/files`, form, onProgress ? { onProgress } : undefined).then((r) => r.data);
    },
    /** 1.23.7 A file of a shared task; a File named by the server. */
    file: (p: string, t: string, fileId: string) => client.getBlob(`${task(p, t)}/files/${seg(fileId)}`),
    /** 1.23.7 The bell. */
    notices: () => client.get<Data<PortalNotices>>('/portal/notifications').then((r) => r.data),
    readNotice: (id: string) => client.post<Data<{ unread: number }>>(`/portal/notifications/${seg(id)}/read`).then((r) => r.data),
    readAllNotices: () => client.post<Data<{ unread: number }>>('/portal/notifications/read-all').then((r) => r.data),
    /** 1.23.7 The client's notification switches. */
    settings: () => client.get<Data<PortalNoticeSettings>>('/portal/settings/notifications').then((r) => r.data),
    setSettings: (patch: Partial<PortalNoticeSwitches>) => client.put<Data<PortalNoticeSettings>>('/portal/settings/notifications', patch).then((r) => r.data),
    /** The client's own password: the server signs out every other session and returns this one's fresh pair. */
    changePassword: (currentPassword: string, newPassword: string) =>
      client
        .post<{ data?: { accessToken?: string; refreshToken?: string } } | undefined>('/users/me/password', { currentPassword, newPassword })
        .then((r) => r?.data ?? null),
  };
}

export type PortalApi = ReturnType<typeof portalApi>;

/** The portal's API on the site's client (bearer token, silent refresh). */
export const portal: PortalApi = portalApi(apiClient);

/**
 * 1.23.7 Preview as client: whose portal (a saved client, or one not saved yet) and the permission matrix on
 * screen (absent: their saved access). Server: POST /clients/preview/… (administrators; nothing is written).
 */
export interface ClientPreviewSpec {
  clientId?: string | null;
  firstName?: string;
  lastName?: string;
  organisation?: string | null;
  email?: string;
  projects?: ClientGrant[];
}

/** The words a preview answers any action with (nothing is saved or sent). */
export const PREVIEW_ONLY = 'Preview — nothing you do here is saved or sent.';

/**
 * The portal's API for a preview: the same reads, through the administrators' preview routes with the spec;
 * every write is refused here, before anything leaves the page.
 */
export function previewPortalApi(client: ApiClient, spec: ClientPreviewSpec): PortalApi {
  const read = <T>(path: string) => client.post<Data<T>>(`/clients/preview${path}`, spec).then((r) => r.data);
  const refuse = (): Promise<never> => Promise.reject(new ApiError(403, 'PREVIEW', PREVIEW_ONLY));
  const project = (p: string) => `/projects/${seg(p)}`;
  return {
    me: () => read<PortalHome>('/me'),
    project: (p) => read<PortalProjectView>(project(p)),
    task: (p, t) => read<PortalTaskView>(`${project(p)}/tasks/${seg(t)}`),
    meetings: (p) => read<PortalMeetingItem[]>(`${project(p)}/meetings`),
    meeting: (p, m) => read<PortalMeetingView>(`${project(p)}/meetings/${seg(m)}`),
    notices: () => read<PortalNotices>('/notifications'),
    settings: () => read<PortalNoticeSettings>('/settings'),
    comment: refuse,
    accept: refuse,
    sendBack: refuse,
    taskListPdf: refuse,
    respond: refuse,
    minutesPdf: refuse,
    markDone: refuse,
    whereIs: refuse,
    changePassword: refuse,
    upload: refuse,
    file: refuse,
    readNotice: refuse,
    readAllNotices: refuse,
    setSettings: refuse,
  };
}

/** The server's word for anything a client may not see (404). */
export const NOT_SHARED = 'This isn’t shared with you.';
const NOT_ALLOWED = 'You can’t do that on this project. Ask the project team if you need to.';

const ownWords = (e: ApiError) => (e.message && !/^Request failed/.test(e.message) ? e.message : null);

/** What to tell a client when a request failed: in plain words, never a code. */
export function portalProblem(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.status === 404) return NOT_SHARED;
    if (err.status === 403) return ownWords(err) ?? NOT_ALLOWED;
    if (err.status === 429) return 'Too many downloads at once. Wait a minute and try again.';
    if (err.status === 400 || err.status === 409) return ownWords(err) ?? fallback;
  }
  return `${fallback} Check your connection and try again.`;
}

/** Is this the server saying "not shared with you" (gone, never shared, or the access was taken away)? */
export const isNotShared = (err: unknown) => err instanceof ApiError && err.status === 404;
