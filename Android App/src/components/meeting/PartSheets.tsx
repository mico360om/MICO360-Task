import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Text, StyleSheet } from 'react-native';
import { useColors } from '../../core/theme';
import { keyed, useProjectMembers, useProjects } from '../../core/queries';
import { useActionItemMutations, useAgendaMutations, useAttendeeMutations, useNoteMutations, useNoteToTask } from '../../core/meeting-mutations';
import { isNetworkError } from '../../lib/api-client';
import { TextField, Button } from '../ui';
import { ActionRowButton, CheckRow, ChipChoice, InlinePicker, Sheet, SheetButtons, SheetMessage, type PickOption } from './sheet-kit';
import { ACTION_STATUS_LABELS, ANSWERS, ATTENDANCE_LABELS, RESPONSE_LABELS, attendeeName, noteTypeLabel } from '../../lib/meeting-detail';
import {
  ATTENDANCE_CHOICES,
  NOTE_TYPES,
  PRIORITIES,
  PRIORITY_LABELS,
  addablePeople,
  attendeeAddFailure,
  dueDayToIso,
  guestProblem,
  moveAgenda,
  noteEditStart,
  notePlaceholder,
  noteTaskFailure,
  noteTaskTitle,
  parseAgendaMinutes,
  personFlags,
} from '../../lib/meeting-parts';
import { meetingFailure } from '../../lib/meeting-flow';
import { keptTryText, pendingKeys, tryName } from '../../lib/pending-keys';
import { parseDueDateInput } from '../../lib/form-input';
import { dueDayKey } from '../../lib/due-date';
import { displayName } from '../../lib/types';
import { spacing, fontSize } from '../../lib/theme';
import type {
  ActionItemPatch,
  ActionItemStatus,
  ApiActionItem,
  ApiAgendaItem,
  ApiDirectoryUser,
  ApiMeeting,
  ApiMeetingAttendee,
  ApiMeetingNote,
  AttendanceStatus,
  AttendeeRole,
  InvitationResponse,
  MeetingNoteType,
  NoteTaskResult,
  Priority,
} from '../../lib/types';

type NameOf = (userId: string) => string | null;

/** The team as choices: "Unassigned" (or "No presenter") first, then everyone by name. */
export function peopleOptions(directory: ApiDirectoryUser[], emptyLabel?: string): PickOption[] {
  const people = [...directory].sort((a, b) => displayName(a).localeCompare(displayName(b))).map((u) => ({ value: u.id, label: displayName(u), hint: `@${u.username}` }));
  return emptyLabel ? [{ value: '', label: emptyLabel }, ...people] : people;
}

const ROLES: { value: AttendeeRole; label: string }[] = [
  { value: 'REQUIRED', label: 'Required' },
  { value: 'OPTIONAL', label: 'Optional' },
];

// ── People ──────────────────────────────────────────────────────────────────

/** Add a team member or a guest (name, and an email for the invitation), required or optional. */
export function AddPersonSheet({ meetingId, attendees, directory, visible, onClose }: { meetingId: string; attendees: ApiMeetingAttendee[]; directory: ApiDirectoryUser[]; visible: boolean; onClose: () => void }) {
  const { add } = useAttendeeMutations(meetingId);
  const [mode, setMode] = useState<'member' | 'guest'>('member');
  const [userId, setUserId] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AttendeeRole>('REQUIRED');
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  useEffect(() => {
    if (visible) return;
    setUserId('');
    setName('');
    setEmail('');
    setError(null);
    setAdded(null);
  }, [visible]);
  const options = useMemo(() => peopleOptions(addablePeople(directory, attendees)), [directory, attendees]);

  const submit = () => {
    setError(null);
    setAdded(null);
    if (mode === 'member' && !userId) return setError('Choose a person to add.');
    if (mode === 'guest') {
      const problem = guestProblem(name, email, attendees);
      if (problem) return setError(problem);
    }
    const input = mode === 'member' ? { userId, role } : { externalName: name.trim(), externalEmail: email.trim() || null, role };
    const who = mode === 'member' ? options.find((o) => o.value === userId)?.label ?? 'The person' : name.trim();
    // A try that got no answer keeps its key, so tapping again can't add them twice (pending-keys).
    const what = tryName('attendee', meetingId, input);
    add.mutate({ input, idempotencyKey: pendingKeys.keyFor(what) }, {
      onSuccess: () => {
        pendingKeys.settle(what);
        setAdded(`${who} was added.`);
        setUserId('');
        setName('');
        setEmail('');
      },
      onError: (e) => {
        pendingKeys.settle(what, e);
        setError(attendeeAddFailure(e, mode));
      },
    });
  };

  return (
    <Sheet
      visible={visible}
      title="Add people"
      onClose={onClose}
      footer={<SheetButtons cancel="Done" onCancel={onClose} confirm="Add attendee" onConfirm={submit} busy={add.isPending} />}
    >
      <ChipChoice<'member' | 'guest'>
        label="Add"
        options={[
          { value: 'member', label: 'Team member' },
          { value: 'guest', label: 'Guest' },
        ]}
        value={mode}
        onChange={(m) => {
          setMode(m);
          setError(null);
        }}
      />
      {mode === 'member' ? (
        <InlinePicker label="Team member" options={options} value={userId} onChange={setUserId} placeholder="Choose a person" emptyText="Everyone is already on the list." />
      ) : (
        <>
          <TextField label="Guest name" required value={name} onChangeText={setName} placeholder="Guest name" />
          <TextField label="Guest email" value={email} onChangeText={setEmail} placeholder="Email (for the invitation)" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
        </>
      )}
      <ChipChoice<AttendeeRole> label="Role" options={ROLES} value={role} onChange={setRole} />
      <SheetMessage text={error} />
      <SheetMessage text={added} tone="success" />
    </Sheet>
  );
}

