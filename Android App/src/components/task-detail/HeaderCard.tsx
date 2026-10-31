import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, Modal, StyleSheet } from 'react-native';
import { useColors } from '../../core/theme';
import { ClientChip, InspectionChip, TextField, Button, IconButton, PriorityBadge } from '../ui';
import { KeyboardGroup } from '../KeyboardAware';
import { Icon } from '../Icon';
import { categoryColorOf, spacing, radius, fontSize, type Palette } from '../../lib/theme';
import type { ApiTask } from '../../lib/types';
import { recurrenceSummary } from '../../lib/recurrence-summary';
import { FORMERLY_HINT, carryForward, formerKeysText } from '../../lib/task-detail';
import { SaveNote, Tag, useSave } from './kit';
import { font, typeStyle } from '../../lib/typography';

/** The task title column's limit (VARCHAR 191). */
const TITLE_MAX = 191;

/**
 * The top of the task, as the website's: reference (and "Formerly RIG-4" after a move to another
 * project), status, priority, the Inspection and Visible to client marks and the due date at a
 * glance; the title (edited in place); a menu (the three dots) for the secondary actions (watching,
 * exporting). A task waiting for approval says so in its Approval section, shown first (as on the
 * website). A task made from a meeting names that meeting; tapping it opens the meeting in the app.
 */
