import { useCallback } from 'react';
import { useQuery, useQueries, useInfiniteQuery, useMutation, useQueryClient, keepPreviousData, type QueryClient } from '@tanstack/react-query';
import { useServices } from './providers';
import { ApiError, isNetworkError } from '../lib/api-client';
import { refetchAfterMove } from '../lib/task-status';
import { editBaseVersion, taskWrites, withExpectedVersion } from '../lib/task-writes';
import { afterTaskDeleted, afterTaskSaved, assignmentRefreshes, moveRefreshes } from '../lib/task-cache';
import { CHAT_DIRECTORY_COPY, CHAT_INBOX_COPY, chatMembersCopyKey, chatThreadCopyKey, projectTasksCopyKey, withoutOldDone } from '../lib/offline-copy';
import { blockerSearchParams } from '../lib/blocker-search';
import { refresh } from '../lib/refresh';
import { resourcesApi } from '../lib/resources';
import { newIdempotencyKey } from '../lib/idempotency';
import { withoutOldMeetings } from '../lib/meeting-list';
import { withAnswer } from '../lib/meeting-detail';
import { findMeeting } from '../lib/meeting-screen';
import { answerFailed, answerScope } from '../lib/meeting-cache';
import { queueOnOffline, sendInOrder } from '../lib/write-order';
import { ownedWrite, type OwnedWrite } from '../lib/owned-write';
import { pendingKeys, settleShownAgenda, settleShownAttendees } from '../lib/pending-keys';
import { itemLanes, sendItemWrite } from '../lib/item-lanes';
import { withOrder } from '../lib/board-move';
import { taskMovePayload } from '../lib/board-writes';
import { useDebouncedValue } from './useDebounced';
import { CHAT_PAGE_SIZE, olderPageCursor, type ThreadPages } from '../lib/chat-thread';
import { threadKey } from '../lib/chat-cache';
import type { Services } from './services';
import type { ApiChatMessage, ApiColumn, ApiMeetingAttendee, ApiTask, InvitationResponse } from '../lib/types';
import type { ReportFilters } from '../lib/reports';
import { ALERTS_POLL_MS, ALERTS_REFRESH, countAfterRead, markedRead, withPendingReads } from '../lib/alerts';
import type { ApiNotification } from '../lib/types';

/** Variables of a creating write, carrying the idempotency key minted for this user action (XP-06). */
export type Keyed<T> = T & { idempotencyKey: string };

/** Attach a fresh idempotency key to one user action — the online try and any offline replay share it. */
export function keyed<T extends object>(vars: T): Keyed<T> {
  return { ...vars, idempotencyKey: newIdempotencyKey() };
}

/** Keep a write that got no answer for later sync (lib/write-order); one already kept is not kept again. */
export { queueOnOffline };

/**
 * A change, as the person making it now (lib/owned-write — 4b review #1): its write order (kept
 * behind an older change to the same item still waiting on this phone, and kept here at once when it
 * gets no answer — for that person only) and the server as that person. Called when the change is
 * made, before it waits in a lane: a change that waits past a switch of person is never sent with
 * the new person's session, nor kept for them.
 */
export function owned(s: Pick<Services, 'queue' | 'currentUserId' | 'sync' | 'api' | 'resources'>): OwnedWrite {
  return ownedWrite(s);
}

/** List queries read through the offline cache so a cold start (offline) still shows the last data (offline-reads). */
export function useProjects() {
  const { resources, reads } = useServices();
  return useQuery({
    queryKey: ['projects'],
    queryFn: ({ queryKey }) => reads.read(queryKey, 'projects', () => resources.projects.list()),
  });
}

export function useProjectColumns(projectId: string) {
  const { resources, reads } = useServices();
  return useQuery({
    queryKey: ['columns', projectId],
    queryFn: ({ queryKey }) => reads.read(queryKey, `columns.${projectId}`, () => resources.projects.columns(projectId)),
    enabled: !!projectId,
  });
}

export function useProjectTasks(projectId: string, boardDate?: string) {
  const { resources, reads } = useServices();
  const dk = boardDate ?? 'all';
  return useQuery({
    queryKey: ['tasks', 'project', projectId, dk],
    // The moves still waiting to be sent are laid over the answer, so a card moved offline stays put.
    queryFn: ({ queryKey }) =>
      reads.readBoard(queryKey, projectTasksCopyKey(projectId, boardDate), () => resources.tasks.list({ projectId, boardDate }), { slim: withoutOldDone(Date.now()) }),
    // Without a project id this would list every task the user can see (and cache it).
    enabled: !!projectId,
  });
}

export function useMyTasks() {
  const { resources, reads } = useServices();
  return useQuery({
    queryKey: ['tasks', 'mine'],
    // Every task ever assigned comes back; a copy too long to keep leaves out long-finished ones.
    queryFn: ({ queryKey }) => reads.read(queryKey, 'tasks.mine', () => resources.tasks.mine(), { slim: withoutOldDone(Date.now()) }),
  });
}

