import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServices } from './providers';
import { queueOnOffline, type Keyed } from './queries';
import { isNetworkError } from '../lib/api-client';
import { refresh } from '../lib/refresh';
import { afterMeetingSaved, afterPartChanged, dropRow, patchRow, putRow } from '../lib/meeting-cache';
import type { SaveRequest } from '../lib/meeting-form';
import type {
  ActionItemInput,
  ActionItemPatch,
  AgendaItemInput,
  AgendaItemPatch,
  ApiActionItem,
  ApiAgendaItem,
  ApiFinalMinutes,
  ApiMeeting,
  ApiMeetingAttendee,
  ApiMeetingNote,
  AttendanceStatus,
  AttendeeInput,
  AttendeePatch,
  FinalMinutesContent,
  MeetingStatus,
  NoteInput,
  NotePatch,
  NoteTaskInput,
  SeriesScope,
} from '../lib/types';

/**
 * Running a meeting (2b): every write the meeting screens make. Each shows the server's answer at
 * once (meeting-cache) and puts what else shows it out of date; the server's `meeting:*` event then
 * refreshes the part for everyone else. What is taken down in a meeting room — a note, an action
 * item, an agenda tick, attendance — is kept on this phone when there is no connection and sent
 * later (the sync queue); everything else needs a connection and says so.
 */

const part = (meetingId: string, name: string) => ['meeting', meetingId, name];

// ── The meeting itself ──────────────────────────────────────────────────────

/** Schedule a meeting, or save the form's changes (one meeting, or all upcoming of its series). */
export function useSaveMeeting() {
  const { resources } = useServices();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: Keyed<{ id?: string; request: Exclude<SaveRequest, { kind: 'none' }> }>) =>
      v.request.kind === 'create'
        ? resources.meetings.create(v.request.input, { idempotencyKey: v.idempotencyKey })
        : resources.meetings.update(v.id!, v.request.patch, v.request.scope),
    onSuccess: (saved, v) => afterMeetingSaved(qc, saved, { scope: v.request.kind === 'update' ? v.request.scope : undefined }),
  });
}

/** The meeting's own actions: start, end or schedule it, cancel it, copy it, delete it. Need a connection. */
export function useMeetingActions(meetingId: string) {
  const { resources } = useServices();
  const qc = useQueryClient();
  const setStatus = useMutation({
    mutationFn: (status: MeetingStatus) => resources.meetings.update(meetingId, { status }),
    onSuccess: (saved) => afterMeetingSaved(qc, saved, {}),
  });
  const cancel = useMutation({
    mutationFn: (scope: SeriesScope) => resources.meetings.cancel(meetingId, scope),
    onSuccess: (saved, scope) => afterMeetingSaved(qc, saved, { scope }),
  });
  const duplicate = useMutation({
    mutationFn: ({ idempotencyKey }: Keyed<object>) => resources.meetings.duplicate(meetingId, { idempotencyKey }),
    onSuccess: (copy) => afterMeetingSaved(qc, copy, {}),
  });
  // The screen closes first, then drops the meeting's data (afterMeetingDeleted).
  const remove = useMutation({ mutationFn: (scope: SeriesScope) => resources.meetings.remove(meetingId, scope) });
  return { setStatus, cancel, duplicate, remove };
}

// ── People and invitations ──────────────────────────────────────────────────

