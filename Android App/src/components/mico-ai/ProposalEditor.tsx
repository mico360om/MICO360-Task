import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useColors } from '../../core/theme';
import { useSession } from '../../core/providers';
import { useDatePreferences } from '../../core/calendar-queries';
import { useDirectory, useProjectColumns, useProjectMembers, useProjects } from '../../core/queries';
import { weekStartOf } from '../../lib/calendar';
import { companyTodayKey } from '../../lib/due-date';
import type { CreateTaskChange, MeetingChange, MicoAiNamed, MinutesChange, ProposalChange, UpdateTaskChange } from '../../lib/mico-ai-api';
import { FIELD_MAX, lengthChoices, type Shown } from '../../lib/mico-ai-card';
import { lengthLabel, linesOf, textOf } from '../../lib/mico-ai-proposal';
import { parseTimeInput } from '../../lib/meeting-form';
import { PRIORITY_LABELS } from '../../lib/meeting-parts';
import { displayName, type FinalMinutesContent, type Priority } from '../../lib/types';
import { radius, spacing, type Palette } from '../../lib/theme';
import { font, typeStyle } from '../../lib/typography';
import { DueDateField } from '../task-form/DueDateField';
import { ChipChoice, InlinePicker } from '../meeting/sheet-kit';
import { TextField } from '../ui';
import { Icon } from '../Icon';

/**
 * Editing one change on MICO AI's card before Confirm, as the website's proposal-rows editors, with
 * the app's own controls: each reports the values the person chose (ids, days, times) and the names
 * to show for them. The server checks every value again on Confirm.
 */
export type EditFn = (patch: Record<string, unknown>, shown?: Shown) => void;

const PRIORITIES: Priority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
const priorityChoices = PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }));

interface Person {
  id: string;
  name: string;
  username?: string;
}

const named = (people: Person[], ids: string[], known: MicoAiNamed[]): MicoAiNamed[] =>
  ids.map((id) => ({ id, name: people.find((p) => p.id === id)?.name ?? known.find((k) => k.id === id)?.name ?? 'Someone' }));

function useStyles() {
  const c = useColors();
  return useMemo(() => makeStyles(c), [c]);
}

/** The projects a change can go into: those that aren't archived. */
function useOpenProjects() {
  const q = useProjects();
  return useMemo(() => (Array.isArray(q.data) ? q.data : []).filter((p) => p.status !== 'ARCHIVED'), [q.data]);
}

/** A project's team as choices (its members); before they load, the people already chosen. */
function useTeam(projectId: string | null, chosen: MicoAiNamed[]): Person[] {
  const q = useProjectMembers(projectId ?? '');
  return useMemo(() => {
    if (!q.isSuccess) return chosen.map((p) => ({ id: p.id, name: p.name }));
    return (Array.isArray(q.data) ? q.data : []).map((m) => ({ id: m.id, name: displayName(m), username: m.username }));
  }, [q.isSuccess, q.data, chosen]);
}

