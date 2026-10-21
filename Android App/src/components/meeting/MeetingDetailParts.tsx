import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useColors } from '../../core/theme';
import { Badge, Button } from '../ui';
import { Chip } from '../task-detail/kit';
import { NoteBody } from './NoteBody';
import { spacing, radius, fontSize, type Palette } from '../../lib/theme';
import { toneStyle } from '../../lib/tone';
import { recurrenceSummary } from '../../lib/recurrence-summary';
import { isRepeating, joinLink } from '../../lib/meetings';
import { isUnderWay } from '../../lib/meeting-list';
import {
  actionStatusLabel,
  ANSWERS,
  attendanceLabel,
  meetingStatusLabel,
  noteTypeLabel,
  responseLabel,
  actionDueText,
  actionStatusTone,
  agendaItemLine,
  approvedLine,
  attendeeName,
  finalMinutesNote,
  isActionItemOverdue,
  meetingStatusTone,
  meetingWhen,
  myAnswerText,
  noteMeta,
  noteTypeTone,
  responseTone,
} from '../../lib/meeting-detail';
import { noteFilters, type NoteFilter } from '../../lib/meeting-screen';
import type { ApiActionItem, ApiAgendaItem, ApiFinalMinutes, ApiMeeting, ApiMeetingAttendee, ApiMeetingNote, InvitationResponse } from '../../lib/types';

type NameOf = (userId: string) => string | null;

export function useDetailStyles() {
  const c = useColors();
  return useMemo(() => makeStyles(c), [c]);
}

/** The meeting at a glance: status, title, when and where, the organizer, and Join for an online one. */
export function MeetingHeaderCard({
  meeting: m,
  projectName,
  nameOf,
  timeZone,
  now,
  onJoin,
  primary,
  onMore,
}: {
  meeting: ApiMeeting;
  projectName: string | null;
  nameOf: NameOf;
  timeZone: string;
  now: Date;
  onJoin: (href: string) => void;
  /** The next step for the meeting's status (Send invitations, Start, End, Email minutes…). */
  primary?: { label: string; onPress: () => void; busy?: boolean } | null;
  /** The meeting's other actions. */
  onMore?: (() => void) | null;
}) {
  const s = useDetailStyles();
  // As on the website: the meeting's own zone, else the company's.
  const zone = m.timeZone || timeZone;
  const when = meetingWhen(m, zone);
  const cancelled = m.status === 'CANCELLED';
  const join = cancelled ? null : joinLink(m);
  const organizer = nameOf(m.organizerId);
  const repeat = m.series ? recurrenceSummary(m.series.rule) : m.recurrenceRule ? recurrenceSummary(m.recurrenceRule) : isRepeating(m) ? 'Part of a repeating series' : null;
  const invites = m.invitesSentAt ? `Invitations sent ${meetingWhen({ startAt: m.invitesSentAt, endAt: null }, timeZone).day}` : !cancelled && m.status !== 'COMPLETED' ? 'Invitations not sent yet' : null;
  const fact = (icon: string, text: string, label?: string) => (
    <Text style={s.fact} accessibilityLabel={label ?? text}>
      <Text importantForAccessibility="no">{icon} </Text>
      {text}
    </Text>
  );
  return (
    <View style={s.card}>
      <View style={s.badges}>
        <Badge label={meetingStatusLabel(m.status)} tone={meetingStatusTone(m.status)} />
        {isUnderWay(m, now) ? <Badge label="Under way" tone="brand" /> : null}
        {invites ? <Text style={s.small}>{invites}</Text> : null}
      </View>
      <Text style={[s.title, cancelled && s.struck]} accessibilityRole="header">
        {m.title}
      </Text>
      <View style={s.facts}>
        {fact('🗂', projectName ?? (m.projectId ? 'Project' : 'Standalone meeting'))}
        {fact('📅', when.day)}
        {fact('🕒', when.time, `${when.time}, ${zone} time`)}
        {fact('🌐', zone, `Time zone: ${zone}`)}
        {repeat ? fact('🔁', repeat) : null}
        {m.location?.trim() ? fact('📍', m.location.trim()) : null}
        {fact('👤', `Organizer: ${organizer ?? '—'}`)}
      </View>
      {join ? <Button title="Join online" accessibilityLabel={`Join ${m.title} online`} onPress={() => onJoin(join)} style={s.join} /> : null}
      {primary || onMore ? (
        <View style={s.actions}>
          {primary ? <Button title={primary.label} onPress={primary.onPress} loading={primary.busy} variant={join ? 'secondary' : 'primary'} style={s.flex} /> : null}
          {onMore ? <Button title="More…" accessibilityLabel="More meeting actions" variant="secondary" onPress={onMore} style={primary ? s.more : s.flex} /> : null}
        </View>
      ) : null}
    </View>
  );
}