/**
 * One person on the meeting: their role and a guest's emailed answer (whoever runs the meeting),
 * attendance once it is under way (them too, for their own), and taking them off the list.
 */
export function PersonSheet({
  meeting,
  attendee,
  nameOf,
  canEdit,
  myId,
  onClose,
}: {
  meeting: ApiMeeting;
  attendee: ApiMeetingAttendee | null;
  nameOf: NameOf;
  canEdit: boolean;
  myId: string | null;
  onClose: () => void;
}) {
  const { update, attendance, remove } = useAttendeeMutations(meeting.id);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);
  useEffect(() => {
    setError(null);
    setQueued(false);
  }, [attendee?.id]);
  if (!attendee) return null;
  const name = attendeeName(attendee, nameOf);
  const own = !!attendee.userId && attendee.userId === myId;
  const attendanceTime = meeting.status === 'IN_PROGRESS' || meeting.status === 'COMPLETED';
  const flags = personFlags(attendee, meeting);
  const response = attendee.response ?? 'PENDING';
  const failed = (fallback: string) => (e: unknown) => setError(meetingFailure(e, fallback));

  const confirmRemove = () =>
    Alert.alert(`Remove ${name}?`, 'They are taken off this meeting (and its later meetings, in a series).', [
      { text: 'Keep', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => remove.mutate(attendee.id, { onSuccess: onClose, onError: failed('Couldn’t remove the attendee.') }) },
    ]);

  return (
    <Sheet visible title={name} subtitle={[attendee.externalEmail, flags.notInvited ? 'Not invited yet' : null, flags.noEmail ? 'No email address' : null].filter(Boolean).join(' · ') || null} onClose={onClose} footer={<SheetButtons cancel="Done" onCancel={onClose} />}>
      {canEdit ? (
        <ChipChoice<AttendeeRole> label="Role" options={ROLES} value={attendee.role} onChange={(role) => update.mutate({ attendeeId: attendee.id, patch: { role } }, { onError: failed('Couldn’t save the change.') })} disabled={update.isPending} />
      ) : null}
      {canEdit && !attendee.userId ? (
        <ChipChoice<InvitationResponse>
          label="Their answer (from their email)"
          options={[...ANSWERS.map((a) => ({ value: a.value as InvitationResponse, label: RESPONSE_LABELS[a.value] })), { value: 'PENDING' as InvitationResponse, label: RESPONSE_LABELS.PENDING }]}
          value={response}
          onChange={(r) => update.mutate({ attendeeId: attendee.id, patch: { response: r } }, { onError: failed('Couldn’t save the change.') })}
          disabled={update.isPending}
        />
      ) : null}
      {attendanceTime && (canEdit || own) ? (
        <ChipChoice<AttendanceStatus>
          label="Attendance"
          options={ATTENDANCE_CHOICES.map((a) => ({ value: a, label: ATTENDANCE_LABELS[a] }))}
          value={attendee.attendance}
          onChange={(value) => {
            setError(null);
            setQueued(false);
            attendance.mutate(
              { attendeeId: attendee.id, attendance: value },
              { onError: (e) => (isNetworkError(e) ? setQueued(true) : setError(meetingFailure(e, 'Couldn’t save the change.'))) },
            );
          }}
        />
      ) : null}
      {!canEdit && !(attendanceTime && own) ? <SheetMessage text="Only the organizer, the project manager or an admin can change the people." tone="info" /> : null}
      {canEdit ? <ActionRowButton label={`Remove ${name}`} danger onPress={confirmRemove} busy={remove.isPending} /> : null}
      <SheetMessage text={queued ? 'Saved on this phone — will sync when you’re online.' : null} tone="info" />
      <SheetMessage text={error} />
    </Sheet>
  );
}

