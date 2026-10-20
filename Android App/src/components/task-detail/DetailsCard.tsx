import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Switch } from 'react-native';
import { useColors } from '../../core/theme';
import { TextField, Button } from '../ui';
import { KeyboardGroup } from '../KeyboardAware';
import { priorityColor } from '../TaskRow';
import { RecurrenceEditor } from '../RecurrenceEditor';
import { categoryColorOf, spacing, radius, fontSize, type Palette } from '../../lib/theme';
import { parseDueDateInput, parseHoursInput } from '../../lib/form-input';
import { parseTags } from '../../lib/quick-add';
import { displayName, type ApiAssignee, type ApiColumn, type ApiTag, type ApiTask, type Priority, type RecurrenceRule } from '../../lib/types';
import { Chip, IconButton, SaveNote, SectionCard, useSave } from './kit';
import { dueFieldValue } from '../../lib/task-detail';

const PRIORITIES: Priority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
const PRIORITY_LABEL: Record<Priority, string> = { LOW: 'Low', NORMAL: 'Normal', HIGH: 'High', URGENT: 'Urgent' };

export type TaskPatch = Partial<Pick<ApiTask, 'title' | 'description' | 'priority' | 'dueDate' | 'estimatedHours' | 'progress' | 'recurrenceRule' | 'isMilestone'>>;

/** One property: its label above (phones are narrow), the control, and its save state. */
function Prop({ label, children }: { label: string; children: React.ReactNode }) {
  const c = useColors();
  return (
    <View style={{ gap: spacing.xs, paddingVertical: spacing.xs }}>
      <Text style={{ fontSize: fontSize.xs, fontWeight: '700', color: c.ink2 }}>{label}</Text>
      {children}
    </View>
  );
}

/**
 * The task's properties, each saved on its own as it changes (and kept on the phone to sync when
 * offline, where the app's sync queue allows): status, priority (with an AI suggestion to review),
 * due date, milestone, estimate, repeat, assignees, tags and progress.
 */