export function useTask(taskId: string) {
  const { resources } = useServices();
  return useQuery({ queryKey: ['task', taskId], queryFn: () => resources.tasks.get(taskId), enabled: !!taskId });
}

/**
 * Several tasks by id (the ones a task is linked to as blockers), each under its own details key —
 * a few small reads instead of every task of the project. `loading` holds the ids still on their way.
 */
export function useTasksById(ids: string[]): { tasks: ApiTask[]; loading: Set<string> } {
  const { resources } = useServices();
  const results = useQueries({ queries: ids.map((id) => ({ queryKey: ['task', id], queryFn: () => resources.tasks.get(id) })) });
  const tasks: ApiTask[] = [];
  const loading = new Set<string>();
  results.forEach((r, i) => {
    if (r.data) tasks.push(r.data);
    else if (r.isLoading) loading.add(ids[i]!);
  });
  return { tasks, loading };
}

/**
 * "Add a blocker": this project's tasks matching what was typed — one page from the server
 * (blockerSearchParams), never every task of the project. The last results stay on screen while
 * the next search runs. Needs a connection.
 */
export function useTaskSearch(projectId: string, query: string) {
  const { resources } = useServices();
  const q = query.trim();
  return useQuery({
    queryKey: ['tasks', 'search', projectId, q],
    queryFn: () => resources.tasks.list(blockerSearchParams(projectId, q)),
    enabled: !!projectId && q.length > 0,
    placeholderData: keepPreviousData,
  });
}

export function useTaskTags(taskId: string) {
  const { resources } = useServices();
  return useQuery({ queryKey: ['task', taskId, 'tags'], queryFn: () => resources.tasks.tags(taskId) });
}

/** A project’s members; kept for an offline start (New task’s assignees, 4a). */
export function useProjectMembers(projectId: string) {
  const { resources, reads } = useServices();
  return useQuery({
    queryKey: ['project', projectId, 'members'],
    // Through the offline copy (5b): the Team tab and the assignee pickers work offline too.
    queryFn: ({ queryKey }) => reads.read(queryKey, `members.${projectId}`, () => resources.projects.members(projectId)),
    enabled: !!projectId,
  });
}

export function useTaskAssignees(taskId: string) {
  const { resources } = useServices();
  return useQuery({ queryKey: ['task', taskId, 'assignees'], queryFn: () => resources.tasks.assignees(taskId), enabled: !!taskId });
}

/**
 * A task's assignment changes go one after another, in the task's people lane (both hooks share it:
 * write-order's 'assignees:<task>'), so they reach the server in order. Each is made as the person
 * making it (owned): a TanStack scope would run a waiting one later as whoever is signed in then.
 */
export function useAssignUsers(taskId: string) {
  const services = useServices();
  const { queue, currentUserId } = services;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userIds, idempotencyKey }: Keyed<{ userIds: string[] }>) => {
      const w = owned(services);
      return sendItemWrite(itemLanes, w.order, { kind: 'task.assign', payload: { id: taskId, userIds }, idempotencyKey }, () =>
        w.resources.tasks.assign(taskId, userIds, { idempotencyKey }),
      );
    },
    // As the replay does: My Tasks and the lists holding it (the calendar's too) follow (5a review).
    onSuccess: () => refresh(qc, assignmentRefreshes(taskId)),
    onError: (err, v) => queueOnOffline(queue, currentUserId(), err, 'task.assign', { id: taskId, userIds: v.userIds }, v.idempotencyKey),
  });
}

export function useUnassignUser(taskId: string) {
  const services = useServices();
  const { queue, currentUserId } = services;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => {
      const w = owned(services);
      return sendItemWrite(itemLanes, w.order, { kind: 'task.unassign', payload: { id: taskId, userId } }, () => w.resources.tasks.unassign(taskId, userId));
    },
    onSuccess: () => refresh(qc, assignmentRefreshes(taskId)),
    onError: (err, userId) => queueOnOffline(queue, currentUserId(), err, 'task.unassign', { id: taskId, userId }),
  });
}

// ── Checklist (subtasks) ─────────────────────────────────────────────────────
export function useTaskChecklist(taskId: string) {
  const { resources } = useServices();
  return useQuery({ queryKey: ['task', taskId, 'checklist'], queryFn: () => resources.tasks.checklist(taskId) });
}