// ── The agenda ──────────────────────────────────────────────────────────────

/** Add an agenda item, or edit one (title, presenter, minutes), move it or remove it. */
export function AgendaItemSheet({
  meetingId,
  items,
  item,
  directory,
  visible,
  onClose,
}: {
  meetingId: string;
  items: ApiAgendaItem[];
  /** null: a new item. */
  item: ApiAgendaItem | null;
  directory: ApiDirectoryUser[];
  visible: boolean;
  onClose: () => void;
}) {
  const { add, update, reorder, remove } = useAgendaMutations(meetingId);
  const [title, setTitle] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [minutes, setMinutes] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!visible) return;
    setTitle(item?.title ?? '');
    setOwnerId(item?.ownerId ?? '');
    setMinutes(item?.expectedMinutes != null ? String(item.expectedMinutes) : '');
    setError(null);
    // A fresh copy of the same item (a live update) doesn't wipe what is being typed.
  }, [visible, item?.id]);
  const people = useMemo(() => peopleOptions(directory, 'No presenter'), [directory]);
  const index = item ? items.findIndex((i) => i.id === item.id) : -1;
  const busy = add.isPending || update.isPending || reorder.isPending || remove.isPending;

  const submit = () => {
    setError(null);
    if (!title.trim()) return setError(item ? 'An agenda item needs a title.' : 'Enter an agenda item.');
    const m = parseAgendaMinutes(minutes);
    if (!m.ok) return setError(m.error);
    const input = { title: title.trim(), ownerId: ownerId || null, expectedMinutes: m.value };
    if (item) {
      update.mutate({ itemId: item.id, patch: input }, { onSuccess: onClose, onError: (e) => setError(meetingFailure(e, 'Couldn’t save the agenda item.')) });
      return;
    }
    // A try that got no answer keeps its key, so tapping Add again can't add it twice (pending-keys).
    const what = tryName('agenda', meetingId, input);
    add.mutate(
      { input, idempotencyKey: pendingKeys.keyFor(what) },
      {
        onSuccess: () => {
          pendingKeys.settle(what);
          onClose();
        },
        onError: (e) => {
          pendingKeys.settle(what, e);
          setError(keptTryText(e, 'Couldn’t add the agenda item.', 'Add', meetingFailure));
        },
      },
    );
  };
  const move = (dir: -1 | 1) => {
    const ids = moveAgenda(items, index, dir);
    if (ids) reorder.mutate(ids, { onSuccess: onClose, onError: (e) => setError(meetingFailure(e, 'Couldn’t reorder the agenda.')) });
  };
  const confirmRemove = () =>
    Alert.alert('Remove this agenda item?', item?.title ?? '', [
      { text: 'Keep', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => item && remove.mutate(item.id, { onSuccess: onClose, onError: (e) => setError(meetingFailure(e, 'Couldn’t delete the agenda item.')) }) },
    ]);

  return (
    <Sheet
      visible={visible}
      title={item ? 'Agenda item' : 'Add a topic'}
      onClose={onClose}
      footer={<SheetButtons onCancel={onClose} confirm={item ? 'Save' : 'Add'} onConfirm={submit} busy={add.isPending || update.isPending} disabled={busy} />}
    >
      <TextField label="Topic" required value={title} onChangeText={setTitle} placeholder="Add a topic…" autoFocus={!item} />
      <InlinePicker label="Presenter" options={people} value={ownerId} onChange={setOwnerId} placeholder="No presenter" />
      <TextField label="Planned minutes" value={minutes} onChangeText={setMinutes} placeholder="min" keyboardType="number-pad" maxLength={3} />
      {item ? (
        <>
          <ActionRowButton label="Move up" onPress={() => move(-1)} busy={reorder.isPending} disabled={index <= 0} hint={index <= 0 ? 'It is already first' : undefined} />
          <ActionRowButton label="Move down" onPress={() => move(1)} busy={reorder.isPending} disabled={index >= items.length - 1} hint={index >= items.length - 1 ? 'It is already last' : undefined} />
          <ActionRowButton label="Remove from the agenda" danger onPress={confirmRemove} busy={remove.isPending} />
        </>
      ) : null}
      <SheetMessage text={error} />
    </Sheet>
  );
}

