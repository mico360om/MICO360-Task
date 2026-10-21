import type { ApiClient } from './api-client';
import { idempotencyHeaders } from './idempotency';
import type { ApiAttachment } from './attachments';
import type { NotificationPreferences } from './notification-prefs';
import type { DatePreferences, ServerConfig } from './date-settings';
import type {
  ApiAssignee,
  ApiChatMessage,
  ApiChecklist,
  ApiChecklistItem,
  ApiColumn,
  ApiComment,
  ApiConversation,
  ApiConversationSummary,
  ApiDirectoryUser,
  ApiMember,
  ApiMentionable,
  ApiActivityEntry,
  ApiDependencyView,
  ApiWatcher,
  ApiPrioritySuggestion,
  ApiNotification,
  ApiActionItem,
  ApiAgendaItem,
  ApiFinalMinutes,
  ApiMeeting,
  ApiMeetingAttendee,
  ApiMeetingNote,
  InvitationResponse,
  ActionItemInput,
  ActionItemPatch,
  AgendaItemInput,
  AgendaItemPatch,
  AttendeeInput,
  AttendeePatch,
  FinalMinutesContent,
  FinalMinutesDraft,
  InvitePreview,
  MeetingInput,
  MeetingPatch,
  MinutesPreview,
  NoteInput,
  NotePatch,
  NoteTaskInput,
  NoteTaskResult,
  SendReport,
  SeriesScope,
  ApiProject,
  ApiProjectMeetingsOverview,
  ApiProjectProgress,
  ApiTag,
  ApiTask,
  AiAgendaItem,
  AiDraftAgendaInput,
  AiMeetingDraft,
  DevicePlatform,
  Envelope,
  FreeTimesInput,
  FreeTimesReply,
} from './types';
import type { CompletionStats, ProjectPerformanceRow, ReportFilters, TimeSeries, UserWorkloadRow } from './reports';

export interface TaskListParams {
  projectId?: string;
  columnId?: string;
  assigneeId?: string;
  /** Keyword (title/description/key). */
  q?: string;
  /** CSV of priorities, e.g. "HIGH,URGENT". */
  priority?: string;
  /** CSV of column categories (status), e.g. "IN_PROGRESS,REVIEW". */
  category?: string;
  /** CSV of tag ids. */
  tag?: string;
  dueBefore?: string;
  dueAfter?: string;
  overdue?: boolean;
  /** Per-date boards: restrict to tasks on this board day (YYYY-MM-DD). */
  boardDate?: string;
  sort?: 'dueDate' | 'priority' | 'createdAt' | 'updatedAt' | 'title' | 'position';
  order?: 'asc' | 'desc';
  /** One page of the filtered, sorted list: at most `limit` tasks, from `offset` (the server's 1–1000). */
  limit?: number;
  offset?: number;
}