export function useChecklistMutations(taskId: string) {
  const services = useServices();
  const { resources, queue, currentUserId } = services;
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['task', taskId, 'checklist'] });
    void qc.invalidateQueries({ queryKey: ['task', taskId, 'activity'] });
    void qc.invalidateQueries({ queryKey: ['task', taskId], exact: true }); // progress follows the checklist
  };
  const add = useMutation({
    mutationFn: ({ text, idempotencyKey }: Keyed<{ text: string }>) => owned(services).run((r) => r.tasks.addChecklistItem(taskId, text, { idempotencyKey })),
    onSuccess: invalidate,
    onError: (err, v) => queueOnOffline(queue, currentUserId(), err, 'checklist.add', { id: taskId, text: v.text }, v.idempotencyKey),
  });
  const update = useMutation({
    // One subtask's changes go one after another, so they reach the server in order; another
    // subtask's go at once (item-lanes).
    mutationFn: ({ itemId, patch }: { itemId: string; patch: { done?: boolean; text?: string } }) => {
      const w = owned(services);
      return sendItemWrite(itemLanes, w.order, { kind: 'checklist.update', payload: { id: taskId, itemId, patch } }, () => w.resources.tasks.updateChecklistItem(itemId, patch));
    },
    onSuccess: invalidate,
    // The task's id goes along so the replay refreshes that task's checklist only.
    onError: (err, { itemId, patch }) => queueOnOffline(queue, currentUserId(), err, 'checklist.update', { id: taskId, itemId, patch }),
  });
  const remove = useMutation({ mutationFn: (itemId: string) => resources.tasks.removeChecklistItem(itemId), onSuccess: invalidate });
  /** Save a new order (every item id, first to last). Needs a connection. */
  const reorder = useMutation({ mutationFn: (orderedIds: string[]) => resources.tasks.reorderChecklist(taskId, orderedIds), onSuccess: invalidate });
  return { add, update, remove, reorder };
}

// ── Comments ─────────────────────────────────────────────────────────────────
export function useTaskComments(taskId: string) {
  const { resources } = useServices();
  return useQuery({ queryKey: ['task', taskId, 'comments'], queryFn: () => resources.tasks.comments(taskId) });
}

/** The people who can be @mentioned in a task's comments. */
export function useTaskMentionable(taskId: string) {
  const { resources } = useServices();
  return useQuery({ queryKey: ['task', taskId, 'mentionable'], queryFn: () => resources.tasks.mentionable(taskId), staleTime: 60_000 });
}

export function useCommentMutations(taskId: string) {
  const services = useServices();
  const { resources, queue, currentUserId } = services;
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['task', taskId, 'comments'] });
    void qc.invalidateQueries({ queryKey: ['task', taskId, 'activity'] });
  };
  const add = useMutation({
    mutationFn: ({ body, idempotencyKey }: Keyed<{ body: string }>) => owned(services).run((r) => r.tasks.addComment(taskId, body, undefined, { idempotencyKey })),
    onSuccess: invalidate,
    onError: (err, v) => queueOnOffline(queue, currentUserId(), err, 'comment.add', { id: taskId, body: v.body }, v.idempotencyKey),
  });
  /** Change the text of your own comment. Needs a connection. */
  const edit = useMutation({
    mutationFn: ({ commentId, body }: { commentId: string; body: string }) => resources.tasks.editComment(commentId, body),
    onSuccess: invalidate,
  });
  const remove = useMutation({ mutationFn: (commentId: string) => resources.tasks.removeComment(commentId), onSuccess: invalidate });
  return { add, edit, remove };
}

// ── Attachments ──────────────────────────────────────────────────────────────
export function useTaskAttachments(taskId: string) {
  const { resources } = useServices();
  return useQuery({ queryKey: ['task', taskId, 'attachments'], queryFn: () => resources.tasks.attachments(taskId) });
}

/** Upload one picked file / remove a file. Uploads need a connection (files aren't queued offline). */
export function useAttachmentMutations(taskId: string) {
  const { resources } = useServices();
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['task', taskId, 'attachments'] });
    void qc.invalidateQueries({ queryKey: ['task', taskId, 'activity'] });
  };
  const upload = useMutation({
    mutationFn: ({ part, onProgress }: { part: { uri: string; name: string; type: string }; onProgress?: (fraction: number) => void }) =>
      resources.tasks.uploadAttachment(taskId, part, onProgress),
    onSuccess: invalidate,
  });
  const remove = useMutation({ mutationFn: (attachmentId: string) => resources.tasks.removeAttachment(attachmentId), onSuccess: invalidate });
  return { upload, remove };
}

// ── Activity, blockers, watching, deleting ──────────────────────────────────
/** The task's activity history (newest first). */
export function useTaskActivity(taskId: string) {
  const { resources } = useServices();
  return useQuery({ queryKey: ['task', taskId, 'activity'], queryFn: () => resources.tasks.activity(taskId) });
}

/** What the task waits on and what waits on it (ids). */
export function useTaskDependencies(taskId: string) {
  const { resources } = useServices();
  return useQuery({ queryKey: ['task', taskId, 'dependencies'], queryFn: () => resources.tasks.dependencies(taskId) });
}

/** Add / remove a blocker. Needs a connection: the server checks for loops. */
export function useDependencyMutations(taskId: string) {
  const { resources } = useServices();
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['task', taskId, 'dependencies'] });
    void qc.invalidateQueries({ queryKey: ['task', taskId, 'activity'] });
  };
  const add = useMutation({ mutationFn: (dependsOnTaskId: string) => resources.tasks.addDependency(taskId, dependsOnTaskId), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: (dependsOnTaskId: string) => resources.tasks.removeDependency(taskId, dependsOnTaskId), onSuccess: invalidate });
  return { add, remove };
}