// ── Live notes ──────────────────────────────────────────────────────────────

/**
 * Write a note — its category, its words, a key point — or change your own. The phone writes
 * plain text; a formatted note from the website opens as its words, and saving it here drops the
 * formatting (it says so). A new note made offline is kept on this phone and sent later.
 */
export function NoteSheet({ meetingId, note, visible, onClose }: { meetingId: string; note: ApiMeetingNote | null; visible: boolean; onClose: () => void }) {
  const c = useColors();
  const { add, update } = useNoteMutations(meetingId);
  const [type, setType] = useState<MeetingNoteType>('DISCUSSION');
  const [body, setBody] = useState('');
  const [key, setKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);
  const start = note ? noteEditStart(note) : null;
  useEffect(() => {
    if (!visible) return;
    setType(note?.type ?? 'DISCUSSION');
    setBody(note ? noteEditStart(note).text : '');
    setKey(note?.highlighted ?? false);
    setError(null);
    setQueued(false);
  }, [visible, note?.id]);

  const submit = () => {
    setError(null);
    setQueued(false);
    if (!body.trim()) return setError(note ? 'A note can’t be empty.' : 'Write the note first.');
    if (note) {
      update.mutate(
        { noteId: note.id, patch: { body: body.trim(), format: 'PLAIN', type } },
        { onSuccess: onClose, onError: (e) => setError(meetingFailure(e, 'Couldn’t save your changes — they’re still here, so you can try again.')) },
      );
      return;
    }
    // The words stay until the server (or this phone's queue) has them, so nothing is lost.
    add.mutate(keyed({ input: { body: body.trim(), format: 'PLAIN' as const, type, highlighted: key } }), {
      onSuccess: () => {
        setBody('');
        setKey(false);
        onClose();
      },
      onError: (e) => {
        if (isNetworkError(e)) {
          setBody('');
          setKey(false);
          setQueued(true);
        } else setError(meetingFailure(e, 'Couldn’t save the note — it’s still here, so you can try again.'));
      },
    });
  };

  return (
    <Sheet
      visible={visible}
      title={note ? 'Edit note' : 'Add a note'}
      onClose={onClose}
      footer={<SheetButtons cancel={queued ? 'Done' : 'Cancel'} onCancel={onClose} confirm={note ? 'Save' : 'Add note'} onConfirm={submit} busy={add.isPending || update.isPending} />}
    >
      <ChipChoice<MeetingNoteType> label="Category" options={NOTE_TYPES.map((t) => ({ value: t, label: noteTypeLabel(t) }))} value={type} onChange={setType} />
      <TextField accessibilityLabel={note ? 'Edit note' : 'New note'} value={body} onChangeText={setBody} placeholder={notePlaceholder(type)} multiline style={styles.multiline} autoFocus />
      {start?.formatted ? <SheetMessage text="This note was formatted on the website. Saving here keeps its words but not its formatting (bold, lists, links)." tone="info" /> : null}
      {!note ? <CheckRow label="Mark as a key point" checked={key} onChange={setKey} /> : null}
      <SheetMessage text={queued ? 'Saved on this phone — the note is added when you’re online.' : null} tone="info" />
      <SheetMessage text={error} />
      <Text style={[styles.small, { color: c.ink3 }]}>Notes from the phone are plain text.</Text>
    </Sheet>
  );
}