/** The people chosen, each removable, and a list of the others to add (the website's AssigneeSelect). */
function PeopleField({ label, people, value, onChange }: { label: string; people: Person[]; value: string[]; onChange: (ids: string[]) => void }) {
  const c = useColors();
  const s = useStyles();
  const chosen = value.map((id) => people.find((p) => p.id === id) ?? { id, name: 'Someone' });
  const options = people.filter((p) => !value.includes(p.id)).map((p) => ({ value: p.id, label: p.name, hint: p.username ? `@${p.username}` : undefined }));
  return (
    <View>
      <InlinePicker label={label} options={options} value="" onChange={(id) => id && onChange([...value, id])} placeholder={people.length ? 'Search by name…' : 'No one to choose from'} emptyText="Everyone is chosen." disabled={people.length === 0} />
      {chosen.length ? (
        <View style={s.chips}>
          {chosen.map((p) => (
            <View key={p.id} style={s.chip}>
              <Text style={s.chipText} numberOfLines={1}>
                {p.name}
              </Text>
              <Pressable onPress={() => onChange(value.filter((id) => id !== p.id))} accessibilityRole="button" accessibilityLabel={`Remove ${p.name}`} hitSlop={6} style={s.remove}>
                <Icon name="ui.close" size={14} color={c.ink2} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** A list edited one item a line: what is typed stays as typed; the list is what it means. */
function LinesField({ label, list, onList }: { label: string; list: string[]; onList: (l: string[]) => void }) {
  const s = useStyles();
  const [text, setText] = useState(() => textOf(list));
  return (
    <TextField
      label={label}
      multiline
      value={text}
      onChangeText={(t) => {
        setText(t);
        onList(linesOf(t));
      }}
      style={s.multiline}
    />
  );
}

function useDays() {
  const weekStart = weekStartOf(useDatePreferences().data);
  return { today: companyTodayKey(), weekStart };
}

function CreateEditor({ item, onEdit }: { item: CreateTaskChange; onEdit: EditFn }) {
  const s = useStyles();
  const f = item.fields;
  const projects = useOpenProjects();
  const team = useTeam(f.projectId, item.labels.assignees);
  const { today, weekStart } = useDays();
  return (
    <View>
      <TextField label="Title" value={f.title} maxLength={FIELD_MAX.taskTitle} onChangeText={(title) => onEdit({ title })} />
      <InlinePicker
        label="Project"
        options={projects.map((p) => ({ value: p.id, label: p.name, hint: p.code }))}
        value={f.projectId ?? ''}
        placeholder="Pick a project"
        onChange={(v) => onEdit({ projectId: v }, { project: projects.find((p) => p.id === v)?.name ?? null })}
      />
      <DueDateField label="Due date" what="Due date" value={f.due ?? ''} onChange={(d) => onEdit({ due: d || null })} today={today} weekStart={weekStart} />
      <ChipChoice<Priority> label="Priority" options={priorityChoices} value={f.priority} onChange={(priority) => onEdit({ priority })} />
      <PeopleField label="Assigned to" people={team} value={f.assigneeIds} onChange={(ids) => onEdit({ assigneeIds: ids }, { assignees: named(team, ids, item.labels.assignees) })} />
      <TextField label="Description" multiline value={f.description} maxLength={FIELD_MAX.text} onChangeText={(description) => onEdit({ description })} style={s.multiline} />
    </View>
  );
}

function UpdateEditor({ item, onEdit }: { item: UpdateTaskChange; onEdit: EditFn }) {
  const f = item.fields;
  const columnsQ = useProjectColumns(f.columnId !== undefined ? item.task.projectId : '');
  const columns = (Array.isArray(columnsQ.data) ? columnsQ.data : []).filter((col) => col.enabled !== false).sort((a, b) => a.position - b.position);
  const team = useTeam(f.assigneeIds !== undefined ? item.task.projectId : null, item.labels.assignees ?? []);
  const { today, weekStart } = useDays();
  return (
    <View>
      {f.due !== undefined ? <DueDateField label="Due date" what="Due date" value={f.due ?? ''} onChange={(d) => onEdit({ due: d || null })} today={today} weekStart={weekStart} /> : null}
      {f.columnId !== undefined ? (
        <InlinePicker
          label="Status"
          options={columns.map((col) => ({ value: col.id, label: col.name }))}
          value={f.columnId}
          placeholder={columnsQ.isLoading ? 'Loading…' : 'Pick a status'}
          onChange={(v) => onEdit({ columnId: v }, { column: columns.find((col) => col.id === v)?.name ?? '' })}
        />
      ) : null}
      {f.priority !== undefined ? <ChipChoice<Priority> label="Priority" options={priorityChoices} value={f.priority} onChange={(priority) => onEdit({ priority })} /> : null}
      {f.assigneeIds !== undefined ? (
        <PeopleField label="Assigned to" people={team} value={f.assigneeIds} onChange={(ids) => onEdit({ assigneeIds: ids }, { assignees: named(team, ids, item.labels.assignees ?? []) })} />
      ) : null}
    </View>
  );
}

function MinutesEditor({ item, onEdit }: { item: MinutesChange; onEdit: EditFn }) {
  const s = useStyles();
  const c = item.fields.content;
  const set = (patch: Partial<FinalMinutesContent>) => onEdit({ content: { ...c, ...patch } });
  return (
    <View>
      <TextField label="Summary" multiline value={c.summary} maxLength={FIELD_MAX.text} onChangeText={(summary) => set({ summary })} style={s.multiline} />
      {c.discussion.map((d, i) => (
        <TextField
          key={i}
          label={`Discussion: ${d.topic}`}
          multiline
          value={d.text}
          onChangeText={(text) => set({ discussion: c.discussion.map((x, j) => (j === i ? { ...x, text } : x)) })}
          style={s.multiline}
        />
      ))}
      <LinesField label="Decisions (one a line)" list={c.decisions} onList={(decisions) => set({ decisions })} />
      <LinesField label="Risks and open questions (one a line)" list={c.risks} onList={(risks) => set({ risks })} />
      <LinesField label="Next steps (one a line)" list={c.nextSteps} onList={(nextSteps) => set({ nextSteps })} />
    </View>
  );
}

/** The meeting's start, typed as HH:MM: an hour that reads right becomes the meeting's. */
function TimeField({ value, onTime }: { value: string | null; onTime: (t: string) => void }) {
  const [text, setText] = useState(value ?? '');
  const parsed = parseTimeInput(text);
  return (
    <TextField
      label="Time"
      value={text}
      placeholder="HH:MM"
      keyboardType="numbers-and-punctuation"
      maxLength={5}
      error={parsed.ok ? null : parsed.error}
      onChangeText={(t) => {
        setText(t);
        const p = parseTimeInput(t);
        if (p.ok && p.value) onTime(p.value);
      }}
    />
  );
}

function MeetingEditor({ item, onEdit }: { item: MeetingChange; onEdit: EditFn }) {
  const s = useStyles();
  const f = item.fields;
  const me = useSession()?.user.id;
  const projects = useOpenProjects();
  const dirQ = useDirectory();
  const { today, weekStart } = useDays();
  // Anyone active can be invited; the person asking organizes it.
  const people = useMemo<Person[]>(() => {
    const dir = Array.isArray(dirQ.data) ? dirQ.data : [];
    if (!dir.length) return item.labels.attendees.map((p) => ({ id: p.id, name: p.name }));
    return dir.filter((u) => u.active !== false && u.id !== me).map((u) => ({ id: u.id, name: displayName(u), username: u.username }));
  }, [dirQ.data, me, item.labels.attendees]);
  return (
    <View>
      <TextField label="Title" value={f.title} maxLength={FIELD_MAX.meetingTitle} onChangeText={(title) => onEdit({ title })} />
      <DueDateField label="Day" what="Day" value={f.date ?? ''} onChange={(d) => d && onEdit({ date: d })} today={today} weekStart={weekStart} />
      <TimeField value={f.time} onTime={(time) => onEdit({ time })} />
      <ChipChoice<string> label="Length" options={lengthChoices(f.minutes).map((m) => ({ value: String(m), label: lengthLabel(m) }))} value={String(f.minutes)} onChange={(v) => onEdit({ minutes: Number(v) })} />
      <InlinePicker
        label="Project"
        options={[{ value: '', label: 'No project' }, ...projects.map((p) => ({ value: p.id, label: p.name, hint: p.code }))]}
        value={f.projectId ?? ''}
        placeholder="No project"
        onChange={(v) => onEdit({ projectId: v || null }, { project: v ? (projects.find((p) => p.id === v)?.name ?? null) : null })}
      />
      <PeopleField label="People invited" people={people} value={f.attendeeIds} onChange={(ids) => onEdit({ attendeeIds: ids }, { attendees: named(people, ids, item.labels.attendees) })} />
      <LinesField label="Agenda (one item a line)" list={f.agenda} onList={(agenda) => onEdit({ agenda })} />
      <TextField label="Description" multiline value={f.description} maxLength={FIELD_MAX.text} onChangeText={(description) => onEdit({ description })} style={s.multiline} />
    </View>
  );
}

/** One editor per kind of change. */
export function ProposalEditor({ item, onEdit }: { item: ProposalChange; onEdit: EditFn }) {
  const s = useStyles();
  let editor;
  switch (item.type) {
    case 'create_task':
      editor = <CreateEditor item={item} onEdit={onEdit} />;
      break;
    case 'update_task':
      editor = <UpdateEditor item={item} onEdit={onEdit} />;
      break;
    case 'draft_minutes':
      editor = <MinutesEditor item={item} onEdit={onEdit} />;
      break;
    case 'schedule_meeting':
      editor = <MeetingEditor item={item} onEdit={onEdit} />;
      break;
  }
  return <View style={s.box}>{editor}</View>;
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    box: { borderWidth: 1, borderColor: c.line, backgroundColor: c.ground, borderRadius: radius.button, padding: spacing.md },
    multiline: { minHeight: 88, paddingTop: 10, textAlignVertical: 'top' },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
    chip: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface, borderRadius: radius.pill, paddingLeft: spacing.md, maxWidth: '100%', minHeight: 40 },
    chipText: { ...typeStyle('caption'), ...font('600'), color: c.ink, flexShrink: 1 },
    remove: { width: 40, minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  });