export function useAttendeeMutations(meetingId: string) {
  const { resources, queue, currentUserId } = useServices();
  const qc = useQueryClient();
  const key = part(meetingId, 'attendees');
  const changed = () => afterPartChanged(qc, meetingId, 'attendees');
  const add = useMutation({
    mutationFn: ({ input, idempotencyKey }: Keyed<{ input: AttendeeInput }>) => resources.meetings.addAttendee(meetingId, input, { idempotencyKey }),
    onSuccess: (row) => {
      putRow(qc, key, row);
      changed();
    },
  });
  const update = useMutation({
    mutationFn: ({ attendeeId, patch }: { attendeeId: string; patch: AttendeePatch }) => resources.meetings.updateAttendee(meetingId, attendeeId, patch),
    onSuccess: (row) => {
      if (row?.id) putRow(qc, key, row);
      changed();
    },
  });
  /** Attendance on the day: shown at once, and kept on this phone when offline. */
  const attendance = useMutation({
    mutationFn: ({ attendeeId, attendance: value }: { attendeeId: string; attendance: AttendanceStatus }) =>
      resources.meetings.updateAttendee(meetingId, attendeeId, { attendance: value }),
    onMutate: ({ attendeeId, attendance: value }) => ({ before: patchRow<ApiMeetingAttendee>(qc, key, attendeeId, { attendance: value }) }),
    onSuccess: (row) => {
      if (row?.id) putRow(qc, key, row);
    },
    onError: async (err, v, ctx) => {
      if (isNetworkError(err)) return queueOnOffline(queue, currentUserId(), err, 'meeting.attendance', { meetingId, attendeeId: v.attendeeId, attendance: v.attendance });
      if (ctx?.before) putRow(qc, key, ctx.before);
      refresh(qc, [{ queryKey: key, exact: true }]);
    },
  });
  const remove = useMutation({
    mutationFn: (attendeeId: string) => resources.meetings.removeAttendee(meetingId, attendeeId),
    onSuccess: (_r, attendeeId) => {
      dropRow(qc, key, attendeeId);
      changed();
    },
  });
  return { add, update, attendance, remove };
}

/** Who an invitation would go to — read fresh each time the sheet opens, never kept. */
export function useInvitePreview(meetingId: string, enabled: boolean) {
  const { resources } = useServices();
  return useQuery({ queryKey: part(meetingId, 'invite-preview'), queryFn: () => resources.meetings.previewInvites(meetingId), enabled, staleTime: 0, gcTime: 0 });
}

/** Send the invitations (a draft is scheduled first, as on the website). Needs a connection. */
export function useSendInvites(meeting: Pick<ApiMeeting, 'id' | 'status'>) {
  const { resources } = useServices();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (opts: { onlyNew?: boolean; resend?: boolean }) => {
      if (meeting.status === 'DRAFT') afterMeetingSaved(qc, await resources.meetings.update(meeting.id, { status: 'SCHEDULED' }), {});
      return resources.meetings.sendInvites(meeting.id, opts);
    },
    // Who was invited, and when invitations went out, changed.
    onSettled: () => refresh(qc, [{ queryKey: ['meeting', meeting.id], exact: true }, { queryKey: part(meeting.id, 'attendees'), exact: true }, { queryKey: ['meetings'], later: true }]),
  });
}

// ── The agenda ──────────────────────────────────────────────────────────────

export function useAgendaMutations(meetingId: string) {
  const { resources, queue, currentUserId } = useServices();
  const qc = useQueryClient();
  const key = part(meetingId, 'agenda');
  const add = useMutation({
    mutationFn: ({ input, idempotencyKey }: Keyed<{ input: AgendaItemInput }>) => resources.meetings.addAgendaItem(meetingId, input, { idempotencyKey }),
    onSuccess: (row) => putRow(qc, key, row),
  });
  const update = useMutation({
    mutationFn: ({ itemId, patch }: { itemId: string; patch: AgendaItemPatch }) => resources.meetings.updateAgendaItem(meetingId, itemId, patch),
    onSuccess: (row) => putRow(qc, key, row),
  });
  /** Covered or not: shown at once, and kept on this phone when offline. */
  const covered = useMutation({
    mutationFn: ({ itemId, completed }: { itemId: string; completed: boolean }) => resources.meetings.updateAgendaItem(meetingId, itemId, { completed }),
    onMutate: ({ itemId, completed }) => ({ before: patchRow<ApiAgendaItem>(qc, key, itemId, { completed }) }),
    onSuccess: (row) => putRow(qc, key, row),
    onError: async (err, v, ctx) => {
      if (isNetworkError(err)) return queueOnOffline(queue, currentUserId(), err, 'meeting.agenda.covered', { meetingId, itemId: v.itemId, completed: v.completed });
      if (ctx?.before) putRow(qc, key, ctx.before);
      refresh(qc, [{ queryKey: key, exact: true }]);
    },
  });
  /** A new order (every item's id, first to last): shown at once, the server's order after. */
  const reorder = useMutation({
    mutationFn: (orderedIds: string[]) => resources.meetings.reorderAgenda(meetingId, orderedIds),
    onMutate: (orderedIds) => {
      const before = qc.getQueryData<ApiAgendaItem[]>(key);
      if (before) qc.setQueryData(key, orderedIds.map((id) => before.find((i) => i.id === id)).filter(Boolean));
      return { before };
    },
    onSuccess: (list) => qc.setQueryData(key, list),
    onError: (_e, _v, ctx) => {
      if (ctx?.before) qc.setQueryData(key, ctx.before);
      refresh(qc, [{ queryKey: key, exact: true }]);
    },
  });
  const remove = useMutation({
    mutationFn: (itemId: string) => resources.meetings.removeAgendaItem(meetingId, itemId),
    onSuccess: (_r, itemId) => dropRow(qc, key, itemId),
  });
  return { add, update, covered, reorder, remove };
}