/** Whether I follow the task, who does, and a toggle. */
export function useTaskWatch(taskId: string) {
  const { resources } = useServices();
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['task', taskId, 'watch'], queryFn: () => resources.tasks.watchStatus(taskId) });
  const watchers = useQuery({ queryKey: ['task', taskId, 'watchers'], queryFn: () => resources.tasks.watchers(taskId) });
  const toggle = useMutation({
    mutationFn: async () => {
      if (status.data) await resources.tasks.unwatch(taskId);
      else await resources.tasks.watch(taskId);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['task', taskId, 'watch'] });
      void qc.invalidateQueries({ queryKey: ['task', taskId, 'watchers'] });
    },
  });
  return { status, watchers, toggle };
}

/** Delete the task (or its whole repeating series). Needs a connection. */
export function useDeleteTask(taskId: string) {
  const { resources } = useServices();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (scope?: 'series') => resources.tasks.remove(taskId, scope),
    // Its data goes; the lists that held it and its project's figures are fetched again.
    onSuccess: (_data, scope) => afterTaskDeleted(qc, taskId, scope),
  });
}

// ── Notification preferences ─────────────────────────────────────────────────
export function useNotificationPreferences() {
  const { resources } = useServices();
  return useQuery({ queryKey: ['notifications', 'preferences'], queryFn: () => resources.notifications.preferences() });
}

// Saving them (only what changed) is core/account-queries useSavePreferences (6a).

// ── Project details ──────────────────────────────────────────────────────────
export function useProject(projectId: string) {
  const { resources, reads } = useServices();
  return useQuery({
    queryKey: ['project', projectId, 'details'],
    // Through the offline copy (5b): the project's dashboard opens offline too.
    queryFn: ({ queryKey }) => reads.read(queryKey, `project.${projectId}`, () => resources.projects.get(projectId)),
    enabled: !!projectId,
  });
}

// ── Project progress ─────────────────────────────────────────────────────────
/** One project's progress, through the offline copy (the Projects list's cards use it too — 5b). */
export function projectProgressQuery(s: Pick<Services, 'resources' | 'reads'>, projectId: string) {
  return {
    queryKey: ['project', projectId, 'progress'],
    queryFn: ({ queryKey }: { queryKey: readonly unknown[] }) => s.reads.read(queryKey, `progress.${projectId}`, () => s.resources.projects.progress(projectId)),
    enabled: !!projectId,
  };
}

export function useProjectProgress(projectId: string) {
  return useQuery(projectProgressQuery(useServices(), projectId));
}

// ── Meetings: a project (reads); the calendar's are in core/calendar-queries (5a) ──
/** A project's meetings, decisions and action items; null from a server without them (404). */
export function useProjectMeetings(projectId: string) {
  const { resources } = useServices();
  return useQuery({
    queryKey: ['project', projectId, 'meetings'],
    queryFn: () =>
      resources.meetings.projectOverview(projectId).catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }),
    enabled: !!projectId,
  });
}

// ── Meetings: taking part (the Meetings tab, one meeting, my answer, my action items) ──
/** Every meeting I can see, or only the ones I organize. */
export type MeetingScope = 'all' | 'mine';

/**
 * Whether a list screen is in view. A tab stays mounted when you go elsewhere; while it is out of
 * view its lists aren't fetched (a live event only marks them out of date), and coming back to it
 * fetches the ones that are.
 */
export interface ListActivity {
  active?: boolean;
}

/**
 * The Meetings tab's list, kept for an offline start under a fixed name per scope. A list too long
 * to keep whole leaves out meetings older than 90 days.
 */
export function useMeetings(scope: MeetingScope, { active = true }: ListActivity = {}) {
  const { resources, reads } = useServices();
  return useQuery({
    queryKey: ['meetings', 'list', scope],
    queryFn: ({ queryKey }) =>
      reads.read(queryKey, `meetings.list.${scope}`, () => resources.meetings.list({ mine: scope === 'mine' }), { slim: withoutOldMeetings(Date.now()) }),
    enabled: active,
  });
}

/**
 * One meeting. It shows at once from a list that holds it (the Meetings tab's, the calendar's —
 * also offline, from their offline copies), and is then loaded fresh with its series and `canEdit`.
 */
export function useMeeting(meetingId: string) {
  const { resources } = useServices();
  const qc = useQueryClient();
  return useQuery({
    queryKey: ['meeting', meetingId],
    queryFn: () => resources.meetings.get(meetingId),
    enabled: !!meetingId,
    initialData: () => findMeeting(qc.getQueriesData({ queryKey: ['meetings'] }).map(([, data]) => data), meetingId),
    // From a list: shown, but out of date at once, so the meeting itself is loaded too.
    initialDataUpdatedAt: 0,
  });
}

/** A meeting's people. Someone a timed-out add was trying to add is there: that try is done (pending-keys). */
export function useMeetingAttendees(meetingId: string) {
  const { resources } = useServices();
  return useQuery({
    queryKey: ['meeting', meetingId, 'attendees'],
    queryFn: async () => {
      const rows = await resources.meetings.attendees(meetingId);
      if (Array.isArray(rows)) settleShownAttendees(pendingKeys, meetingId, rows);
      return rows;
    },
    enabled: !!meetingId,
  });
}