export function DetailsCard({
  task,
  columns,
  inSeries,
  earlierCopy,
  scope,
  onScope,
  overdue,
  onMove,
  onPatch,
  onSuggestPriority,
  assignees,
  members,
  onAssign,
  onUnassign,
  tags,
  onSaveTags,
}: {
  task: ApiTask;
  columns: ApiColumn[];
  inSeries: boolean;
  earlierCopy: boolean;
  scope: 'one' | 'series';
  onScope: (s: 'one' | 'series') => void;
  overdue: boolean;
  onMove: (columnId: string) => Promise<unknown>;
  onPatch: (patch: TaskPatch, withScope?: boolean) => Promise<unknown>;
  onSuggestPriority?: () => Promise<{ priority: Priority; reason: string }>;
  assignees: ApiAssignee[];
  members: ApiAssignee[];
  onAssign: (userId: string) => Promise<unknown>;
  onUnassign: (userId: string) => Promise<unknown>;
  tags: ApiTag[];
  onSaveTags: (names: string[]) => Promise<unknown>;
}) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const statusSave = useSave();
  const prioritySave = useSave();
  const dueSave = useSave();
  const estSave = useSave();
  const milestoneSave = useSave();
  const repeatSave = useSave();
  const peopleSave = useSave();
  const tagsSave = useSave();
  const progressSave = useSave();

  const [dueText, setDueText] = useState(dueFieldValue(task.dueDate));
  const [estText, setEstText] = useState(task.estimatedHours != null ? String(task.estimatedHours) : '');
  useEffect(() => setDueText(dueFieldValue(task.dueDate)), [task.dueDate]);
  useEffect(() => setEstText(task.estimatedHours != null ? String(task.estimatedHours) : ''), [task.estimatedHours]);
  const [suggestion, setSuggestion] = useState<{ priority: Priority; reason: string } | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [ruleDraft, setRuleDraft] = useState<RecurrenceRule | null | undefined>(undefined);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');
  const [tagsDraft, setTagsDraft] = useState<string | null>(null);
  // What was last sent, so Enter followed by leaving the field doesn't save the same value twice.
  const sentDue = useRef<string | null | undefined>(undefined);
  const sentEst = useRef<number | null | undefined>(undefined);

  async function saveDue(text: string) {
    const parsed = parseDueDateInput(text);
    if (!parsed.ok) {
      dueSave.fail(parsed.error);
      return;
    }
    const current = dueFieldValue(task.dueDate) || null;
    if (parsed.value === current || parsed.value === sentDue.current) return;
    sentDue.current = parsed.value;
    if (!(await dueSave.run(() => onPatch({ dueDate: parsed.value }), 'Couldn’t save the due date.'))) sentDue.current = undefined;
  }
  async function saveEstimate() {
    const parsed = parseHoursInput(estText);
    if (!parsed.ok) {
      estSave.fail(parsed.error);
      return;
    }
    if (parsed.value === (task.estimatedHours ?? null) || parsed.value === sentEst.current) return;
    sentEst.current = parsed.value;
    if (!(await estSave.run(() => onPatch({ estimatedHours: parsed.value }, true), 'Couldn’t save the estimate.'))) sentEst.current = undefined;
  }
  async function suggest() {
    if (!onSuggestPriority) return;
    setSuggesting(true);
    prioritySave.reset();
    try {
      setSuggestion(await onSuggestPriority());
    } catch (e) {
      prioritySave.fail(e instanceof Error && e.message ? e.message : 'The AI suggestion failed.');
    } finally {
      setSuggesting(false);
    }
  }

  const assignedIds = new Set(assignees.map((a) => a.id));
  const q = query.trim().toLowerCase();
  const matches = members.filter((m) => !assignedIds.has(m.id) && (!q || displayName(m).toLowerCase().includes(q) || m.username.toLowerCase().includes(q)));

  return (
    <SectionCard title="Details">
      {inSeries ? (
        <View style={s.scope} accessibilityRole="radiogroup" accessibilityLabel="Apply edits to">
          <Text style={s.scopeLabel}>Edits apply to</Text>
          <Chip label="This task" selected={scope === 'one'} onPress={() => onScope('one')} a11yLabel="Apply edits to this task" />
          <Chip label="Entire series" selected={scope === 'series'} onPress={() => onScope('series')} a11yLabel="Apply edits to the entire series" />
        </View>
      ) : null}

      <Prop label="Status">
        <View style={s.chips} accessibilityRole="radiogroup">
          {columns.map((col) => (
            <Chip
              key={col.id}
              label={col.name}
              dot={categoryColorOf(c, col.category)}
              selected={col.id === task.columnId}
              disabled={statusSave.busy}
              a11yLabel={col.id === task.columnId ? `Status: ${col.name}, current` : `Set status to ${col.name}`}
              onPress={col.id === task.columnId ? undefined : () => void statusSave.run(() => onMove(col.id), 'Couldn’t change the status.', true)}
            />
          ))}
        </View>
        <SaveNote state={statusSave.state} />
      </Prop>

      <Prop label="Priority">
        <View style={s.chips} accessibilityRole="radiogroup">
          {PRIORITIES.map((p) => (
            <Chip
              key={p}
              label={PRIORITY_LABEL[p]}
              dot={priorityColor(c, p)}
              selected={p === task.priority}
              disabled={prioritySave.busy}
              a11yLabel={`${PRIORITY_LABEL[p]} priority`}
              onPress={p === task.priority ? undefined : () => void prioritySave.run(() => onPatch({ priority: p }, true), 'Couldn’t change the priority.', true)}
            />
          ))}
          {onSuggestPriority ? (
            <Pressable onPress={() => void suggest()} disabled={suggesting} accessibilityRole="button" accessibilityLabel="Suggest priority with AI" style={s.aiBtn}>
              <Text style={s.aiText}>{suggesting ? 'Thinking…' : '✨ AI'}</Text>
            </Pressable>
          ) : null}
        </View>
        {suggestion ? (
          <View style={s.suggest}>
            <Text style={s.suggestText}>
              ✨ AI suggests <Text style={{ fontWeight: '800' }}>{PRIORITY_LABEL[suggestion.priority]}</Text>. {suggestion.reason}
            </Text>
            <View style={s.row}>
              <Button
                title="Apply"
                accessibilityLabel={`Apply ${PRIORITY_LABEL[suggestion.priority]}`}
                onPress={() => {
                  const p = suggestion.priority;
                  setSuggestion(null);
                  void prioritySave.run(() => onPatch({ priority: p }, true), 'Couldn’t change the priority.', true);
                }}
                style={s.flex}
              />
              <Button title="Dismiss" variant="ghost" onPress={() => setSuggestion(null)} style={s.flex} />
            </View>
          </View>
        ) : null}
        <SaveNote state={prioritySave.state} />
      </Prop>

      <Prop label="Due date">
        <View style={s.rowCenter}>
          <View style={s.flex}>
            <TextField
              value={dueText}
              onChangeText={(v) => {
                setDueText(v);
                if (dueSave.state.status === 'error') dueSave.reset();
              }}
              onBlur={() => void saveDue(dueText)}
              onSubmitEditing={() => void saveDue(dueText)}
              placeholder="YYYY-MM-DD"
              accessibilityLabel="Due date, year-month-day"
              autoCapitalize="none"
              keyboardType="numbers-and-punctuation"
              maxLength={10}
              style={overdue ? { borderColor: c.danger, color: c.danger, fontWeight: '700' } : undefined}
            />
          </View>
          {task.dueDate ? (
            <IconButton
              glyph="×"
              label="Clear due date"
              onPress={() => {
                setDueText('');
                void saveDue('');
              }}
            />
          ) : null}
        </View>
        {overdue ? <Text style={s.overdue}>Overdue</Text> : null}
        <SaveNote state={dueSave.state} />
      </Prop>

      <Prop label="Milestone">
        <View style={s.switchRow}>
          <Text style={s.switchText}>🏁 A key point of the project, shown on its dashboard</Text>
          <Switch
            value={!!task.isMilestone}
            disabled={milestoneSave.busy}
            accessibilityLabel="Milestone"
            onValueChange={(on) => void milestoneSave.run(() => onPatch({ isMilestone: on }), 'Couldn’t change the milestone.', true)}
            trackColor={{ true: c.brand, false: c.line }}
            thumbColor={c.surface}
          />
        </View>
        <SaveNote state={milestoneSave.state} />
      </Prop>

      <Prop label="Estimate (hours)">
        <TextField
          value={estText}
          onChangeText={(v) => {
            setEstText(v);
            if (estSave.state.status === 'error') estSave.reset();
          }}
          onBlur={() => void saveEstimate()}
          onSubmitEditing={() => void saveEstimate()}
          placeholder="e.g. 2.5"
          accessibilityLabel="Estimate in hours"
          keyboardType="decimal-pad"
        />
        <SaveNote state={estSave.state} />
      </Prop>

      <Prop label="Repeat">
        {!earlierCopy ? (
          <RecurrenceEditor
            value={ruleDraft !== undefined ? ruleDraft : task.recurrenceRule ?? null}
            onChange={(rule) => {
              setRuleDraft(rule);
              void repeatSave.run(() => onPatch({ recurrenceRule: rule }), 'Couldn’t save the repeat.', true).then((ok) => {
                if (!ok) setRuleDraft(undefined);
              });
            }}
            dueDate={task.dueDate}
            disabled={repeatSave.busy}
          />
        ) : (
          <Text style={s.muted}>An earlier copy of a repeating series — change the repeat on its newest copy.</Text>
        )}
        <SaveNote state={repeatSave.state} />
      </Prop>

      <Prop label="Assignees">
        <View style={s.chips}>
          {assignees.length === 0 ? <Text style={s.muted}>Unassigned</Text> : null}
          {assignees.map((a) => (
            <View key={a.id} style={s.person}>
              <Text style={s.personText}>{displayName(a)}</Text>
              <IconButton glyph="×" label={`Remove ${displayName(a)}`} onPress={() => void peopleSave.run(() => onUnassign(a.id), 'Couldn’t remove the assignee.', true)} />
            </View>
          ))}
          {!picking ? (
            <Pressable onPress={() => setPicking(true)} accessibilityRole="button" accessibilityLabel="Add assignee" style={s.addPerson}>
              <Text style={s.addPersonText}>+ Add assignee</Text>
            </Pressable>
          ) : null}
        </View>
        {picking ? (
          <KeyboardGroup style={s.picker}>
            <TextField value={query} onChangeText={setQuery} placeholder="Search by name…" accessibilityLabel="Find a teammate" autoFocus autoCapitalize="none" />
            {matches.length === 0 ? (
              <Text style={s.muted}>{members.length === assignedIds.size ? 'Everyone on the project is assigned.' : 'No teammate matches.'}</Text>
            ) : (
              matches.slice(0, 8).map((m) => (
                <Pressable
                  key={m.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Assign ${displayName(m)}`}
                  onPress={() => {
                    setQuery('');
                    void peopleSave.run(() => onAssign(m.id), 'Couldn’t assign this person.', true);
                  }}
                  style={({ pressed }) => [s.option, pressed && { backgroundColor: c.brandWash }]}
                >
                  <Text style={s.optionText}>{displayName(m)}</Text>
                  <Text style={s.optionSub}>@{m.username}</Text>
                </Pressable>
              ))
            )}
            <Button title="Done" variant="ghost" onPress={() => { setPicking(false); setQuery(''); }} />
          </KeyboardGroup>
        ) : null}
        <SaveNote state={peopleSave.state} />
      </Prop>

      <Prop label="Tags">
        {tagsDraft === null ? (
          <View style={s.chips}>
            {tags.length === 0 ? <Text style={s.muted}>No tags</Text> : null}
            {tags.map((t) => (
              <Chip key={t.id} label={t.name} dot={t.color} />
            ))}
            <Pressable onPress={() => { tagsSave.reset(); setTagsDraft(tags.map((t) => t.name).join(', ')); }} accessibilityRole="button" accessibilityLabel="Edit tags" style={s.addPerson}>
              <Text style={s.addPersonText}>✎ Edit</Text>
            </Pressable>
          </View>
        ) : (
          <KeyboardGroup style={{ gap: spacing.xs }}>
            <TextField value={tagsDraft} onChangeText={setTagsDraft} placeholder="comma, separated" accessibilityLabel="Tags, separated by commas" autoCapitalize="none" />
            <View style={s.row}>
              <Button title="Cancel" variant="ghost" onPress={() => setTagsDraft(null)} style={s.flex} />
              <Button
                title="Save tags"
                onPress={() => void tagsSave.run(() => onSaveTags(parseTags(tagsDraft)), 'Couldn’t save the tags.').then((ok) => ok && setTagsDraft(null))}
                loading={tagsSave.busy}
                style={s.flex}
              />
            </View>
          </KeyboardGroup>
        )}
        <SaveNote state={tagsSave.state} />
      </Prop>

      <Prop label={`Progress · ${task.progress}%`}>
        <View style={s.bar} importantForAccessibility="no-hide-descendants">
          <View style={[s.barFill, { width: `${task.progress}%` }]} />
        </View>
        <View style={s.row}>
          {[
            { title: '−25%', label: 'Decrease progress by 25 percent', value: task.progress - 25 },
            { title: '+25%', label: 'Increase progress by 25 percent', value: task.progress + 25 },
            { title: '100%', label: 'Set progress to 100 percent', value: 100 },
          ].map((b) => (
            <Button
              key={b.title}
              title={b.title}
              accessibilityLabel={b.label}
              variant={b.title === '100%' ? 'primary' : 'secondary'}
              onPress={() => void progressSave.run(() => onPatch({ progress: Math.max(0, Math.min(100, b.value)) }), 'Couldn’t update the progress.', true)}
              style={s.flex}
            />
          ))}
        </View>
        <SaveNote state={progressSave.state} />
      </Prop>
    </SectionCard>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    scope: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs, backgroundColor: c.ground, borderRadius: radius.md, padding: spacing.sm },
    scopeLabel: { fontSize: fontSize.xs, fontWeight: '700', color: c.ink2, marginRight: spacing.xs },
    chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs },
    aiBtn: { minHeight: 40, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: c.brand, justifyContent: 'center' },
    aiText: { fontSize: fontSize.sm, fontWeight: '800', color: c.brand },
    suggest: { gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md, backgroundColor: c.brandWash },
    suggestText: { fontSize: fontSize.sm, color: c.ink },
    row: { flexDirection: 'row', gap: spacing.sm },
    rowCenter: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 48 },
    switchText: { flex: 1, fontSize: fontSize.sm, color: c.ink2 },
    flex: { flex: 1 },
    overdue: { alignSelf: 'flex-start', fontSize: fontSize.xs, fontWeight: '800', color: c.danger, backgroundColor: c.dangerSoft, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 2 },
    muted: { fontSize: fontSize.sm, color: c.ink3 },
    person: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.pill, backgroundColor: c.brandWash, paddingLeft: spacing.md },
    personText: { fontSize: fontSize.sm, color: c.brand, fontWeight: '700' },
    addPerson: { minHeight: 40, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderStyle: 'dashed', borderColor: c.line, justifyContent: 'center' },
    addPersonText: { fontSize: fontSize.sm, color: c.ink2, fontWeight: '700' },
    picker: { gap: spacing.xs, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: c.line },
    option: { minHeight: 48, justifyContent: 'center', paddingHorizontal: spacing.sm, borderRadius: radius.sm },
    optionText: { fontSize: fontSize.md, color: c.ink, fontWeight: '600' },
    optionSub: { fontSize: fontSize.xs, color: c.ink3 },
    bar: { height: 8, backgroundColor: c.line, borderRadius: radius.pill, overflow: 'hidden' },
    barFill: { height: 8, backgroundColor: c.category.DONE },
  });