/** ⭐ Make a board task from a note: its title, project, priority, due date and who does it. Needs a connection. */
export function NoteTaskSheet({
  meetingId,
  meetingProjectId,
  note,
  onClose,
  onOpenTask,
}: {
  meetingId: string;
  meetingProjectId: string | null;
  note: ApiMeetingNote | null;
  onClose: () => void;
  onOpenTask: (taskId: string) => void;
}) {
  const make = useNoteToTask(meetingId);
  const projectsQ = useProjects();
  const [title, setTitle] = useState('');
  const [projectId, setProjectId] = useState('');
  const [priority, setPriority] = useState<Priority>('NORMAL');
  const [due, setDue] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<NoteTaskResult | null>(null);
  const membersQ = useProjectMembers(projectId);
  useEffect(() => {
    if (!note) return;
    setTitle(noteTaskTitle(note));
    setProjectId(meetingProjectId ?? '');
    setPriority('NORMAL');
    setDue('');
    setAssigneeId('');
    setError(null);
    setCreated(null);
  }, [note?.id, meetingProjectId]);
  const projects = useMemo(() => [...(projectsQ.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({ value: p.id, label: p.name, hint: p.code })), [projectsQ.data]);
  const members = useMemo(() => [{ value: '', label: 'Unassigned' }, ...(projectId ? membersQ.data ?? [] : []).map((u) => ({ value: u.id, label: displayName(u), hint: `@${u.username}` }))], [projectId, membersQ.data]);
  if (!note) return null;

  const submit = () => {
    setError(null);
    if (!title.trim()) return setError('Give the task a title.');
    if (!projectId) return setError('Choose a project for this task.');
    const d = parseDueDateInput(due);
    if (!d.ok) return setError(d.error);
    const input = { title: title.trim(), projectId, priority, dueDate: d.value, assigneeId: assigneeId || null };
    // A try that got no answer keeps its key, so tapping again can't make a second task (pending-keys).
    const what = tryName('note-task', meetingId, note.id, input);
    make.mutate({ noteId: note.id, input, idempotencyKey: pendingKeys.keyFor(what) }, {
      onSuccess: (res) => {
        pendingKeys.settle(what);
        setCreated(res);
      },
      onError: (e) => {
        pendingKeys.settle(what, e);
        setError(noteTaskFailure(e).text);
      },
    });
  };

  return (
    <Sheet
      visible
      title="⭐ Create task from note"
      subtitle={`${noteTypeLabel(note.type)}: ${noteEditStart(note).text.slice(0, 160)}`}
      onClose={onClose}
      footer={
        created ? (
          <>
            <SheetButtons cancel="Done" onCancel={onClose} />
            <Button
              title="Open task"
              onPress={() => {
                onClose();
                onOpenTask(created.task.id);
              }}
              style={styles.grow}
            />
          </>
        ) : (
          <SheetButtons onCancel={onClose} confirm={make.isPending ? 'Creating…' : 'Create task'} onConfirm={submit} busy={make.isPending} />
        )
      }
    >
      {created ? (
        <>
          <SheetMessage text={`Task ${created.task.key} created — “${created.task.title}”.`} tone="success" />
          {created.actionItem ? <SheetMessage text="It’s also on the meeting’s action items, linked to the task — no need to add it again." tone="info" /> : null}
          {created.actionItemError ? <SheetMessage text={created.actionItemError} tone="info" /> : null}
          {created.assigneeError ? <SheetMessage text={`It couldn’t be assigned: ${created.assigneeError} Assign someone from the task instead.`} /> : null}
        </>
      ) : (
        <>
          <TextField label="Title" required value={title} onChangeText={setTitle} maxLength={191} />
          <InlinePicker
            label="Project *"
            options={projects}
            value={projectId}
            onChange={(v) => {
              setProjectId(v);
              setAssigneeId(''); // the old choice may not be on the new project
            }}
            placeholder="Choose a project…"
          />
          {!meetingProjectId ? <SheetMessage text="This is a standalone meeting — pick a board for the task." tone="info" /> : null}
          <ChipChoice<Priority> label="Priority" options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))} value={priority} onChange={setPriority} />
          <TextField label="Due date" value={due} onChangeText={setDue} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" maxLength={10} />
          <InlinePicker label="Assignee" options={members} value={assigneeId} onChange={setAssigneeId} placeholder="Unassigned" disabled={!projectId} />
          {!projectId ? <SheetMessage text="Choose a project to pick someone from its team." tone="info" /> : null}
          <SheetMessage text={error} />
        </>
      )}
    </Sheet>
  );
}

// ── Action items ────────────────────────────────────────────────────────────

const STATUSES: ActionItemStatus[] = ['OPEN', 'IN_PROGRESS', 'PENDING', 'COMPLETED', 'CANCELLED'];

/**
 * Add an action item, or change one: what, who, by when, how urgent and where it stands; remove
 * it. Made or changed offline, it is kept on this phone and sent later.
 */