/** A meeting's agenda. An item a timed-out add was trying to add is there: that try is done (pending-keys). */
export function useMeetingAgenda(meetingId: string) {
  const { resources } = useServices();
  return useQuery({
    queryKey: ['meeting', meetingId, 'agenda'],
    queryFn: async () => {
      const rows = await resources.meetings.agenda(meetingId);
      if (Array.isArray(rows)) settleShownAgenda(pendingKeys, meetingId, rows);
      return rows;
    },
    enabled: !!meetingId,
  });
}

export function useMeetingNotes(meetingId: string) {
  const { resources } = useServices();
  return useQuery({ queryKey: ['meeting', meetingId, 'notes'], queryFn: () => resources.meetings.notes(meetingId), enabled: !!meetingId });
}

export function useMeetingActionItems(meetingId: string) {
  const { resources } = useServices();
  return useQuery({ queryKey: ['meeting', meetingId, 'action-items'], queryFn: () => resources.meetings.actionItems(meetingId), enabled: !!meetingId });
}

export function useFinalMinutes(meetingId: string) {
  const { resources } = useServices();
  return useQuery({ queryKey: ['meeting', meetingId, 'final-minutes'], queryFn: () => resources.meetings.finalMinutes(meetingId), enabled: !!meetingId });
}

/**
 * Answer my own invitation. The answer shows at once; if the server refuses it (or gives no
 * answer) my row's old answer goes back and the people are loaded again (answerFailed). The
 * server's copy of my row replaces it after a success — nothing else is fetched again (the answer
 * shows on no other screen; the others hear of it through the meeting's live event). One meeting's
 * answers go one after another (answerScope). Needs a connection.
 */
export function useRespondToMeeting(meetingId: string) {
  const services = useServices();
  const qc = useQueryClient();
  const key = ['meeting', meetingId, 'attendees'];
  const m = useMutation({
    scope: answerScope(meetingId),
    // A scope runs a waiting answer later: it is sent as the person who gave it, captured when it
    // was given (below), never as whoever is signed in by then (4b review #1).
    mutationFn: ({ attendeeId, response, owner }: { attendeeId: string; response: InvitationResponse; owner: string | null }) =>
      (owner ? resourcesApi(services.api.forUser(owner)) : services.resources).meetings.respond(meetingId, attendeeId, response),
    onMutate: async ({ attendeeId, response }) => {
      await qc.cancelQueries({ queryKey: key, exact: true });
      const list = qc.getQueryData<ApiMeetingAttendee[]>(key);
      const previous = list?.find((a) => a.id === attendeeId) ?? null;
      if (list) qc.setQueryData(key, withAnswer(list, attendeeId, response));
      return { previous };
    },
    onError: (error, _vars, ctx) => answerFailed(qc, { meetingId, previous: ctx?.previous ?? null, error }),
    onSuccess: (saved, { attendeeId }) => {
      if (saved?.id === attendeeId) qc.setQueryData<ApiMeetingAttendee[]>(key, (list) => list?.map((a) => (a.id === attendeeId ? { ...a, ...saved } : a)));
      else refresh(qc, [{ queryKey: key, exact: true }]);
    },
  });
  const { mutate: send } = m;
  const mutate = useCallback(
    (v: { attendeeId: string; response: InvitationResponse }, opts?: Parameters<typeof send>[1]) => send({ ...v, owner: services.currentUserId() }, opts),
    [send, services],
  );
  return { ...m, mutate };
}

/** Everything assigned to me across meetings — what is still to do, or all of it — kept for an offline start. */
export function useMyActionItems(scope: 'open' | 'all', { active = true }: ListActivity = {}) {
  const { resources, reads } = useServices();
  return useQuery({
    queryKey: ['action-items', 'mine', scope],
    queryFn: ({ queryKey }) => reads.read(queryKey, `action-items.mine.${scope}`, () => resources.meetings.myActionItems({ openOnly: scope === 'open' })),
    enabled: active,
  });
}

export function useSetTaskTags(taskId: string) {
  const { resources } = useServices();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tags: string[]) => resources.tasks.setTags(taskId, tags),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['task', taskId, 'tags'] });
    },
  });
}

export function useNotifications() {
  const { resources, reads, queue, currentUserId } = useServices();
  return useQuery({
    queryKey: ['notifications'],
    // Alerts read on this phone while offline show as read until their reads are sent (5c).
    queryFn: ({ queryKey }) =>
      reads.read(queryKey, 'notifications', () => resources.notifications.list()).then((list) => withPendingReads(list, queue.pendingFor(currentUserId()))),
  });
}

/** The server's release (the version row in Settings and the "new version" notice). */
export function useServerVersion() {
  const { resources } = useServices();
  return useQuery({ queryKey: ['server', 'version'], queryFn: () => resources.settings.version(), staleTime: 10 * 60_000 });
}