/** "Going?" — Accept, Maybe or Decline your own invitation; tapping your answer takes it back. */
export function RsvpCard({
  response,
  busy,
  error,
  onAnswer,
}: {
  response: InvitationResponse | undefined;
  busy: boolean;
  error: string | null;
  onAnswer: (r: InvitationResponse) => void;
}) {
  const s = useDetailStyles();
  return (
    <View style={s.card}>
      <Text style={s.sectionTitle} accessibilityRole="header">
        GOING?
      </Text>
      <View style={s.answers} accessibilityRole="radiogroup" accessibilityLabel="Your answer to the invitation">
        {ANSWERS.map((a) => (
          <Chip
            key={a.value}
            label={a.label}
            selected={response === a.value}
            disabled={busy}
            onPress={() => onAnswer(a.value)}
            a11yLabel={response === a.value ? `${a.label}, your answer — tap to take it back` : `${a.label} the invitation`}
          />
        ))}
        {busy ? <ActivityIndicator size="small" /> : null}
      </View>
      <Text style={s.muted} accessibilityLiveRegion="polite">
        {myAnswerText(response)}
      </Text>
      {error ? (
        <Text style={s.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/** What the meeting is about, its category and who created it. */
export function AboutCard({ meeting: m, nameOf }: { meeting: ApiMeeting; nameOf: NameOf }) {
  const s = useDetailStyles();
  const description = m.description?.trim();
  const createdBy = m.createdById ? nameOf(m.createdById) : null;
  return (
    <View style={s.card}>
      <Text style={s.sectionTitle} accessibilityRole="header">
        ABOUT
      </Text>
      {description ? <Text style={s.body}>{description}</Text> : <Text style={s.muted}>No description.</Text>}
      {m.category ? <Text style={s.small}>Category: {m.category}</Text> : null}
      {createdBy ? <Text style={s.small}>Created by {createdBy}</Text> : null}
    </View>
  );
}

/** Where a row sits in its section card (the title opens it, the last row closes it). */
export type RowPlace = { first?: boolean; last?: boolean };

/** A row inside a section card. */
export function SectionRow({ place, children }: { place: RowPlace; children: React.ReactNode }) {
  const s = useDetailStyles();
  return <View style={[s.row, place.first && s.rowFirst, place.last && s.rowLast]}>{children}</View>;
}

export function SectionTitleRow({
  title,
  count,
  aside,
  action,
}: {
  title: string;
  count?: string;
  aside?: string | null;
  /** "＋ Add" for whoever may add to this part. */
  action?: { label: string; a11y: string; onPress: () => void } | null;
}) {
  const s = useDetailStyles();
  return (
    <SectionRow place={{ first: true }}>
      <View style={s.titleRow}>
        <Text style={s.sectionTitle} accessibilityRole="header">
          {title.toUpperCase()}
          {count ? <Text style={s.count}> · {count}</Text> : null}
        </Text>
        {action ? (
          <Pressable onPress={action.onPress} accessibilityRole="button" accessibilityLabel={action.a11y} hitSlop={6} style={({ pressed }) => [s.addButton, pressed && s.pressed]}>
            <Text style={s.addText}>{action.label}</Text>
          </Pressable>
        ) : null}
      </View>
      {aside ? <Text style={s.small}>{aside}</Text> : null}
    </SectionRow>
  );
}

/** A tick box: covered or not (an agenda item). */
function Tick({ checked, label, onPress }: { checked: boolean; label: string; onPress?: () => void }) {
  const s = useDetailStyles();
  if (!onPress) return null;
  return (
    <Pressable onPress={onPress} accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked }} hitSlop={8} style={s.tickTarget}>
      <View style={[s.tick, checked && s.tickOn]}>{checked ? <Text style={s.tickMark}>✓</Text> : null}</View>
    </Pressable>
  );
}

export function StateRow({ kind, text, onRetry, place }: { kind: 'loading' | 'failed' | 'empty'; text: string; onRetry?: () => void; place: RowPlace }) {
  const s = useDetailStyles();
  return (
    <SectionRow place={place}>
      {kind === 'loading' ? (
        <View style={s.inline}>
          <ActivityIndicator size="small" />
          <Text style={s.muted}>Loading…</Text>
        </View>
      ) : kind === 'failed' ? (
        <View style={s.inline} accessibilityRole="alert">
          <Text style={[s.muted, s.flex]}>{text}</Text>
          {onRetry ? <Button title="Retry" variant="secondary" onPress={onRetry} style={s.retry} /> : null}
        </View>
      ) : (
        <Text style={s.muted}>{text}</Text>
      )}
    </SectionRow>
  );
}

/** "Waiting to sync": a change made on this phone that the server doesn't have yet. */
function WaitingNote() {
  const s = useDetailStyles();
  return <Text style={s.waiting}>⏳ Waiting to sync</Text>;
}

export function AgendaRow({
  item,
  index,
  nameOf,
  place,
  onToggle,
  onOpen,
  waiting,
}: {
  item: ApiAgendaItem;
  index: number;
  nameOf: NameOf;
  place: RowPlace;
  /** Tick it off as covered (whoever runs the meeting, or its presenter). */
  onToggle?: (() => void) | null;
  /** Edit, move or remove it (whoever runs the meeting). */
  onOpen?: (() => void) | null;
  /** A change to it is still waiting on this phone. */
  waiting?: boolean;
}) {
  const s = useDetailStyles();
  const line = agendaItemLine(item, nameOf);
  const label = `${index + 1}. ${item.title}, ${line}${item.completed ? ', covered' : ''}${waiting ? ', waiting to sync' : ''}`;
  const body = (
    <View style={[s.inline, s.flex]}>
      <Text style={s.index}>{index + 1}</Text>
      <View style={s.flex}>
        <Text style={[s.itemTitle, item.completed && s.done]}>{item.title}</Text>
        <Text style={s.small}>{line}</Text>
        {waiting ? <WaitingNote /> : null}
      </View>
      {item.completed ? <Badge label="Covered" tone="success" /> : null}
    </View>
  );
  return (
    <SectionRow place={place}>
      <View style={s.inline}>
        <Tick checked={item.completed} label={`Covered: ${item.title}`} onPress={onToggle ?? undefined} />
        {onOpen ? (
          <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={label} accessibilityHint="Edit, move or remove it" style={({ pressed }) => [s.flex, pressed && s.pressed]}>
            {body}
          </Pressable>
        ) : (
          <View style={s.flex} accessible accessibilityLabel={label}>
            {body}
          </View>
        )}
      </View>
    </SectionRow>
  );
}

export function PersonRow({
  attendee: a,
  nameOf,
  myId,
  showAttendance,
  place,
  flags,
  onOpen,
  waiting,
}: {
  attendee: ApiMeetingAttendee;
  nameOf: NameOf;
  myId: string | null;
  showAttendance: boolean;
  place: RowPlace;
  /** Not invited yet / no email address (shown to whoever runs the meeting). */
  flags?: { notInvited: boolean; noEmail: boolean } | null;
  /** Their role, answer, attendance or removal. */
  onOpen?: (() => void) | null;
  /** Their attendance, changed on this phone, is still waiting to sync. */
  waiting?: boolean;
}) {
  const s = useDetailStyles();
  const name = attendeeName(a, nameOf);
  const response = a.response ?? 'PENDING';
  const own = !!a.userId && a.userId === myId;
  const parts = [
    own ? `${name} (you)` : name,
    a.role === 'OPTIONAL' ? 'optional' : 'required',
    a.userId ? null : 'guest',
    responseLabel(response),
    showAttendance ? `attendance: ${attendanceLabel(a.attendance)}` : null,
    flags?.notInvited ? 'not invited yet' : null,
    flags?.noEmail ? 'no email address' : null,
    waiting ? 'waiting to sync' : null,
  ];
  const body = (
    <>
      <Text style={s.itemTitle}>
        {name}
        {own ? <Text style={s.small}> (you)</Text> : null}
      </Text>
      {a.externalEmail ? <Text style={s.small}>{a.externalEmail}</Text> : null}
      <View style={s.badges}>
        <Badge label={a.role === 'OPTIONAL' ? 'Optional' : 'Required'} tone={a.role === 'OPTIONAL' ? 'neutral' : 'info'} />
        {!a.userId ? <Badge label="Guest" /> : null}
        <Badge label={responseLabel(response)} tone={responseTone(response)} />
        {showAttendance ? <Text style={s.small}>Attendance: {attendanceLabel(a.attendance)}</Text> : null}
        {flags?.notInvited ? <Text style={s.warn}>Not invited yet</Text> : null}
        {flags?.noEmail ? <Text style={s.small}>No email address</Text> : null}
        {waiting ? <WaitingNote /> : null}
      </View>
    </>
  );
  return (
    <SectionRow place={place}>
      {onOpen ? (
        <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={parts.filter(Boolean).join(', ')} accessibilityHint="Opens their options" style={({ pressed }) => pressed && s.pressed}>
          {body}
        </Pressable>
      ) : (
        <View accessible accessibilityLabel={parts.filter(Boolean).join(', ')}>
          {body}
        </View>
      )}
    </SectionRow>
  );
}

export function MoreRow({ total, expanded, onToggle, place }: { total: number; expanded: boolean; onToggle: () => void; place: RowPlace }) {
  const s = useDetailStyles();
  return (
    <SectionRow place={place}>
      <Pressable onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded }} hitSlop={6} style={s.link}>
        <Text style={s.linkText}>{expanded ? 'Show fewer' : `Show all ${total}`}</Text>
      </Pressable>
    </SectionRow>
  );
}

export function NoteFiltersRow({ notes, filter, onFilter, place }: { notes: ApiMeetingNote[]; filter: NoteFilter; onFilter: (f: NoteFilter) => void; place: RowPlace }) {
  const s = useDetailStyles();
  return (
    <SectionRow place={place}>
      <View style={s.answers} accessibilityRole="radiogroup" accessibilityLabel="Show notes">
        {noteFilters(notes).map((f) => (
          <Chip key={f.key} label={`${f.label} ${f.count}`} selected={filter === f.key} onPress={() => onFilter(f.key)} a11yLabel={`${f.label}, ${f.count}`} />
        ))}
      </View>
    </SectionRow>
  );
}

/** What can be done with a note: make it a task, mark it a key point, change its words, delete it. */
export interface NoteActions {
  onTask?: (() => void) | null;
  onStar?: (() => void) | null;
  onEdit?: (() => void) | null;
  onDelete?: (() => void) | null;
}

export function NoteRow({
  note,
  nameOf,
  timeZone,
  taskKey,
  onOpenTask,
  place,
  actions,
  waiting,
}: {
  note: ApiMeetingNote;
  nameOf: NameOf;
  timeZone: string;
  taskKey: string | null;
  onOpenTask: (taskId: string) => void;
  place: RowPlace;
  actions?: NoteActions;
  /** Taken on this phone and still waiting to sync (it can be changed once it has). */
  waiting?: boolean;
}) {
  const c = useColors();
  const s = useDetailStyles();
  const tone = toneStyle(c, noteTypeTone(note.type));
  const a = actions ?? {};
  const small = (label: string, a11y: string, onPress: () => void, extra?: object) => (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={a11y} hitSlop={4} style={({ pressed }) => [s.noteAction, pressed && s.pressed]} {...extra}>
      <Text style={s.noteActionText}>{label}</Text>
    </Pressable>
  );
  return (
    <SectionRow place={place}>
      <View style={[s.note, { borderLeftColor: tone.fg }, note.highlighted && s.noteKey]}>
        <View style={s.badges}>
          <Text style={[s.noteType, { color: tone.fg }]}>{noteTypeLabel(note.type).toUpperCase()}</Text>
          {note.highlighted ? <Text style={s.keyPoint}>★ Key point</Text> : null}
          <Text style={s.small}>{noteMeta(note, nameOf, timeZone)}</Text>
        </View>
        <NoteBody note={note} />
        {waiting ? <WaitingNote /> : null}
        {note.taskId ? (
          <Pressable
            onPress={() => onOpenTask(note.taskId!)}
            accessibilityRole="button"
            accessibilityLabel={`Open the task made from this note${taskKey ? `, ${taskKey}` : ''}`}
            style={({ pressed }) => [s.taskChip, pressed && s.pressed]}
          >
            <Text style={s.taskChipText}>✓ {taskKey ?? 'Task'} ›</Text>
          </Pressable>
        ) : null}
        {a.onTask || a.onStar || a.onEdit || a.onDelete ? (
          <View style={s.noteActions}>
            {a.onTask && !note.taskId ? small(note.type === 'ACTION' ? '✓ Make it a task' : '✓ Task', 'Create task from note', a.onTask) : null}
            {a.onStar
              ? small(note.highlighted ? '★ Key point' : '☆ Key point', note.highlighted ? 'Unmark key point' : 'Mark as key point', a.onStar, { accessibilityState: { checked: note.highlighted } })
              : null}
            {a.onEdit ? small('✎ Edit', 'Edit note', a.onEdit) : null}
            {a.onDelete ? small('🗑 Delete', 'Delete note', a.onDelete) : null}
          </View>
        ) : null}
      </View>
    </SectionRow>
  );
}

export function ActionRow({
  item,
  nameOf,
  now,
  onOpenTask,
  place,
  onOpen,
  waiting,
}: {
  item: ApiActionItem;
  nameOf: NameOf;
  now: Date;
  onOpenTask: (taskId: string) => void;
  place: RowPlace;
  /** Change it (status, owner, due day, priority) or remove it. */
  onOpen?: (() => void) | null;
  /** Added or changed on this phone and still waiting to sync. */
  waiting?: boolean;
}) {
  const s = useDetailStyles();
  const done = item.status === 'COMPLETED' || item.status === 'CANCELLED';
  const overdue = isActionItemOverdue(item, now);
  const due = actionDueText(item, now);
  const owner = item.assigneeId ? nameOf(item.assigneeId) ?? 'A team member' : 'Unassigned';
  const label = [item.description, actionStatusLabel(item.status), owner, due, item.sourceNoteId ? 'from a note' : null, waiting ? 'waiting to sync' : null].filter(Boolean).join(', ');
  const body = (
    <>
      <Text style={[s.itemTitle, done && s.done]}>{item.description}</Text>
      <View style={s.badges}>
        <Badge label={actionStatusLabel(item.status)} tone={actionStatusTone(item.status)} />
        <Text style={s.small}>{owner}</Text>
        <Text style={[s.small, overdue && s.overdue]}>{due}</Text>
        {item.sourceNoteId ? <Text style={s.small}>· From a note</Text> : null}
        {waiting ? <WaitingNote /> : null}
      </View>
    </>
  );
  return (
    <SectionRow place={place}>
      <View style={s.gapXs}>
        {onOpen ? (
          <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={label} accessibilityHint="Change its status, owner, due date or priority" style={({ pressed }) => pressed && s.pressed}>
            {body}
          </Pressable>
        ) : (
          <View accessible accessibilityLabel={label}>
            {body}
          </View>
        )}
        {item.taskId ? (
          <Pressable
            onPress={() => onOpenTask(item.taskId!)}
            accessibilityRole="button"
            accessibilityLabel={`Open the linked task${item.taskKey ? `, ${item.taskKey}` : ''}`}
            style={({ pressed }) => [s.taskChip, pressed && s.pressed]}
          >
            <Text style={s.taskChipText}>✓ {item.taskKey ?? 'Task'} ›</Text>
          </Pressable>
        ) : null}
      </View>
    </SectionRow>
  );
}

/** What can be done with the final minutes from the meeting's page. */
export interface MinutesActions {
  /** Whoever runs the meeting: start a draft, or go on with the saved one. */
  onDraft?: ((source: 'ai' | 'notes') => void) | null;
  onContinue?: (() => void) | null;
  onReopen?: (() => void) | null;
  reopening?: boolean;
  /** Everyone, once they are final: the minutes PDF (download or share). */
  onDownload?: (() => void) | null;
  downloading?: boolean;
}

/** The final minutes when they are final; otherwise how far they are (and, to their writer, what to do next). */
export function MinutesRow({ minutes, timeZone, place, actions }: { minutes: ApiFinalMinutes; timeZone: string; place: RowPlace; actions?: MinutesActions }) {
  const s = useDetailStyles();
  const note = finalMinutesNote(minutes);
  const content = minutes.content;
  const a = actions ?? {};
  if (minutes.canEdit && minutes.status !== 'FINAL') {
    const draft = minutes.status === 'DRAFT';
    return (
      <SectionRow place={place}>
        <View style={s.gapSm}>
          {draft ? (
            <View style={s.badges}>
              <Badge label="Draft" tone="info" />
              <Text style={s.small}>{minutes.savedAt ? `Saved ${meetingWhen({ startAt: minutes.savedAt, endAt: null }, timeZone).day}, ${meetingWhen({ startAt: minutes.savedAt, endAt: null }, timeZone).time}` : 'Not saved yet'}</Text>
            </View>
          ) : (
            <Text style={s.muted}>
              The minutes you approve and send: a summary, what was discussed under each agenda item, the decisions, risks and next steps. Start from a draft, edit it, then mark it final.
            </Text>
          )}
          {draft && a.onContinue ? <Button title="Continue editing" onPress={a.onContinue} /> : null}
          {!draft && a.onDraft ? (
            <View style={s.actions}>
              <Button title="Draft with AI" onPress={() => a.onDraft!('ai')} style={s.flex} />
              <Button title="Start from the notes" variant="secondary" onPress={() => a.onDraft!('notes')} style={s.flex} />
            </View>
          ) : null}
        </View>
      </SectionRow>
    );
  }
  if (note || !content) {
    return (
      <SectionRow place={place}>
        <Text style={s.muted}>{note}</Text>
      </SectionRow>
    );
  }
  const list = (title: string, items: string[]) =>
    items.length ? (
      <View style={s.gapXs}>
        <Text style={s.itemTitle} accessibilityRole="header">
          {title}
        </Text>
        {items.map((t, i) => (
          <Text key={i} style={s.body}>
            • {t}
          </Text>
        ))}
      </View>
    ) : null;
  return (
    <SectionRow place={place}>
      <View style={s.gapSm}>
        <View style={s.badges}>
          <Badge label="Final" tone="success" />
          <Text style={s.small}>{approvedLine(minutes, undefined, timeZone)}</Text>
        </View>
        {content.summary ? <Text style={s.body}>{content.summary}</Text> : null}
        {content.discussion.length ? (
          <View style={s.gapXs}>
            <Text style={s.itemTitle} accessibilityRole="header">
              Discussion
            </Text>
            {content.discussion.map((d, i) => (
              <View key={i}>
                {d.topic ? <Text style={[s.body, s.bold]}>{d.topic}</Text> : null}
                {d.text ? <Text style={s.bodyMuted}>{d.text}</Text> : null}
              </View>
            ))}
          </View>
        ) : null}
        {list('Decisions', content.decisions)}
        {list('Risks & open issues', content.risks)}
        {list('Next steps', content.nextSteps)}
        {a.onDownload || (minutes.canEdit && a.onReopen) ? (
          <View style={s.actions}>
            {a.onDownload ? <Button title="Download minutes (PDF)" variant="secondary" onPress={a.onDownload} loading={a.downloading} style={s.flex} /> : null}
            {minutes.canEdit && a.onReopen ? <Button title="Reopen" variant="ghost" onPress={a.onReopen} loading={a.reopening} style={s.more} /> : null}
          </View>
        ) : null}
      </View>
    </SectionRow>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    card: { backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: c.line, padding: spacing.md, gap: spacing.sm, marginBottom: spacing.md },
    row: { backgroundColor: c.surface, borderLeftWidth: 1, borderRightWidth: 1, borderColor: c.line, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
    rowFirst: { borderTopWidth: 1, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingTop: spacing.md },
    rowLast: { borderBottomWidth: 1, borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg, paddingBottom: spacing.md, marginBottom: spacing.md },
    titleRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.xs },
    sectionTitle: { fontSize: fontSize.xs, fontWeight: '800', color: c.ink2, letterSpacing: 0.8 },
    count: { color: c.ink3, fontWeight: '700' },
    badges: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs, marginTop: 2 },
    // User-written words (titles, notes, descriptions) read right to left in Arabic (Android picks the direction).
    title: { fontSize: fontSize.xl, fontWeight: '800', color: c.ink, textAlign: 'auto' },
    struck: { textDecorationLine: 'line-through', color: c.ink3 },
    facts: { gap: 4 },
    fact: { fontSize: fontSize.sm, color: c.ink2 },
    join: { marginTop: spacing.xs },
    small: { fontSize: fontSize.xs, color: c.ink3 },
    muted: { fontSize: fontSize.sm, color: c.ink2 },
    body: { fontSize: fontSize.sm, color: c.ink, lineHeight: 20, textAlign: 'auto' },
    bodyMuted: { fontSize: fontSize.sm, color: c.ink2, lineHeight: 20, textAlign: 'auto' },
    bold: { fontWeight: '700' },
    error: { fontSize: fontSize.sm, color: c.danger, fontWeight: '600' },
    answers: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
    inline: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    flex: { flex: 1 },
    retry: { minHeight: 40 },
    index: { width: 20, textAlign: 'right', fontSize: fontSize.xs, color: c.ink3 },
    itemTitle: { fontSize: fontSize.md, fontWeight: '600', color: c.ink, textAlign: 'auto' },
    done: { textDecorationLine: 'line-through', color: c.ink3 },
    overdue: { color: c.danger, fontWeight: '700' },
    link: { minHeight: 40, justifyContent: 'center' },
    linkText: { fontSize: fontSize.sm, fontWeight: '700', color: c.brand },
    note: { borderLeftWidth: 3, paddingLeft: spacing.sm, gap: spacing.xs },
    noteKey: { backgroundColor: c.warningSoft, borderRadius: radius.sm, paddingVertical: spacing.xs },
    noteType: { fontSize: fontSize.xs, fontWeight: '800', letterSpacing: 0.5 },
    keyPoint: { fontSize: fontSize.xs, fontWeight: '700', color: c.warning },
    taskChip: { alignSelf: 'flex-start', minHeight: 36, justifyContent: 'center', backgroundColor: c.successSoft, borderRadius: radius.pill, paddingHorizontal: spacing.md },
    taskChipText: { fontSize: fontSize.xs, fontWeight: '700', color: c.success },
    pressed: { opacity: 0.7 },
    gapXs: { gap: spacing.xs },
    gapSm: { gap: spacing.sm },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
    more: { minWidth: 110 },
    addButton: { minHeight: 36, justifyContent: 'center', paddingHorizontal: spacing.sm, borderRadius: radius.pill, backgroundColor: c.brandWash },
    addText: { fontSize: fontSize.xs, fontWeight: '800', color: c.brand },
    warn: { fontSize: fontSize.xs, fontWeight: '700', color: c.warning },
    waiting: { fontSize: fontSize.xs, fontWeight: '700', color: c.brand },
    tickTarget: { minWidth: 40, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    tick: { width: 24, height: 24, borderRadius: 6, borderWidth: 1.5, borderColor: c.ink3, alignItems: 'center', justifyContent: 'center' },
    tickOn: { borderColor: c.success, backgroundColor: c.success },
    tickMark: { color: c.onBrand, fontSize: fontSize.sm, fontWeight: '800' },
    noteActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: 2 },
    noteAction: { minHeight: 40, justifyContent: 'center', paddingHorizontal: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface },
    noteActionText: { fontSize: fontSize.xs, fontWeight: '700', color: c.ink2 },
  });