export function ActionItemSheet({
  meetingId,
  item,
  directory,
  canRemove,
  visible,
  onClose,
  onOpenTask,
}: {
  meetingId: string;
  /** null: a new item. */
  item: ApiActionItem | null;
  directory: ApiDirectoryUser[];
  canRemove: boolean;
  visible: boolean;
  onClose: () => void;
  onOpenTask: (taskId: string) => void;
}) {
  const { add, update, remove } = useActionItemMutations(meetingId);
  const [description, setDescription] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [due, setDue] = useState('');
  const [priority, setPriority] = useState<Priority>('NORMAL');
  const [status, setStatus] = useState<ActionItemStatus>('OPEN');
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);
  useEffect(() => {
    if (!visible) return;
    setDescription(item?.description ?? '');
    setAssigneeId(item?.assigneeId ?? '');
    setDue(item ? dueDayKey(item.dueDate) ?? '' : '');
    setPriority(item?.priority ?? 'NORMAL');
    setStatus(item?.status ?? 'OPEN');
    setError(null);
    setQueued(false);
  }, [visible, item?.id]);
  const people = useMemo(() => peopleOptions(directory, 'Unassigned'), [directory]);

  const failedOrQueued = (fallback: string) => (e: unknown) => {
    if (isNetworkError(e)) setQueued(true);
    else setError(meetingFailure(e, fallback));
  };
  const submit = () => {
    setError(null);
    setQueued(false);
    if (!description.trim()) return setError('Describe the action item.');
    const d = parseDueDateInput(due);
    if (!d.ok) return setError(d.error);
    const dueDate = dueDayToIso(d.value);
    if (!item) {
      add.mutate(keyed({ input: { description: description.trim(), assigneeId: assigneeId || null, dueDate, priority } }), {
        onSuccess: onClose,
        onError: (e) => {
          failedOrQueued('Couldn’t add the action item.')(e);
          // Kept on this phone: the form empties, so another tap can't add it twice.
          if (isNetworkError(e)) {
            setDescription('');
            setAssigneeId('');
            setDue('');
            setPriority('NORMAL');
          }
        },
      });
      return;
    }
    // Only what changed is sent.
    const patch: ActionItemPatch = {};
    if (description.trim() !== item.description) patch.description = description.trim();
    if ((assigneeId || null) !== item.assigneeId) patch.assigneeId = assigneeId || null;
    if (d.value !== dueDayKey(item.dueDate)) patch.dueDate = dueDate;
    if (priority !== item.priority) patch.priority = priority;
    if (status !== item.status) patch.status = status;
    if (Object.keys(patch).length === 0) return onClose();
    update.mutate({ itemId: item.id, patch }, { onSuccess: onClose, onError: failedOrQueued('Couldn’t save the change to the action item.') });
  };
  const confirmRemove = () =>
    Alert.alert('Remove this action item?', item?.description ?? '', [
      { text: 'Keep', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => item && remove.mutate(item.id, { onSuccess: onClose, onError: (e) => setError(meetingFailure(e, 'Couldn’t delete the action item.')) }) },
    ]);

  return (
    <Sheet
      visible={visible}
      title={item ? 'Action item' : 'Add an action item'}
      onClose={onClose}
      footer={<SheetButtons cancel={queued ? 'Done' : 'Cancel'} onCancel={onClose} confirm={item ? 'Save' : 'Add'} onConfirm={submit} busy={add.isPending || update.isPending} />}
    >
      <TextField label="What needs to be done?" required value={description} onChangeText={setDescription} placeholder="What needs to be done?" multiline style={styles.multiline} autoFocus={!item} />
      <InlinePicker label="Owner" options={people} value={assigneeId} onChange={setAssigneeId} placeholder="Unassigned" />
      <TextField label="Due date" value={due} onChangeText={setDue} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" maxLength={10} />
      <ChipChoice<Priority> label="Priority" options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))} value={priority} onChange={setPriority} />
      {item ? <ChipChoice<ActionItemStatus> label="Status" options={STATUSES.map((st) => ({ value: st, label: ACTION_STATUS_LABELS[st] }))} value={status} onChange={setStatus} /> : null}
      {item?.taskId ? (
        <ActionRowButton
          label={`Open the linked task${item.taskKey ? ` ${item.taskKey}` : ''}`}
          onPress={() => {
            onClose();
            onOpenTask(item.taskId!);
          }}
        />
      ) : null}
      {item && canRemove ? <ActionRowButton label="Remove this action item" danger onPress={confirmRemove} busy={remove.isPending} /> : null}
      <SheetMessage text={queued ? 'Saved on this phone — will sync when you’re online.' : null} tone="info" />
      <SheetMessage text={error} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  multiline: { minHeight: 96, paddingTop: spacing.sm, textAlignVertical: 'top' },
  small: { fontSize: fontSize.xs },
  grow: { flex: 1 },
});