/** The server's public settings (the Android download address). */
export function useServerConfig() {
  const { resources } = useServices();
  return useQuery({ queryKey: ['server', 'config'], queryFn: () => resources.settings.config(), staleTime: 60 * 60_000 });
}

/**
 * The unread alerts (the Alerts tab and the app icon, lib/alerts). With `poll` (one place only, the
 * app-wide alerts mount) it is asked for again every 30 s while the app is in front, as the website's
 * bell is; TanStack pauses it while the app is away.
 */
export function useUnreadCount({ poll = false }: { poll?: boolean } = {}) {
  const { resources } = useServices();
  return useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => resources.notifications.unreadCount(),
    refetchInterval: poll ? ALERTS_POLL_MS : false,
  });
}

/**
 * Send one task move through the app's task write path (the board, its details, the All projects
 * board and bulk actions share it): one task's writes go one after another, and the version its
 * move made is remembered so the next edit isn't refused as someone else's (task-writes). Inside
 * that lane the move waits behind an older change of the task still on this phone, and is kept here
 * when it gets no answer (write-order) — so a quick second move can't overtake the first. Its
 * project goes with it, so the replay refreshes that project's board days (refreshesAfterReplay),
 * and its new column's kind, so a move kept offline shows under that status (4c).
 */
export function sendTaskMove(
  services: Pick<Services, 'resources' | 'queue' | 'currentUserId' | 'sync' | 'api'>,
  v: { id: string; columnId: string; position?: number; projectId: string; at?: number; category?: string | null },
) {
  // Whose move it is, now — not when its lane frees (4b review #1).
  const w = owned(services);
  return taskWrites.run(v.id, () =>
    sendInOrder(w.order, { kind: 'task.move', payload: taskMovePayload(v) }, async () => {
      const moved = await w.resources.tasks.move(v.id, v.columnId, v.position);
      taskWrites.note(v.id, moved?.version);
      return moved;
    }),
  );
}

/**
 * Move a task to another column (MOB-04). The board caches one task list per board date
 * (`['tasks','project',projectId,<date>]`), so the optimistic move and the refresh address the
 * whole `['tasks','project',projectId]` prefix — plus the task's own detail and activity, "My
 * tasks" when it holds the task, and the project progress (moveRefreshes) — instead of one key the
 * board never reads.
 */
export function useMoveTask(projectId: string) {
  const services = useServices();
  const { queue, currentUserId } = services;
  const qc = useQueryClient();
  const boardPrefix = ['tasks', 'project', projectId];
  return useMutation({
    // Through the task write path (sendTaskMove). `position`: its index in the new column (4b);
    // `at`: where it shows meanwhile — kept with a move saved on this phone, so the board shows it
    // there until it is sent (offline-reads); the column's kind, from the project's columns.
    mutationFn: ({ id, columnId, position, at }: { id: string; columnId: string; position?: number; at?: number }) =>
      sendTaskMove(services, { id, columnId, position, projectId, at, category: qc.getQueryData<ApiColumn[]>(['columns', projectId])?.find((c) => c.id === columnId)?.category }),
    // Optimistic move: the card jumps columns immediately, then we reconcile with the server.
    onMutate: async ({ id, columnId, at }) => {
      await qc.cancelQueries({ queryKey: boardPrefix });
      await qc.cancelQueries({ queryKey: ['task', id], exact: true });
      const boards = qc.getQueriesData<ApiTask[]>({ queryKey: boardPrefix });
      const detail = qc.getQueryData<ApiTask>(['task', id]);
      qc.setQueriesData<ApiTask[]>({ queryKey: boardPrefix }, (list) => list?.map((t) => (t.id === id ? { ...t, columnId, ...(at !== undefined ? { position: at } : {}) } : t)));
      if (detail) qc.setQueryData<ApiTask>(['task', id], { ...detail, columnId });
      return { boards, detail };
    },
    onError: async (err, vars, ctx) => {
      if (isNetworkError(err)) {
        // Offline — keep the optimistic move and replay it on reconnect (already kept by the write).
        await queueOnOffline(queue, currentUserId(), err, 'task.move', { ...vars, projectId });
        return;
      }
      // The server rejected the move — roll back to the pre-move state.
      for (const [key, data] of ctx?.boards ?? []) qc.setQueryData(key, data);
      if (ctx?.detail) qc.setQueryData(['task', vars.id], ctx.detail);
    },
    onSettled: (_data, err, vars) => {
      // Offline, the move is queued and a reload would get no answer. Until the sync after
      // reconnecting refreshes the board, the board lays the queued move over what it reads (the
      // offline copy still has the card where it was — offline-reads).
      if (!refetchAfterMove(err)) return;
      refresh(qc, moveRefreshes(vars.id, projectId));
    },
  });
}

/**
 * A column's cards in a new order (4b): sent in the column's own lane, shown at once, put back when
 * it doesn't go (it needs a connection, as on the website — lib/board-writes).
 */
