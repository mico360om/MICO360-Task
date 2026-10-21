import { useQuery, useQueries, useInfiniteQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useServices } from './providers';
import { ApiError, isNetworkError } from '../lib/api-client';
import { meetingWindow } from '../lib/meetings';
import { refetchAfterMove } from '../lib/task-status';
import { taskWrites, withExpectedVersion } from '../lib/task-writes';
import { afterTaskDeleted, afterTaskSaved, moveRefreshes } from '../lib/task-cache';
import { CHAT_DIRECTORY_COPY, CHAT_INBOX_COPY, chatMembersCopyKey, chatThreadCopyKey, projectTasksCopyKey, withoutOldDone } from '../lib/offline-copy';
import { blockerSearchParams } from '../lib/blocker-search';
import { refresh } from '../lib/refresh';
import { newIdempotencyKey } from '../lib/idempotency';
import { withoutOldMeetings } from '../lib/meeting-list';
import { withAnswer } from '../lib/meeting-detail';
import { findMeeting } from '../lib/meeting-screen';
import { answerFailed, answerScope } from '../lib/meeting-cache';
import { queueOnOffline, sendInOrder, type WriteOrderDeps } from '../lib/write-order';
import { CHAT_PAGE_SIZE, olderPageCursor, type ThreadPages } from '../lib/chat-thread';
import { threadKey } from '../lib/chat-cache';
import type { Services } from './services';
import type { ApiChatMessage, ApiMeetingAttendee, ApiTask, InvitationResponse } from '../lib/types';
import type { NotificationPreferences } from '../lib/notification-prefs';
import type { ReportFilters } from '../lib/reports';

/** Variables of a creating write, carrying the idempotency key minted for this user action (XP-06). */
export type Keyed<T> = T & { idempotencyKey: string };

/** Attach a fresh idempotency key to one user action — the online try and any offline replay share it. */
export function keyed<T extends object>(vars: T): Keyed<T> {
  return { ...vars, idempotencyKey: newIdempotencyKey() };
}

/** Keep a write that got no answer for later sync (lib/write-order); one already kept is not kept again. */
export { queueOnOffline };

/**
 * How this app's writes to an existing item are put in order (lib/write-order): kept behind an
 * older change to the same item still waiting on this phone, and kept here at once when they get
 * no answer.
 */
export function writeOrder(s: Pick<Services, 'queue' | 'currentUserId' | 'sync'>): WriteOrderDeps {
  return { queue: s.queue, userId: s.currentUserId, sync: () => void s.sync.trigger() };
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
  return useQuery({ queryKey: ['task', taskId], queryFn: () => resources.tasks.get(taskId) });
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

export function useProjectMembers(projectId: string) {
  const { resources } = useServices();
  return useQuery({
    queryKey: ['project', projectId, 'members'],
    queryFn: () => resources.projects.members(projectId),
    enabled: !!projectId,
  });
}

export function useTaskAssignees(taskId: string) {
  const { resources } = useServices();
  return useQuery({ queryKey: ['task', taskId, 'assignees'], queryFn: () => resources.tasks.assignees(taskId) });
}

/** A task's assignment changes go one after another (both hooks share it), so they reach the server in order. */
const assigneesScope = (taskId: string) => ({ id: `assignees:${taskId}` });

export function useAssignUsers(taskId: string) {
  const services = useServices();
  const { resources, queue, currentUserId } = services;
  const qc = useQueryClient();
  return useMutation({
    scope: assigneesScope(taskId),
    mutationFn: ({ userIds, idempotencyKey }: Keyed<{ userIds: string[] }>) =>
      sendInOrder(writeOrder(services), { kind: 'task.assign', payload: { id: taskId, userIds }, idempotencyKey }, () =>
        resources.tasks.assign(taskId, userIds, { idempotencyKey }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['task', taskId, 'assignees'] });
    },
    onError: (err, v) => queueOnOffline(queue, currentUserId(), err, 'task.assign', { id: taskId, userIds: v.userIds }, v.idempotencyKey),
  });
}

