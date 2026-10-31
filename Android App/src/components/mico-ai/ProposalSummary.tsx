import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useColors } from '../../core/theme';
import { applyNavAction } from '../../navigation/apply-action';
import { appTimeZone, calendarTimeZone, companyTodayKey, zonedDayKey } from '../../lib/due-date';
import type { CreateTaskChange, MeetingChange, MicoAiNamed, MinutesChange, ProposalChange, UpdateTaskChange } from '../../lib/mico-ai-api';
import { linkTarget } from '../../lib/mico-ai-chat';
import { lengthLabel, meetingWhen, shortDay } from '../../lib/mico-ai-proposal';
import { PRIORITY_LABELS } from '../../lib/meeting-parts';
import { radius, spacing, type Palette } from '../../lib/theme';
import { font, typeStyle } from '../../lib/typography';
import { PriorityBadge } from '../ui';
import { Icon } from '../Icon';

/**
 * What one change on MICO AI's card will do, as the website's proposal-rows summaries: a new
 * task's details, a task change as before → after, a draft of final minutes, a meeting's day,
 * time, people, agenda and description. Everything Confirm will write is shown — a long text is
 * behind "Show all", never cut off without saying so.
 */

/** How the card's days and times read: in the company's zone, named when the person's own differs. */
export interface When {
  timeZone: string;
  otherZone: boolean;
}
export function cardWhen(): When {
  const company = appTimeZone();
  return { timeZone: company, otherZone: calendarTimeZone() !== company };
}
const yearOf = (when: When) => companyTodayKey(new Date(), when.timeZone).slice(0, 4);
const names = (list: MicoAiNamed[]) => (list.length ? list.map((p) => p.name).join(', ') : 'No one');

function useStyles() {
  const c = useColors();
  return useMemo(() => makeStyles(c), [c]);
}

function People({ people, label }: { people: MicoAiNamed[]; label: string }) {
  const s = useStyles();
  if (!people.length) return <Text style={s.quiet}>No one</Text>;
  return (
    <View style={s.chips} accessible accessibilityLabel={`${label}: ${names(people)}`}>
      {people.map((p) => (
        <Text key={p.id} style={s.person} numberOfLines={1}>
          {p.name}
        </Text>
      ))}
    </View>
  );
}

/** "before → after": read as "to". */
function Change({ label, from, to }: { label: string; from: string; to: string }) {
  const s = useStyles();
  return (
    <View style={s.change} accessible accessibilityLabel={`${label}: ${from} to ${to}`}>
      <Text style={s.changeLabel}>{label}</Text>
      <Text style={s.flex}>
        <Text style={s.from}>{from}</Text>
        <Text style={s.quiet}>{'  →  '}</Text>
        <Text style={s.to}>{to}</Text>
      </Text>
    </View>
  );
}