// ── Live notes ──────────────────────────────────────────────────────────────

export function useNoteMutations(meetingId: string) {
  const { resources, queue, currentUserId } = useServices();
  const qc = useQueryClient();
  const key = part(meetingId, 'notes');
  const changed = () => afterPartChanged(qc, meetingId, 'notes');
  /** A new note; offline it is kept on this phone and sent later (the same key, so never twice). */
  const add = useMutation({
    mutationFn: ({ input, idempotencyKey }: Keyed<{ input: NoteInput }>) => resources.meetings.addNote(meetingId, input, { idempotencyKey }),
    onSuccess: (row) => {
      putRow(qc, key, row);
      changed();
    },
    onError: (err, v) => queueOnOffline(queue, currentUserId(), err, 'meeting.note.add', { meetingId, ...v.input }, v.idempotencyKey),
  });
  const update = useMutation({
    mutationFn: ({ noteId, patch }: { noteId: string; patch: NotePatch }) => resources.meetings.updateNote(meetingId, noteId, patch),
    onSuccess: (row) => {
      putRow(qc, key, row);
      changed();
    },
  });
  const remove = useMutation({
    mutationFn: (noteId: string) => resources.meetings.removeNote(meetingId, noteId),
    onSuccess: (_r, noteId) => {
      dropRow(qc, key, noteId);
      changed();
    },
  });
  /** Undo a delete (for a few seconds after it). */
  const restore = useMutation({
    mutationFn: (noteId: string) => resources.meetings.restoreNote(meetingId, noteId),
    onSuccess: () => {
      refresh(qc, [{ queryKey: key, exact: true }]);
      changed();
    },
  });
  return { add, update, remove, restore };
}

/** ⭐ Make a board task from a note: the note shows its task, an action note its action item. Needs a connection. */
export function useNoteToTask(meetingId: string) {
  const { resources } = useServices();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ noteId, input, idempotencyKey }: Keyed<{ noteId: string; input: NoteTaskInput }>) => resources.meetings.noteToTask(meetingId, noteId, input, { idempotencyKey }),
    onSuccess: (res) => {
      if (res?.note) putRow<ApiMeetingNote>(qc, part(meetingId, 'notes'), res.note);
      if (res?.actionItem) putRow<ApiActionItem>(qc, part(meetingId, 'action-items'), { ...res.actionItem, taskKey: res.task.key });
      afterPartChanged(qc, meetingId, res?.actionItem ? 'action-items' : 'notes');
      // The new task: its board, and My Tasks (when it is mine) — fetched when next shown.
      if (res?.task) refresh(qc, [{ queryKey: ['tasks', 'project', res.task.projectId], later: true }, { queryKey: ['tasks', 'mine'], later: true }, { queryKey: ['project', res.task.projectId, 'progress'], later: true }]);
    },
  });
}

// ── Action items ────────────────────────────────────────────────────────────