export function useUnassignUser(taskId: string) {
  const services = useServices();
  const { resources, queue, currentUserId } = services;
  const qc = useQueryClient();
  return useMutation({
    scope: assigneesScope(taskId),
    mutationFn: (userId: string) =>
      sendInOrder(writeOrder(services), { kind: 'task.unassign', payload: { id: taskId, userId } }, () => resources.tasks.unassign(taskId, userId)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['task', taskId, 'assignees'] });
    },
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
    mutationFn: ({ text, idempotencyKey }: Keyed<{ text: string }>) => resources.tasks.addChecklistItem(taskId, text, { idempotencyKey }),
    onSuccess: invalidate,
    onError: (err, v) => queueOnOffline(queue, currentUserId(), err, 'checklist.add', { id: taskId, text: v.text }, v.idempotencyKey),
  });
  const update = useMutation({
    // One task's subtask changes go one after another, so they reach the server in order.
    scope: { id: `checklist:${taskId}` },
    mutationFn: ({ itemId, patch }: { itemId: string; patch: { done?: boolean; text?: string } }) =>
      sendInOrder(writeOrder(services), { kind: 'checklist.update', payload: { id: taskId, itemId, patch } }, () => resources.tasks.updateChecklistItem(itemId, patch)),
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
  const { resources, queue, currentUserId } = useServices();
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['task', taskId, 'comments'] });
    void qc.invalidateQueries({ queryKey: ['task', taskId, 'activity'] });
  };
  const add = useMutation({
    mutationFn: ({ body, idempotencyKey }: Keyed<{ body: string }>) => resources.tasks.addComment(taskId, body, undefined, { idempotencyKey }),
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

/** Save preferences; the switch flips at once and snaps back if the server refuses. */
export function useSaveNotificationPreferences() {
  const { resources } = useServices();
  const qc = useQueryClient();
  const key = ['notifications', 'preferences'];
  return useMutation({
    mutationFn: (prefs: NotificationPreferences) => resources.notifications.setPreferences(prefs),
    onMutate: async (prefs) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<NotificationPreferences>(key);
      qc.setQueryData(key, prefs);
      return { previous };
    },
    onError: (_err, _prefs, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: key });
    },
  });
}

// ── Project details ──────────────────────────────────────────────────────────
export function useProject(projectId: string) {
  const { resources } = useServices();
  return useQuery({ queryKey: ['project', projectId, 'details'], queryFn: () => resources.projects.get(projectId), enabled: !!projectId });
}

// ── Project progress ─────────────────────────────────────────────────────────
export function useProjectProgress(projectId: string) {
  const { resources } = useServices();
  return useQuery({
    queryKey: ['project', projectId, 'progress'],
    queryFn: () => resources.projects.progress(projectId),
    enabled: !!projectId,
  });
}

// ── Meetings: the calendar and a project (reads) ─────────────────────────────
/** The meetings the calendar shows (a week back, two months ahead), kept for an offline start. */
export function useCalendarMeetings() {
  const { resources, reads } = useServices();
  return useQuery({
    queryKey: ['meetings', 'calendar'],
    queryFn: ({ queryKey }) => {
      const w = meetingWindow();
      return reads.read(queryKey, 'meetings.calendar', () => resources.meetings.range(w.from, w.to));
    },
  });
}

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

export function useMeetingAttendees(meetingId: string) {
  const { resources } = useServices();
  return useQuery({ queryKey: ['meeting', meetingId, 'attendees'], queryFn: () => resources.meetings.attendees(meetingId), enabled: !!meetingId });
}