/** A long text in full behind "Show all"; a short one as it is. */
function LongText({ text, what }: { text: string; what: string }) {
  const s = useStyles();
  const [open, setOpen] = useState(false);
  const long = text.length > 160 || text.split('\n').length > 3;
  return (
    <View>
      <Text style={s.muted} numberOfLines={long && !open ? 3 : undefined}>
        {text}
      </Text>
      {long ? (
        <Pressable onPress={() => setOpen((o) => !o)} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${open ? 'Show less' : 'Show all'} of the ${what}`} style={s.link}>
          <Text style={s.linkText}>{open ? 'Show less' : 'Show all'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** A section shown open (it has content): the person sees all of it, and may fold it away. */
function Disclosure({ title, children }: { title: string; children: ReactNode }) {
  const s = useStyles();
  const c = useColors();
  const [open, setOpen] = useState(true);
  return (
    <View style={s.disclosure}>
      <Pressable onPress={() => setOpen((o) => !o)} accessibilityRole="button" accessibilityState={{ expanded: open }} style={s.disclosureHead}>
        <Icon name="ui.chevron" size={16} color={c.ink2} rotate={open ? 0 : 270} />
        <Text style={[s.label, s.flex]}>{title}</Text>
      </Pressable>
      {open ? <View style={s.disclosureBody}>{children}</View> : null}
    </View>
  );
}

function List({ items, numbered }: { items: string[]; numbered?: boolean }) {
  const s = useStyles();
  return (
    <View style={s.list}>
      {items.map((x, i) => (
        <View key={i} style={s.listRow}>
          <Text style={s.marker}>{numbered ? `${i + 1}.` : '•'}</Text>
          <Text style={[s.body, s.flex]}>{x}</Text>
        </View>
      ))}
    </View>
  );
}

function MinutesList({ title, list }: { title: string; list: string[] }) {
  const s = useStyles();
  if (!list.length) return null;
  return (
    <View>
      <Text style={s.label}>{title}</Text>
      <List items={list} />
    </View>
  );
}

function CreateSummary({ item, when }: { item: CreateTaskChange; when: When }) {
  const s = useStyles();
  const f = item.fields;
  return (
    <View style={s.stack}>
      <Text style={s.title}>{f.title.trim() || 'Untitled task'}</Text>
      <View style={s.details}>
        <Text style={s.muted}>{item.labels.project ?? 'No project'}</Text>
        <Text style={s.quiet}>·</Text>
        <Text style={s.muted}>{f.due ? `Due ${shortDay(f.due, yearOf(when))}` : 'No due date'}</Text>
        <PriorityBadge priority={f.priority} />
      </View>
      <View style={s.details}>
        <Text style={s.label}>Assigned</Text>
        <People people={item.labels.assignees} label="Assigned people" />
      </View>
      {item.ownerDefault ? <Text style={s.small}>No one was named, so it goes to the project’s owner, as any new task does.</Text> : null}
      {f.description.trim() ? <LongText text={f.description} what="description" /> : null}
    </View>
  );
}

function UpdateSummary({ item, when }: { item: UpdateTaskChange; when: When }) {
  const s = useStyles();
  const f = item.fields;
  const day = (d: string | null | undefined) => (d ? shortDay(d, yearOf(when)) : 'No due date');
  const target = linkTarget(item.task.url);
  const head = (
    <Text style={s.body}>
      <Text style={s.key}>{` ${item.task.key} `}</Text>
      <Text style={s.title}>{`  ${item.task.title}`}</Text>
      <Text style={s.small}>{`  ${item.task.project}`}</Text>
    </Text>
  );
  return (
    <View style={s.stack}>
      {target ? (
        <Pressable onPress={() => applyNavAction(target)} accessibilityRole="link" accessibilityLabel={`${item.task.key} ${item.task.title}, ${item.task.project}`}>
          {head}
        </Pressable>
      ) : (
        head
      )}
      <View style={s.stackTight}>
        {f.due !== undefined ? <Change label="Due" from={day(item.before.due)} to={day(f.due)} /> : null}
        {f.columnId !== undefined ? <Change label="Status" from={item.before.column} to={item.labels.column ?? '—'} /> : null}
        {f.priority !== undefined ? <Change label="Priority" from={PRIORITY_LABELS[item.before.priority]} to={PRIORITY_LABELS[f.priority]} /> : null}
        {f.assigneeIds !== undefined ? <Change label="Assigned" from={names(item.before.assignees)} to={names(item.labels.assignees ?? [])} /> : null}
      </View>
    </View>
  );
}

function MinutesSummary({ item, when }: { item: MinutesChange; when: When }) {
  const s = useStyles();
  const c = item.fields.content;
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  return (
    <View style={s.stack}>
      <Text style={s.body}>
        <Text style={s.title}>{item.meeting.title}</Text>
        <Text style={s.small}>{`  ${shortDay(zonedDayKey(new Date(item.meeting.startAt), when.timeZone), yearOf(when))}`}</Text>
      </Text>
      <Text style={s.small}>Saved as a draft for review on the meeting page — never final or emailed.</Text>
      <Disclosure title={`The draft · ${plural(c.decisions.length, 'decision')} · ${plural(c.nextSteps.length, 'next step')}${c.risks.length ? ` · ${plural(c.risks.length, 'risk')}` : ''}`}>
        {c.summary ? (
          <View>
            <Text style={s.label}>Summary</Text>
            <Text style={s.body}>{c.summary}</Text>
          </View>
        ) : null}
        {c.discussion.length ? (
          <View style={s.stackTight}>
            <Text style={s.label}>Discussion</Text>
            {c.discussion.map((d, i) => (
              <View key={i}>
                <Text style={s.title}>{d.topic}</Text>
                <Text style={s.muted}>{d.text}</Text>
              </View>
            ))}
          </View>
        ) : null}
        <MinutesList title="Decisions" list={c.decisions} />
        <MinutesList title="Risks and open questions" list={c.risks} />
        <MinutesList title="Next steps" list={c.nextSteps} />
      </Disclosure>
    </View>
  );
}

function MeetingSummary({ item, when }: { item: MeetingChange; when: When }) {
  const s = useStyles();
  const f = item.fields;
  return (
    <View style={s.stack}>
      <Text style={s.title}>{f.title.trim() || 'Untitled meeting'}</Text>
      <View style={s.details}>
        <Text style={s.muted}>{meetingWhen(f, { thisYear: yearOf(when), ...(when.otherZone ? { zone: when.timeZone } : {}) })}</Text>
        <Text style={s.quiet}>·</Text>
        <Text style={s.muted}>{lengthLabel(f.minutes)}</Text>
        {item.labels.project ? (
          <>
            <Text style={s.quiet}>·</Text>
            <Text style={s.muted}>{item.labels.project}</Text>
          </>
        ) : null}
      </View>
      <View style={s.details}>
        <Text style={s.label}>Invited</Text>
        <People people={item.labels.attendees} label="People invited" />
      </View>
      {f.agenda.length ? (
        <View>
          <Text style={s.label}>Agenda</Text>
          <List items={f.agenda} numbered />
        </View>
      ) : null}
      {/* The invitations carry the description: it is shown, open, before anything is sent. */}
      {f.description.trim() ? (
        <Disclosure title="Description">
          <Text style={s.body}>{f.description}</Text>
        </Disclosure>
      ) : null}
    </View>
  );
}

export function RowSummary({ item, when }: { item: ProposalChange; when: When }) {
  switch (item.type) {
    case 'create_task':
      return <CreateSummary item={item} when={when} />;
    case 'update_task':
      return <UpdateSummary item={item} when={when} />;
    case 'draft_minutes':
      return <MinutesSummary item={item} when={when} />;
    case 'schedule_meeting':
      return <MeetingSummary item={item} when={when} />;
  }
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    flex: { flex: 1 },
    stack: { gap: 6 },
    stackTight: { gap: 4 },
    title: { ...typeStyle('bodyStrong'), color: c.ink },
    body: { ...typeStyle('body'), color: c.ink },
    muted: { ...typeStyle('body'), color: c.ink2 },
    quiet: { ...typeStyle('body'), color: c.ink3 },
    small: { ...typeStyle('caption'), color: c.ink3 },
    label: { ...typeStyle('caption'), ...font('600'), color: c.ink2 },
    details: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: spacing.sm, rowGap: 4 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, flexShrink: 1 },
    person: { ...typeStyle('caption'), color: c.ink, borderWidth: 1, borderColor: c.line, backgroundColor: c.ground, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2, overflow: 'hidden', maxWidth: 220 },
    change: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
    changeLabel: { ...typeStyle('caption'), ...font('600'), color: c.ink2, width: 64 },
    from: { ...typeStyle('body'), color: c.ink2, textDecorationLine: 'line-through' },
    to: { ...typeStyle('label'), color: c.ink },
    key: { ...typeStyle('caption'), fontFamily: 'monospace', color: c.ink2, backgroundColor: c.ground },
    link: { minHeight: 36, justifyContent: 'center', alignSelf: 'flex-start' },
    linkText: { ...typeStyle('caption'), ...font('600'), color: c.brandText },
    disclosure: { borderWidth: 1, borderColor: c.line, backgroundColor: c.ground, borderRadius: radius.input, paddingHorizontal: 10, paddingVertical: 4 },
    disclosureHead: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40 },
    disclosureBody: { gap: spacing.sm, paddingBottom: spacing.sm },
    list: { gap: 2, marginTop: 2 },
    listRow: { flexDirection: 'row', gap: 6 },
    marker: { ...typeStyle('body'), color: c.ink3, minWidth: 14 },
  });