function queryString(params: Record<string, string | undefined>): string {
  const pairs = Object.entries(params).filter(([, v]) => v != null && v !== '');
  if (pairs.length === 0) return '';
  return '?' + pairs.map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`).join('&');
}

/** Optional per-call write options. `idempotencyKey` is sent as the `Idempotency-Key` header. */
export interface WriteOptions {
  idempotencyKey?: string;
}

/**
 * How long the task AI helpers may take: the server waits up to 120 s for the model (one still
 * loading takes 45–90 s), so the phone allows a little more before it gives up.
 */
export const AI_TIMEOUT_MS = 130_000;

/** The longest description the server's AI helpers accept (a longer one is refused outright). */
export const AI_DESCRIPTION_MAX = 4000;

/** The longest sentence "Describe the meeting" sends (the server refuses a longer one). */
export const AI_SENTENCE_MAX = 1000;

/**
 * How long drafting the final minutes with the AI may take: the server gives the model up to three
 * minutes for a whole meeting's agenda, notes and action items, so the phone waits a little longer.
 */
export const AI_MINUTES_TIMEOUT_MS = 190_000;

/**
 * How long sending invitations or the minutes may take: the server emails each person in turn (the
 * minutes with their PDF), which can outlast an ordinary request on a big meeting.
 */
export const SEND_TIMEOUT_MS = 120_000;

/** A description cut to the AI's limit, never in the middle of an emoji (a surrogate pair). */
function aiDescription(description: string | undefined): string | undefined {
  if (description === undefined || description.length <= AI_DESCRIPTION_MAX) return description;
  const cut = description.charCodeAt(AI_DESCRIPTION_MAX - 1);
  return description.slice(0, cut >= 0xd800 && cut <= 0xdbff ? AI_DESCRIPTION_MAX - 1 : AI_DESCRIPTION_MAX);
}

/**
 * Typed resource functions over the API client (A2). Each unwraps the `{ data }`
 * envelope so callers work with the payload directly. Paths mirror `/api/v1`.
 * POSTs that create something accept an idempotency key so a retried / replayed write is
 * de-duplicated by the server (XP-06).
 */
export function resourcesApi(client: ApiClient) {
  const data = <T>(p: Promise<Envelope<T>>) => p.then((r) => r.data);
  const meeting = (id: string) => `/meetings/${encodeURIComponent(id)}`;
  const seriesQuery = (scope: SeriesScope) => (scope === 'series' ? '?scope=series' : '');

  return {
    projects: {
      list: () => data(client.get<Envelope<ApiProject[]>>('/projects')),
      get: (id: string) => data(client.get<Envelope<ApiProject>>(`/projects/${id}`)),
      columns: (id: string) => data(client.get<Envelope<ApiColumn[]>>(`/projects/${id}/columns`)),
      /** Project members — the pool of users a task in this project can be assigned to. */
      members: (id: string) => data(client.get<Envelope<ApiMember[]>>(`/projects/${id}/members`)),
      /** Per-project progress/dashboard figures. */
      progress: (id: string) => data(client.get<Envelope<ApiProjectProgress>>(`/projects/${id}/progress`)),
    },
    tasks: {
      list: (params: TaskListParams = {}) =>
        data(
          client.get<Envelope<ApiTask[]>>(
            `/tasks${queryString({
              projectId: params.projectId,
              columnId: params.columnId,
              assigneeId: params.assigneeId,
              q: params.q,
              priority: params.priority,
              category: params.category,
              tag: params.tag,
              dueBefore: params.dueBefore,
              dueAfter: params.dueAfter,
              overdue: params.overdue ? 'true' : undefined,
              boardDate: params.boardDate,
              sort: params.sort,
              order: params.order,
              limit: params.limit?.toString(),
              offset: params.offset?.toString(),
            })}`,
          ),
        ),
      mine: () => data(client.get<Envelope<ApiTask[]>>('/tasks/mine')),
      get: (id: string) => data(client.get<Envelope<ApiTask>>(`/tasks/${id}`)),
      create: (
        body: Omit<Partial<ApiTask>, 'tags' | 'assignees'> & {
          title: string;
          projectId: string;
          columnId: string;
          tags?: string[];
          assigneeIds?: string[];
        },
        opts?: WriteOptions,
      ) => data(client.post<Envelope<ApiTask>>('/tasks', body, idempotencyHeaders(opts?.idempotencyKey))),
      update: (id: string, body: Partial<ApiTask> & { scope?: 'one' | 'series'; expectedVersion?: number }) =>
        data(client.put<Envelope<ApiTask>>(`/tasks/${id}`, body)),
      move: (id: string, columnId: string, position?: number) =>
        data(client.patch<Envelope<ApiTask>>(`/tasks/${id}/move`, { columnId, position })),
      /** Delete a task — with 'series', every copy of a repeating task. */
      remove: (id: string, scope?: 'series') => client.del<void>(scope ? `/tasks/${id}?scope=${scope}` : `/tasks/${id}`),
      // Tags: read a task's tags, replace the whole set (find-or-create by name), or detach one.
      tags: (id: string) => data(client.get<Envelope<ApiTag[]>>(`/tasks/${id}/tags`)),
      setTags: (id: string, tags: string[]) => data(client.put<Envelope<ApiTag[]>>(`/tasks/${id}/tags`, { tags })),
      removeTag: (id: string, tagId: string) => client.del<void>(`/tasks/${id}/tags/${tagId}`),
      // Assignees: list, add one or more (idempotent), or remove one.
      assignees: (id: string) => data(client.get<Envelope<ApiAssignee[]>>(`/tasks/${id}/assignees`)),
      assign: (id: string, userIds: string[], opts?: WriteOptions) =>
        data(client.post<Envelope<ApiAssignee[]>>(`/tasks/${id}/assignees`, { userIds }, idempotencyHeaders(opts?.idempotencyKey))),
      unassign: (id: string, userId: string) => client.del<void>(`/tasks/${id}/assignees/${userId}`),
      // Checklist (subtasks): list with progress, add, toggle/edit, reorder, remove.
      checklist: (id: string) => data(client.get<Envelope<ApiChecklist>>(`/tasks/${id}/checklist`)),
      addChecklistItem: (id: string, text: string, opts?: WriteOptions) =>
        data(client.post<Envelope<ApiChecklistItem>>(`/tasks/${id}/checklist`, { text }, idempotencyHeaders(opts?.idempotencyKey))),
      updateChecklistItem: (itemId: string, patch: { done?: boolean; text?: string }) =>
        data(client.put<Envelope<ApiChecklistItem>>(`/checklist/${itemId}`, patch)),
      reorderChecklist: (id: string, orderedIds: string[]) =>
        data(client.put<Envelope<ApiChecklistItem[]>>(`/tasks/${id}/checklist/reorder`, { orderedIds })),
      removeChecklistItem: (itemId: string) => client.del<void>(`/checklist/${itemId}`),
      // Comments: list, add (supports @mentions), edit (own), remove (own/admin).
      comments: (id: string) => data(client.get<Envelope<ApiComment[]>>(`/tasks/${id}/comments`)),
      // Who an @mention in this task's comments would notify — suggested while typing.
      mentionable: (id: string) => data(client.get<Envelope<ApiMentionable[]>>(`/tasks/${id}/mentionable`)),
      addComment: (id: string, body: string, parentId?: string, opts?: WriteOptions) =>
        data(
          client.post<Envelope<ApiComment>>(
            `/tasks/${id}/comments`,
            parentId ? { body, parentId } : { body },
            idempotencyHeaders(opts?.idempotencyKey),
          ),
        ),
      editComment: (commentId: string, body: string) => data(client.put<Envelope<ApiComment>>(`/comments/${commentId}`, { body })),
      removeComment: (commentId: string) => client.del<void>(`/comments/${commentId}`),
      // Attachments (files on a task): list, upload one picked file, remove.
      attachments: (id: string) => data(client.get<Envelope<ApiAttachment[]>>(`/tasks/${id}/attachments`)),
      /** Upload one picked file; `onProgress` hears how much has been sent (0–1). */
      uploadAttachment: (id: string, part: { uri: string; name: string; type: string }, onProgress?: (fraction: number) => void) => {
        const form = new FormData();
        // React Native sends a { uri, name, type } part as the file's bytes.
        form.append('file', part as unknown as Blob);
        return data(client.upload<Envelope<ApiAttachment>>(`/tasks/${id}/attachments`, form, onProgress ? { onProgress } : undefined));
      },
      removeAttachment: (attachmentId: string) => client.del<void>(`/attachments/${attachmentId}`),
      /** The task's activity history (newest first). */
      activity: (id: string) => data(client.get<Envelope<ApiActivityEntry[]>>(`/tasks/${id}/activity`)),
      /** Blockers: what the task waits on, and what waits on it. */
      dependencies: (id: string) => data(client.get<Envelope<ApiDependencyView>>(`/tasks/${id}/dependencies`)),
      addDependency: (id: string, dependsOnTaskId: string) => data(client.post<Envelope<unknown>>(`/tasks/${id}/dependencies`, { dependsOnTaskId })),
      removeDependency: (id: string, dependsOnTaskId: string) => client.del<void>(`/tasks/${id}/dependencies/${dependsOnTaskId}`),
      /** Following a task's updates. */
      watchStatus: (id: string) => data(client.get<Envelope<{ watching: boolean }>>(`/tasks/${id}/watch`)).then((r) => r.watching),
      watch: (id: string) => data(client.post<Envelope<{ watching: boolean }>>(`/tasks/${id}/watch`)),
      unwatch: (id: string) => client.del<void>(`/tasks/${id}/watch`),
      watchers: (id: string) => data(client.get<Envelope<ApiWatcher[]>>(`/tasks/${id}/watchers`)),
    },
    /**
     * Meetings: taking part in them — the list, one meeting and its parts, your answer to the
     * invitation and your action items (2a) — and running them (2b): scheduling and editing (one
     * meeting or its series), people and invitations, the agenda, Live notes and note → task, action
     * items, the final minutes, the minutes PDF and email, cancelling, duplicating and deleting. The
     * server decides who may do what (`canEdit`); a refused write is a 403 with its reason.
     */
    meetings: {
      /** The meetings starting in [from, to) (ISO instants) that the user can see. */
      range: (from: string, to: string) => data(client.get<Envelope<ApiMeeting[]>>(`/meetings${queryString({ from, to })}`)),
      projectOverview: (projectId: string) =>
        data(client.get<Envelope<ApiProjectMeetingsOverview>>(`/projects/${projectId}/meetings-overview`)),
      /** Every meeting the user can see (with its people and minutes counts), or only the ones they organize. */
      list: (filter: { mine?: boolean } = {}) => data(client.get<Envelope<ApiMeeting[]>>(`/meetings${queryString({ mine: filter.mine ? 'true' : undefined })}`)),
      get: (id: string) => data(client.get<Envelope<ApiMeeting>>(`/meetings/${encodeURIComponent(id)}`)),
      attendees: (id: string) => data(client.get<Envelope<ApiMeetingAttendee[]>>(`/meetings/${encodeURIComponent(id)}/attendees`)),
      agenda: (id: string) => data(client.get<Envelope<ApiAgendaItem[]>>(`/meetings/${encodeURIComponent(id)}/agenda`)),
      notes: (id: string) => data(client.get<Envelope<ApiMeetingNote[]>>(`/meetings/${encodeURIComponent(id)}/notes`)),
      actionItems: (id: string) => data(client.get<Envelope<ApiActionItem[]>>(`/meetings/${encodeURIComponent(id)}/action-items`)),
      finalMinutes: (id: string) => data(client.get<Envelope<ApiFinalMinutes>>(`/meetings/${encodeURIComponent(id)}/final-minutes`)),
      /** Answer my own invitation (the server lets an attendee change only this on their own row). */
      respond: (meetingId: string, attendeeId: string, response: InvitationResponse) =>
        data(
          client.patch<Envelope<ApiMeetingAttendee>>(`/meetings/${encodeURIComponent(meetingId)}/attendees/${encodeURIComponent(attendeeId)}`, { response }),
        ),
      /** Everything assigned to me across meetings — only what is still to do, or all of it. */
      myActionItems: (filter: { openOnly?: boolean } = {}) =>
        data(client.get<Envelope<ApiActionItem[]>>(`/me/action-items${queryString({ openOnly: filter.openOnly ? 'true' : undefined })}`)),

      // ── Running a meeting (2b) ──
      create: (input: MeetingInput, opts?: WriteOptions) => data(client.post<Envelope<ApiMeeting>>('/meetings', input, idempotencyHeaders(opts?.idempotencyKey))),
      /** `series`: every upcoming meeting of the meeting's series gets the change. */
      update: (id: string, patch: MeetingPatch, scope: SeriesScope = 'one') => data(client.put<Envelope<ApiMeeting>>(`${meeting(id)}${seriesQuery(scope)}`, patch)),
      cancel: (id: string, scope: SeriesScope = 'one') => data(client.post<Envelope<ApiMeeting>>(`${meeting(id)}/cancel${seriesQuery(scope)}`)),
      /** A copy of the meeting's details (not its people, agenda or notes) as a new draft. */
      duplicate: (id: string, opts?: WriteOptions) =>
        data(client.post<Envelope<ApiMeeting>>(`${meeting(id)}/duplicate`, undefined, idempotencyHeaders(opts?.idempotencyKey))),
      remove: (id: string, scope: SeriesScope = 'one') => client.del<void>(`${meeting(id)}${seriesQuery(scope)}`),

      addAttendee: (id: string, input: AttendeeInput, opts?: WriteOptions) =>
        data(client.post<Envelope<ApiMeetingAttendee>>(`${meeting(id)}/attendees`, input, idempotencyHeaders(opts?.idempotencyKey))),
      updateAttendee: (id: string, attendeeId: string, patch: AttendeePatch) =>
        data(client.patch<Envelope<ApiMeetingAttendee>>(`${meeting(id)}/attendees/${encodeURIComponent(attendeeId)}`, patch)),
      removeAttendee: (id: string, attendeeId: string) => client.del<void>(`${meeting(id)}/attendees/${encodeURIComponent(attendeeId)}`),
      /** Who an invitation would go to, and anything to fix first (sends nothing). */
      previewInvites: (id: string) => data(client.get<Envelope<InvitePreview>>(`${meeting(id)}/invites/preview`)),
      /**
       * Calendar invitations: to everyone; only to people not invited yet; or everyone again (`resend`).
       * A try that got no answer is sent again with its key, so the server answers it instead of sending twice.
       */
      sendInvites: (id: string, opts: { onlyNew?: boolean; resend?: boolean } = {}, write?: WriteOptions) =>
        data(client.post<Envelope<SendReport>>(`${meeting(id)}/invites`, opts, { timeoutMs: SEND_TIMEOUT_MS, ...idempotencyHeaders(write?.idempotencyKey) })),

      addAgendaItem: (id: string, input: AgendaItemInput, opts?: WriteOptions) =>
        data(client.post<Envelope<ApiAgendaItem>>(`${meeting(id)}/agenda`, input, idempotencyHeaders(opts?.idempotencyKey))),
      updateAgendaItem: (id: string, itemId: string, patch: AgendaItemPatch) =>
        data(client.patch<Envelope<ApiAgendaItem>>(`${meeting(id)}/agenda/${encodeURIComponent(itemId)}`, patch)),
      removeAgendaItem: (id: string, itemId: string) => client.del<void>(`${meeting(id)}/agenda/${encodeURIComponent(itemId)}`),
      /** A new order: every item's id, first to last. */
      reorderAgenda: (id: string, orderedIds: string[]) => data(client.put<Envelope<ApiAgendaItem[]>>(`${meeting(id)}/agenda/reorder`, { orderedIds })),

      addNote: (id: string, input: NoteInput, opts?: WriteOptions) =>
        data(client.post<Envelope<ApiMeetingNote>>(`${meeting(id)}/notes`, input, idempotencyHeaders(opts?.idempotencyKey))),
      updateNote: (id: string, noteId: string, patch: NotePatch) =>
        data(client.patch<Envelope<ApiMeetingNote>>(`${meeting(id)}/notes/${encodeURIComponent(noteId)}`, patch)),
      removeNote: (id: string, noteId: string) => client.del<void>(`${meeting(id)}/notes/${encodeURIComponent(noteId)}`),
      /** Undo a delete (the server keeps a deleted note for a while). */
      restoreNote: (id: string, noteId: string) =>
        data(client.post<Envelope<ApiMeetingNote>>(`${meeting(id)}/notes/${encodeURIComponent(noteId)}/restore`, {})),
      /** ⭐ Make a board task from a note; an action note is tracked as an action item too. */
      noteToTask: (id: string, noteId: string, input: NoteTaskInput, opts?: WriteOptions) =>
        data(
          client.post<Envelope<NoteTaskResult>>(`${meeting(id)}/notes/${encodeURIComponent(noteId)}/task`, input, idempotencyHeaders(opts?.idempotencyKey)),
        ),

      addActionItem: (id: string, input: ActionItemInput, opts?: WriteOptions) =>
        data(client.post<Envelope<ApiActionItem>>(`${meeting(id)}/action-items`, input, idempotencyHeaders(opts?.idempotencyKey))),
      updateActionItem: (itemId: string, patch: ActionItemPatch) =>
        data(client.patch<Envelope<ApiActionItem>>(`/action-items/${encodeURIComponent(itemId)}`, patch)),
      removeActionItem: (itemId: string) => client.del<void>(`/action-items/${encodeURIComponent(itemId)}`),

      /** A first draft to edit — by the AI from the meeting's facts (slow), or from the notes. Not kept until saved. */
      draftFinalMinutes: (id: string, source: 'ai' | 'notes') =>
        data(client.post<Envelope<FinalMinutesDraft>>(`${meeting(id)}/final-minutes/draft`, { source }, { timeoutMs: AI_MINUTES_TIMEOUT_MS })),
      saveFinalMinutes: (id: string, content: FinalMinutesContent) =>
        data(client.put<Envelope<ApiFinalMinutes>>(`${meeting(id)}/final-minutes`, { content })),
      /** Mark them final: with what is on screen, or what was saved. */
      approveFinalMinutes: (id: string, content?: FinalMinutesContent) =>
        data(client.post<Envelope<ApiFinalMinutes>>(`${meeting(id)}/final-minutes/approve`, content ? { content } : {})),
      reopenFinalMinutes: (id: string) => data(client.post<Envelope<ApiFinalMinutes>>(`${meeting(id)}/final-minutes/reopen`, {})),

      /** The minutes email as it would be sent, and to whom (sends nothing). */
      previewMinutes: (id: string) => data(client.get<Envelope<MinutesPreview>>(`${meeting(id)}/minutes/preview`)),
      /** Email the minutes PDF — to everyone, or to the chosen people's addresses. */
      sendMinutes: (id: string, recipients?: string[], write?: WriteOptions) =>
        data(
          client.post<Envelope<SendReport>>(`${meeting(id)}/minutes/send`, recipients ? { recipients } : {}, {
            timeoutMs: SEND_TIMEOUT_MS,
            ...idempotencyHeaders(write?.idempotencyKey),
          }),
        ),
      /** The minutes PDF's address (downloaded with the session by the exporter). */
      minutesPdfPath: (id: string) => `${meeting(id)}/minutes.pdf`,

      // ── Scheduling help (2c), worked out by the server without AI ──
      /** Three free times, who clashes with the chosen time, and the chosen day's busy blocks. */
      freeTimes: (body: FreeTimesInput) => data(client.post<Envelope<FreeTimesReply>>('/meetings/free-times', body)),
    },
    /** AI help — suggestions the user reviews before anything changes (given longer than other requests). */
    ai: {
      breakdown: (title: string, description?: string) =>
        data(
          client.post<Envelope<{ items: string[] }>>('/ai/breakdown', { title, description: aiDescription(description) }, { timeoutMs: AI_TIMEOUT_MS }),
        ).then((r) => r?.items ?? []),
      suggestPriority: (title: string, description?: string, dueDate?: string | null) =>
        data(
          client.post<Envelope<ApiPrioritySuggestion>>(
            '/ai/suggest-priority',
            { title, description: aiDescription(description), dueDate },
            { timeoutMs: AI_TIMEOUT_MS },
          ),
        ),
      // ── Meeting AI (2c): suggestions the person reviews before anything changes ──
      /** Fill the meeting form from a sentence; `today` is the company's day, for "Monday" or "tomorrow". */
      parseMeeting: (text: string, today?: string) =>
        data(
          client.post<Envelope<AiMeetingDraft>>('/ai/parse-meeting', { text: text.trim().slice(0, AI_SENTENCE_MAX), ...(today ? { today } : {}) }, { timeoutMs: AI_TIMEOUT_MS }),
        ),
      /** Propose a meeting's agenda (the server adds the project's open tasks and the last meeting's leftovers). */
      draftAgenda: (input: AiDraftAgendaInput) =>
        data(client.post<Envelope<{ items?: AiAgendaItem[] }>>('/ai/draft-agenda', input, { timeoutMs: AI_TIMEOUT_MS })).then((r) => (Array.isArray(r?.items) ? r.items : [])),
      /** A short description for the meeting's invitation. */
      writeMeetingDescription: (input: { title: string; agenda?: string[]; text?: string }) =>
        data(client.post<Envelope<{ description?: string }>>('/ai/write-meeting-description', input, { timeoutMs: AI_TIMEOUT_MS })).then((r) => r?.description ?? ''),
    },
    /** Shared tag catalog for suggestions/autocomplete. */
    tagCatalog: () => data(client.get<Envelope<ApiTag[]>>('/tags')),
    notifications: {
      list: () => data(client.get<Envelope<ApiNotification[]>>('/notifications')),
      unreadCount: () => data(client.get<Envelope<{ count: number }>>('/notifications/unread-count')),
      markRead: (id: string) => data(client.put<Envelope<ApiNotification>>(`/notifications/${id}/read`)),
      markAllRead: () => data(client.post<Envelope<{ updated: number }>>('/notifications/read-all')),
      // Which notifications you get and when "due soon" reminders arrive (shared with the web app).
      preferences: () => data(client.get<Envelope<NotificationPreferences>>('/notifications/preferences')),
      setPreferences: (prefs: NotificationPreferences) =>
        data(client.put<Envelope<NotificationPreferences>>('/notifications/preferences', prefs)),
    },
    /** The server's public settings and your own date settings (shared with the website). */
    settings: {
      config: () => data(client.get<Envelope<ServerConfig>>('/config')),
      datePreferences: () => data(client.get<Envelope<DatePreferences>>('/users/me/preferences')),
      /** The server's release (signed in): the website and the app share one version number. */
      version: () => data(client.get<Envelope<{ version: string }>>('/version')),
    },
    deviceTokens: {
      register: (token: string, platform: DevicePlatform = 'ANDROID') =>
        client.post<void>('/device-tokens', { token, platform }),
      unregister: (token: string) => client.del<void>(`/device-tokens/${encodeURIComponent(token)}`),
    },
    /** Reports (administrators): the same figures as the web portal, scoped by project / team member. */
    reports: {
      projects: (f: ReportFilters = {}) => data(client.get<Envelope<ProjectPerformanceRow[]>>(`/reports/projects${queryString({ projectId: f.projectId, userId: f.userId })}`)),
      status: (f: ReportFilters = {}) => data(client.get<Envelope<Record<string, number>>>(`/reports/status${queryString({ projectId: f.projectId, userId: f.userId })}`)),
      workload: (f: ReportFilters = {}) => data(client.get<Envelope<UserWorkloadRow[]>>(`/reports/workload${queryString({ projectId: f.projectId, userId: f.userId })}`)),
      completion: (f: ReportFilters = {}) => data(client.get<Envelope<CompletionStats>>(`/reports/completion${queryString({ projectId: f.projectId, userId: f.userId })}`)),
      timeseries: (f: ReportFilters = {}) =>
        data(client.get<Envelope<TimeSeries>>(`/reports/timeseries${queryString({ projectId: f.projectId, userId: f.userId, from: f.from, to: f.to })}`)),
    },
    /** Minimal people directory (id + name) for chat author names and the DM picker. */
    directory: () => data(client.get<Envelope<ApiDirectoryUser[]>>('/users/directory')),
    /** Chat: project channels + 1:1 direct messages. */
    chat: {
      conversations: () => data(client.get<Envelope<ApiConversationSummary[]>>('/conversations')),
      openProjectChannel: (projectId: string) =>
        data(client.get<Envelope<{ conversation: ApiConversation; messages: ApiChatMessage[] }>>(`/projects/${projectId}/chat`)),
      startDirect: (userId: string) => data(client.post<Envelope<ApiConversation>>('/conversations/direct', { userId })),
      /**
       * One page of history, oldest first: the newest page, or (with `before` = the oldest loaded
       * message's createdAt) the page just older than it.
       */
      messages: (conversationId: string, before?: string, limit?: number) =>
        data(
          client.get<Envelope<ApiChatMessage[]>>(
            `/conversations/${conversationId}/messages${queryString({ before, limit: limit ? String(limit) : undefined })}`,
          ),
        ),
      /** Send. With a client id the server hands a retry the first message back, never a second copy. */
      send: (conversationId: string, body: string, opts?: WriteOptions & { clientId?: string }) =>
        data(
          client.post<Envelope<ApiChatMessage>>(
            `/conversations/${conversationId}/messages`,
            opts?.clientId ? { body, clientId: opts.clientId } : { body },
            idempotencyHeaders(opts?.idempotencyKey),
          ),
        ),
      /** Who is in a conversation (user ids): a channel's project people, or a direct conversation's two. */
      members: (conversationId: string) => data(client.get<Envelope<string[]>>(`/conversations/${conversationId}/members`)),
      edit: (messageId: string, body: string) => data(client.patch<Envelope<ApiChatMessage>>(`/messages/${messageId}`, { body })),
      remove: (messageId: string) => client.del<void>(`/messages/${messageId}`),
      addReaction: (messageId: string, emoji: string) => client.post<void>(`/messages/${messageId}/reactions`, { emoji }),
      removeReaction: (messageId: string, emoji: string) =>
        client.del<void>(`/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`),
      markRead: (conversationId: string) => client.post<void>(`/conversations/${conversationId}/read`, {}),
    },
  };
}

export type ResourcesApi = ReturnType<typeof resourcesApi>;