export function useMeetingAgenda(meetingId: string) {
  const { resources } = useServices();
  return useQuery({ queryKey: ['meeting', meetingId, 'agenda'], queryFn: () => resources.meetings.agenda(meetingId), enabled: !!meetingId });
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
  const { resources } = useServices();
  const qc = useQueryClient();
  const key = ['meeting', meetingId, 'attendees'];
  return useMutation({
    scope: answerScope(meetingId),
    mutationFn: ({ attendeeId, response }: { attendeeId: string; response: InvitationResponse }) => resources.meetings.respond(meetingId, attendeeId, response),
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
  const { resources, reads } = useServices();
  return useQuery({
    queryKey: ['notifications'],
    queryFn: ({ queryKey }) => reads.read(queryKey, 'notifications', () => resources.notifications.list()),
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

export function useUnreadCount() {
  const { resources } = useServices();
  return useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => resources.notifications.unreadCount(),
  });
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
  const { resources, queue, currentUserId } = services;
  const qc = useQueryClient();
  const boardPrefix = ['tasks', 'project', projectId];
  return useMutation({
    // One task's writes go one after another, and the version its move made is remembered so the
    // next edit isn't refused as someone else's (task-writes). Inside that lane the move waits
    // behind an older change of the task still on this phone, and is kept here when it gets no
    // answer (write-order) — so a quick second move can't overtake the first. Its project goes
    // with it, so the replay refreshes that project's board days (refreshesAfterReplay).
    mutationFn: ({ id, columnId, position }: { id: string; columnId: string; position?: number }) =>
      taskWrites.run(id, () =>
        sendInOrder(writeOrder(services), { kind: 'task.move', payload: { id, columnId, position, projectId } }, async () => {
          const moved = await resources.tasks.move(id, columnId, position);
          taskWrites.note(id, moved?.version);
          return moved;
        }),
      ),
    // Optimistic move: the card jumps columns immediately, then we reconcile with the server.
    onMutate: async ({ id, columnId }) => {
      await qc.cancelQueries({ queryKey: boardPrefix });
      await qc.cancelQueries({ queryKey: ['task', id], exact: true });
      const boards = qc.getQueriesData<ApiTask[]>({ queryKey: boardPrefix });
      const detail = qc.getQueryData<ApiTask>(['task', id]);
      qc.setQueriesData<ApiTask[]>({ queryKey: boardPrefix }, (list) => list?.map((t) => (t.id === id ? { ...t, columnId } : t)));
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

/** What each edit was sent as (with its expectedVersion), so an edit made offline is queued the same. */
const sentEdits = new WeakMap<object, object>();

/**
 * Save an edit to a task. It is made against the newest version this phone knows (the loaded task's,
 * or the one its own last write made), so the server refuses it only when someone else changed the
 * task (VERSION_CONFLICT); the task's writes go one after another (task-writes).
 */
export function useUpdateTask(taskId: string) {
  const services = useServices();
  const { resources, queue, currentUserId } = services;
  const qc = useQueryClient();
  return useMutation({
    // In the task's lane, the edit waits behind an older change of the task still on this phone
    // (it then follows the version that one makes), and is kept here when it gets no answer.
    mutationFn: (patch: Partial<ApiTask> & { scope?: 'one' | 'series' }) =>
      taskWrites.run(taskId, async () => {
        const loaded = qc.getQueryData<ApiTask>(['task', taskId])?.version;
        const body = withExpectedVersion(patch, taskWrites.expectedVersion(taskId, loaded));
        sentEdits.set(patch, body);
        return sendInOrder(writeOrder(services), { kind: 'task.update', payload: { id: taskId, patch: body } }, async () => {
          const updated = await resources.tasks.update(taskId, body);
          taskWrites.note(taskId, updated?.version);
          return updated;
        });
      }),
    // The details show the saved task at once; only what the edit changed is fetched again (its
    // activity, the lists that show it, and the progress figures after a new due date).
    onSuccess: (saved, patch) => afterTaskSaved(qc, taskId, saved, patch),
    onError: (err, patch) => queueOnOffline(queue, currentUserId(), err, 'task.update', { id: taskId, patch: sentEdits.get(patch) ?? patch }),
  });
}

export function useMarkNotificationRead() {
  const { resources, queue, currentUserId } = useServices();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => resources.notifications.markRead(id),
    // Invalidates the list AND the unread badge (both live under ['notifications']).
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (err, id) => queueOnOffline(queue, currentUserId(), err, 'notification.read', { id }),
  });
}

// ── Reports (administrators) ────────────────────────────────────────────────
/** Everything the Reports screen shows, for the filters; always read fresh (no offline copy). */
export function useReports(filters: ReportFilters) {
  const { resources } = useServices();
  const scope = { projectId: filters.projectId, userId: filters.userId };
  return useQuery({
    queryKey: ['reports', filters],
    queryFn: async () => {
      const r = resources.reports;
      const [projects, status, workload, completion, series] = await Promise.all([
        r.projects(scope),
        r.status(scope),
        r.workload(scope),
        r.completion(scope).catch(() => null),
        r.timeseries(filters).catch(() => null),
      ]);
      return { projects, status, workload, completion, series };
    },
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