export function useReorderColumn(projectId: string) {
  const services = useServices();
  const qc = useQueryClient();
  const boardPrefix = ['tasks', 'project', projectId];
  return useMutation({
    mutationFn: ({ columnId, orderedIds }: { columnId: string; orderedIds: string[] }) => {
      const w = owned(services);
      return itemLanes.run(`column-order:${columnId}`, () => w.resources.tasks.reorder(columnId, orderedIds));
    },
    onMutate: async ({ columnId, orderedIds }) => {
      await qc.cancelQueries({ queryKey: boardPrefix });
      const boards = qc.getQueriesData<ApiTask[]>({ queryKey: boardPrefix });
      qc.setQueriesData<ApiTask[]>({ queryKey: boardPrefix }, (list) => (list ? withOrder(list, columnId, orderedIds) : list));
      return { boards };
    },
    onError: (_err, _vars, ctx) => {
      for (const [key, data] of ctx?.boards ?? []) qc.setQueryData(key, data);
    },
    onSettled: (_data, err) => {
      if (!isNetworkError(err)) void qc.invalidateQueries({ queryKey: boardPrefix });
    },
  });
}

/** What each edit was sent as (with its expectedVersion), so an edit made offline is queued the same. */
const sentEdits = new WeakMap<object, object>();

/**
 * Send one edit of a task through the app's task write path (its details, the Edit form and My
 * Tasks' bulk actions share it): made as the person making it now (owned), in the task's lane,
 * against the newest version this phone knows — the newer of the loaded task's and `fallbackVersion`
 * (the list's: final review A3), or the one its own last write made — behind
 * an older change of the task still on this phone, and kept here when it gets no answer.
 */
export function sendTaskEdit(
  services: Pick<Services, 'resources' | 'queue' | 'currentUserId' | 'sync' | 'api'>,
  qc: QueryClient,
  taskId: string,
  patch: Partial<ApiTask> & { scope?: 'one' | 'series' },
  fallbackVersion?: number,
  /** The version a form opened with (Edit task): a colleague's later change is then refused, never overwritten unseen. */
  pinnedVersion?: number,
): Promise<ApiTask> {
  const w = owned(services);
  return taskWrites.run(taskId, async () => {
    const loaded = editBaseVersion(pinnedVersion, qc.getQueryData<ApiTask>(['task', taskId])?.version, fallbackVersion);
    const body = withExpectedVersion(patch, taskWrites.expectedVersion(taskId, loaded));
    sentEdits.set(patch, body);
    return sendInOrder(w.order, { kind: 'task.update', payload: { id: taskId, patch: body } }, async () => {
      const updated = await w.resources.tasks.update(taskId, body);
      taskWrites.note(taskId, updated?.version);
      return updated;
    });
  });
}

/**
 * Save an edit to a task. It is made against the newest version this phone knows (the loaded task's,
 * or the one its own last write made), so the server refuses it only when someone else changed the
 * task (VERSION_CONFLICT); the task's writes go one after another (task-writes).
 */
export function useUpdateTask(taskId: string) {
  const services = useServices();
  const { queue, currentUserId } = services;
  const qc = useQueryClient();
  return useMutation({
    // In the task's lane, the edit waits behind an older change of the task still on this phone
    // (it then follows the version that one makes), and is kept here when it gets no answer.
    // Whose edit it is is taken now — not when its lane frees (4b review #1).
    mutationFn: (patch: Partial<ApiTask> & { scope?: 'one' | 'series' }) => sendTaskEdit(services, qc, taskId, patch),
    // The details show the saved task at once; only what the edit changed is fetched again (its
    // activity, the lists that show it, and the progress figures after a new due date).
    onSuccess: (saved, patch) => afterTaskSaved(qc, taskId, saved, patch),
    onError: (err, patch) => queueOnOffline(queue, currentUserId(), err, 'task.update', { id: taskId, patch: sentEdits.get(patch) ?? patch }),
  });
}

/**
 * Read one alert. It shows read at once with one fewer on the Alerts tab (5c); without a connection
 * the read is kept on this phone and sent later (the list shows it read meanwhile). A refusal (the
 * alert is gone) leaves what the server says.
 */
export function useMarkNotificationRead() {
  const services = useServices();
  const { queue, currentUserId } = services;
  const qc = useQueryClient();
  return useMutation({
    // Sent as the person reading it (lib/owned-write): a failure says whose it was, so it is never
    // kept for someone who signed in meanwhile.
    mutationFn: (n: Pick<ApiNotification, 'id'>) => owned(services).run((r) => r.notifications.markRead(n.id)),
    onMutate: async (n) => {
      await qc.cancelQueries({ queryKey: ['notifications'], exact: true });
      await qc.cancelQueries({ queryKey: ['notifications', 'unread'], exact: true });
      const wasUnread = !qc.getQueryData<ApiNotification[]>(['notifications'])?.some((x) => x.id === n.id && x.readAt);
      qc.setQueryData<ApiNotification[]>(['notifications'], (list) => markedRead(list, n.id, new Date().toISOString()));
      qc.setQueryData<{ count: number }>(['notifications', 'unread'], (c) => (c ? { count: countAfterRead(c.count, wasUnread) ?? 0 } : c));
    },
    onSuccess: () => refresh(qc, ALERTS_REFRESH),
    onError: async (err, n) => {
      if (isNetworkError(err)) return queueOnOffline(queue, currentUserId(), err, 'notification.read', { id: n.id });
      refresh(qc, ALERTS_REFRESH);
    },
  });
}