export function HeaderCard({
  task,
  statusName,
  statusCategory,
  due,
  onSaveTitle,
  watching,
  watcherCount,
  onToggleWatch,
  onExport,
  exporting,
  meeting,
  onOpenMeeting,
  onEdit,
}: {
  /** Opens the full Edit form (every detail at once — 4d), as the website's "Edit task". */
  onEdit?: () => void;
  task: ApiTask;
  statusName?: string;
  statusCategory?: string;
  due: { text: string | null; overdue: boolean };
  onSaveTitle?: (title: string) => Promise<unknown>;
  watching: boolean;
  watcherCount: number;
  onToggleWatch: () => void;
  onExport: (format: 'xlsx' | 'pdf') => void;
  exporting: 'xlsx' | 'pdf' | null;
  /** The meeting the task was created from (see meetingLine); meetingId is null when the viewer isn't part of it. */
  meeting?: { text: string; meetingId: string | null } | null;
  /** Opens that meeting in the app. */
  onOpenMeeting?: (meetingId: string) => void;
}) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const [draft, setDraft] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const save = useSave();
  // Moved on to the next day's board, and when (per-date boards — 4d): tapped, each move.
  const carried = carryForward(task.carryForwardLog);
  const formerly = formerKeysText(task.formerKeys);
  const [carryOpen, setCarryOpen] = useState(false);

  async function commit() {
    if (draft === null) return;
    const title = draft.trim();
    if (!title) {
      save.fail('A title is required.');
      return;
    }
    if (title === task.title) {
      setDraft(null);
      return;
    }
    if (await save.run(() => onSaveTitle?.(title), 'Couldn’t save the title.', true)) setDraft(null);
  }

  const action = (label: string, act: () => void, a11y?: string) => (
    <Pressable
      key={label}
      accessibilityRole="menuitem"
      accessibilityLabel={a11y ?? label}
      onPress={() => {
        setMenu(false);
        act();
      }}
      style={({ pressed }) => [s.menuItem, pressed && { backgroundColor: c.ground }]}
    >
      <Text style={s.menuText}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={s.wrap}>
      <View style={s.topRow}>
        <View style={s.meta}>
          <Text style={s.key}>{task.key}</Text>
          {formerly ? (
            <Text style={s.formerly} accessibilityHint={FORMERLY_HINT}>
              {formerly}
            </Text>
          ) : null}
          {statusName ? <Tag label={statusName} color={categoryColorOf(c, statusCategory ?? 'TODO')} /> : null}
          <PriorityBadge priority={task.priority} />
          {task.inspectionFormId ? <InspectionChip size="sm" /> : null}
          {task.clientVisible ? <ClientChip /> : null}
          {due.text ? <Tag label={due.text} tone={due.overdue ? 'danger' : undefined} /> : null}
        </View>
        {onEdit ? (
          <Button title="Edit" icon="ui.edit" variant="secondary" size="sm" onPress={onEdit} accessibilityLabel="Edit task" accessibilityHint="Edit every detail of the task" />
        ) : null}
        <IconButton icon="misc.dots" label="More actions" onPress={() => setMenu(true)} color={c.brandText} />
      </View>

      {draft === null ? (
        <View style={s.titleRow}>
          <Text style={s.title} accessibilityRole="header">
            {task.title}
          </Text>
          {onSaveTitle ? <IconButton icon="ui.edit" label="Edit title" onPress={() => { save.reset(); setDraft(task.title); }} /> : null}
        </View>
      ) : (
        // Typing keeps the title and its Save / Cancel above the keyboard.
        <KeyboardGroup>
          <TextField
            label="Title"
            value={draft}
            onChangeText={setDraft}
            maxLength={TITLE_MAX}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={() => void commit()}
          />
          <View style={s.editActions}>
            <Button title="Cancel" variant="ghost" onPress={() => { setDraft(null); save.reset(); }} style={s.flex} />
            <Button title="Save" accessibilityLabel="Save title" onPress={() => void commit()} loading={save.busy} style={s.flex} />
          </View>
        </KeyboardGroup>
      )}
      <SaveNote state={save.state} />
      {task.recurrenceRule ? (
        <View style={s.line}>
          <Icon name="kit.repeat" size={14} color={c.brandText} />
          <Text style={s.recurrence}>{recurrenceSummary(task.recurrenceRule)}</Text>
        </View>
      ) : task.recurrenceParentId ? (
        <View style={s.line}>
          <Icon name="kit.repeat" size={14} color={c.brandText} />
          <Text style={s.recurrence}>Part of a repeating series</Text>
        </View>
      ) : null}
      {task.isMilestone ? (
        <View style={s.line}>
          <Icon name="misc.milestone" size={14} color={c.brandText} />
          <Text style={s.recurrence}>Milestone</Text>
        </View>
      ) : null}
      {carried ? (
        <View>
          <Pressable
            onPress={() => setCarryOpen((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={carried.label}
            accessibilityHint={carryOpen ? 'Hides the days it moved' : 'Shows the days it moved'}
            accessibilityState={{ expanded: carryOpen }}
            style={({ pressed }) => [s.carry, pressed && { opacity: 0.6 }]}
          >
            <View style={s.carryPill}>
              <Text style={s.carryText}>{carried.text}</Text>
              <Icon name="ui.chevron" size={14} color={c.ink2} rotate={carryOpen ? 180 : 0} />
            </View>
          </Pressable>
          {carryOpen ? carried.lines.map((line) => (
            <Text key={line} style={s.carryLine}>
              {line}
            </Text>
          )) : null}
        </View>
      ) : null}
      {meeting?.meetingId ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={meeting.text}
          accessibilityHint="Opens the meeting"
          onPress={() => onOpenMeeting?.(meeting.meetingId!)}
          style={({ pressed }) => [s.meetingLink, pressed && { opacity: 0.6 }]}
        >
          <View style={s.line}>
            <Icon name="kit.calendar" size={14} color={c.brandText} />
            <Text style={s.meetingText}>{meeting.text}</Text>
            <Icon name="ui.chevron" rotate={270} size={14} color={c.brandText} />
          </View>
        </Pressable>
      ) : meeting ? (
        <View style={s.line}>
          <Icon name="kit.calendar" size={14} color={c.ink3} />
          <Text style={s.meetingMuted}>{meeting.text}</Text>
        </View>
      ) : null}

      <Modal visible={menu} transparent animationType="fade" onRequestClose={() => setMenu(false)}>
        <Pressable style={s.backdrop} onPress={() => setMenu(false)} accessibilityLabel="Close menu">
          <View style={s.sheet} accessibilityRole="menu">
            <Text style={s.sheetTitle}>{task.key}</Text>
            {action(watching ? `Stop watching (${watcherCount})` : `Watch this task${watcherCount ? ` (${watcherCount})` : ''}`, onToggleWatch, watching ? 'Stop watching this task' : 'Watch this task')}
            {action(exporting === 'xlsx' ? 'Preparing Excel…' : 'Export as Excel', () => onExport('xlsx'))}
            {action(exporting === 'pdf' ? 'Preparing PDF…' : 'Export as PDF', () => onExport('pdf'))}
            {action('Cancel', () => {})}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    wrap: { gap: spacing.xs },
    topRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    meta: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs },
    key: { fontSize: fontSize.xs, ...font('800'), color: c.brandText, letterSpacing: 1, marginRight: spacing.xs },
    formerly: { ...typeStyle('caption'), color: c.ink2 },
    titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
    title: { flex: 1, fontSize: fontSize.xl, ...font('700', 'display'), color: c.ink, paddingTop: spacing.xs },
    editActions: { flexDirection: 'row', gap: spacing.sm },
    flex: { flex: 1 },
    line: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    recurrence: { flexShrink: 1, fontSize: fontSize.sm, color: c.brandText, ...font('600') },
    carry: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
    carryPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: c.ground, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 4 },
    carryText: { flexShrink: 1, fontSize: fontSize.sm, color: c.ink2, ...font('600') },
    carryLine: { fontSize: fontSize.xs, color: c.ink2, paddingLeft: spacing.md, paddingVertical: 2 },
    meetingLink: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
    meetingText: { flexShrink: 1, fontSize: fontSize.sm, color: c.brandText, ...font('600'), textDecorationLine: 'underline' },
    meetingMuted: { flexShrink: 1, fontSize: fontSize.sm, color: c.ink3, ...font('600') },
    backdrop: { flex: 1, backgroundColor: c.scrim, justifyContent: 'flex-end' },
    sheet: { backgroundColor: c.surface, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, paddingVertical: spacing.sm, paddingBottom: spacing.xl },
    sheetTitle: { fontSize: fontSize.xs, ...font('800'), color: c.ink3, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, letterSpacing: 1 },
    menuItem: { minHeight: 52, justifyContent: 'center', paddingHorizontal: spacing.lg },
    menuText: { fontSize: fontSize.md, color: c.ink, ...font('600') },
  });