export function useActionItemMutations(meetingId: string) {
  const { resources, queue, currentUserId } = useServices();
  const qc = useQueryClient();
  const key = part(meetingId, 'action-items');
  const changed = () => afterPartChanged(qc, meetingId, 'action-items');
  /** A new action item; offline it is kept on this phone and sent later. */
  const add = useMutation({
    mutationFn: ({ input, idempotencyKey }: Keyed<{ input: ActionItemInput }>) => resources.meetings.addActionItem(meetingId, input, { idempotencyKey }),
    onSuccess: (row) => {
      putRow(qc, key, row);
      changed();
    },
    onError: (err, v) => queueOnOffline(queue, currentUserId(), err, 'meeting.action.add', { meetingId, ...v.input }, v.idempotencyKey),
  });
  /** A change (its status, owner, due day, priority…): shown at once, and kept on this phone when offline. */
  const update = useMutation({
    mutationFn: ({ itemId, patch }: { itemId: string; patch: ActionItemPatch }) => resources.meetings.updateActionItem(itemId, patch),
    onMutate: ({ itemId, patch }) => ({ before: patchRow<ApiActionItem>(qc, key, itemId, patch as Partial<ApiActionItem>) }),
    onSuccess: (row) => {
      // The reply carries no task key: keep the one shown.
      const shown = qc.getQueryData<ApiActionItem[]>(key)?.find((i) => i.id === row.id);
      putRow(qc, key, { ...row, taskKey: row.taskKey ?? shown?.taskKey ?? null });
      changed();
    },
    onError: async (err, v, ctx) => {
      if (isNetworkError(err)) return queueOnOffline(queue, currentUserId(), err, 'meeting.action.update', { meetingId, id: v.itemId, patch: v.patch });
      if (ctx?.before) putRow(qc, key, ctx.before);
      refresh(qc, [{ queryKey: key, exact: true }]);
    },
  });
  const remove = useMutation({
    mutationFn: (itemId: string) => resources.meetings.removeActionItem(itemId),
    onSuccess: (_r, itemId) => {
      dropRow(qc, key, itemId);
      changed();
    },
  });
  return { add, update, remove };
}

// ── The final minutes (Final MOM) ───────────────────────────────────────────

export function useFinalMinutesMutations(meetingId: string) {
  const { resources } = useServices();
  const qc = useQueryClient();
  const key = part(meetingId, 'final-minutes');
  const settle = (next: ApiFinalMinutes) => {
    qc.setQueryData(key, next);
    // The lists' cards say how far the minutes are; the PDF and email open with final ones.
    refresh(qc, [{ queryKey: ['meetings'], later: true }, { projectMeetingsOf: meetingId }]);
  };
  /** A first draft to edit — by the AI (it may take up to three minutes) or from the notes. Not kept until saved. */
  const draft = useMutation({ mutationFn: (source: 'ai' | 'notes') => resources.meetings.draftFinalMinutes(meetingId, source) });
  const save = useMutation({ mutationFn: (content: FinalMinutesContent) => resources.meetings.saveFinalMinutes(meetingId, content), onSuccess: settle });
  const approve = useMutation({ mutationFn: (content: FinalMinutesContent) => resources.meetings.approveFinalMinutes(meetingId, content), onSuccess: settle });
  const reopen = useMutation({ mutationFn: () => resources.meetings.reopenFinalMinutes(meetingId), onSuccess: settle });
  return { draft, save, approve, reopen };
}

// ── The minutes email ───────────────────────────────────────────────────────

/** The minutes email as it would be sent — read fresh each time the sheet opens, never kept. */
export function useMinutesPreview(meetingId: string, enabled: boolean) {
  const { resources } = useServices();
  return useQuery({ queryKey: part(meetingId, 'minutes-preview'), queryFn: () => resources.meetings.previewMinutes(meetingId), enabled, staleTime: 0, gcTime: 0 });
}

export function useSendMinutes(meetingId: string) {
  const { resources } = useServices();
  return useMutation({ mutationFn: (recipients: string[] | undefined) => resources.meetings.sendMinutes(meetingId, recipients) });
}