// ── Reports (administrators) ────────────────────────────────────────────────
// Always read fresh (no offline copy): the figures change all day, and each filter would be a copy.

/** The Reports figures that don't depend on the range, for the project / team-member filters. */
export function useReportSummary(scope: Pick<ReportFilters, 'projectId' | 'userId'>) {
  const { resources } = useServices();
  const key = { projectId: scope.projectId, userId: scope.userId };
  return useQuery({
    queryKey: ['reports', 'summary', key],
    queryFn: async () => {
      const r = resources.reports;
      const [projects, status, workload, completion] = await Promise.all([r.projects(key), r.status(key), r.workload(key), r.completion(key).catch(() => null)]);
      return { projects, status, workload, completion };
    },
    placeholderData: (prev) => prev,
  });
}

/** The trend for the filters and the range (a new range asks for this alone, as on the website). */
export function useReportTrend(filters: ReportFilters) {
  const { resources } = useServices();
  return useQuery({
    queryKey: ['reports', 'trend', filters],
    queryFn: () => resources.reports.timeseries(filters),
    placeholderData: (prev) => prev,
  });
}

/** The unfiltered project and team lists that feed the Reports filters. */
export function useReportOptions() {
  const { resources } = useServices();
  return useQuery({
    queryKey: ['reports', 'options'],
    queryFn: async () => {
      const [projects, team] = await Promise.all([resources.reports.projects(), resources.reports.workload()]);
      return {
        projects: projects.map((p) => ({ value: p.projectId, label: p.projectName })),
        team: team.map((w) => ({ value: w.userId, label: w.name || w.username })),
      };
    },
  });
}

// ── Chat ─────────────────────────────────────────────────────────────────────
// The inbox, the names and each opened thread's newest messages are kept to read offline (3a).
export function useDirectory() {
  const { resources, reads } = useServices();
  return useQuery({ queryKey: ['chat', 'directory'], queryFn: ({ queryKey }) => reads.read(queryKey, CHAT_DIRECTORY_COPY, () => resources.directory()) });
}

export function useConversations() {
  const { resources, reads } = useServices();
  return useQuery({
    queryKey: ['chat', 'conversations'],
    queryFn: ({ queryKey }) => reads.read(queryKey, CHAT_INBOX_COPY, () => resources.chat.conversations()),
  });
}

/** A channel's members (user ids), for who can be mentioned; kept offline. Not asked for a direct conversation. */
export function useConversationMembers(conversationId: string, enabled: boolean) {
  const { resources, reads } = useServices();
  return useQuery({
    queryKey: ['chat', 'members', conversationId],
    queryFn: ({ queryKey }) => reads.read(queryKey, chatMembersCopyKey(conversationId), () => resources.chat.members(conversationId)),
    enabled: !!conversationId && enabled,
  });
}

/**
 * A conversation's history, a page at a time (3a): the newest page first, older pages as you scroll
 * back (chat-thread). New and sent messages are put into these pages in place (chat-cache). The
 * newest page is kept offline (the last ones opened, offline-copy); older pages need a connection.
 */
export function useConversationMessages(conversationId: string) {
  const { resources, reads } = useServices();
  return useInfiniteQuery<ApiChatMessage[], Error, ThreadPages, string[], string | undefined>({
    queryKey: threadKey(conversationId),
    queryFn: ({ pageParam, queryKey }) =>
      pageParam
        ? resources.chat.messages(conversationId, pageParam, CHAT_PAGE_SIZE)
        : reads.read(queryKey, chatThreadCopyKey(conversationId), () => resources.chat.messages(conversationId, undefined, CHAT_PAGE_SIZE)),
    initialPageParam: undefined,
    getNextPageParam: olderPageCursor,
    enabled: !!conversationId,
  });
}

// Sending a message: the outbox (core/chat useChatOutbox) keeps it in the offline queue first.

/** The shortest search the server runs. */
export const CHAT_SEARCH_MIN = 2;

/**
 * Messages containing the words (3b, as the website's SearchResults): in all of my conversations,
 * or in one — asked once typing pauses (250 ms), from two letters. Needs a connection.
 */
export function useChatSearch(q: string, conversationId?: string) {
  const { resources } = useServices();
  const term = useDebouncedValue(q.trim(), 250);
  const query = useQuery({
    queryKey: ['chat', 'search', conversationId ?? 'all', term],
    queryFn: () => resources.chat.search(term, conversationId),
    enabled: term.length >= CHAT_SEARCH_MIN,
    staleTime: 15_000,
  });
  return { query, term, waiting: q.trim().length >= CHAT_SEARCH_MIN && term !== q.trim() };
}
