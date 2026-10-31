import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { spacing, radius, fontSize, type Palette } from '../lib/theme';
import { useColors } from '../core/theme';
import { taskRowA11yLabel } from '../lib/task-a11y';
import { formatDueDay, isOverdue, isTaskDone } from '../lib/due-date';
import type { ApiTask, Priority } from '../lib/types';
import { font } from '../lib/typography';
import { Icon } from './Icon';
import { PriorityBadge } from './ui';
import { capLines } from './ui/text-lines';

export function priorityColor(c: Palette, p: Priority): string {
  switch (p) {
    case 'LOW':
      return c.ink3;
    case 'NORMAL':
      return c.category.REVIEW;
    case 'HIGH':
      return c.category.IN_PROGRESS;
    case 'URGENT':
      return c.danger;
  }
}

/** The due day for display — its own calendar day, never shifted by the phone's time zone (XP-03). */
export function formatDue(iso: string | null): string | null {
  try {
    return formatDueDay(iso);
  } catch {
    return iso ? iso.slice(0, 10) : null;
  }
}

export function TaskRow({ task, onPress, onLongPress }: { task: ApiTask; onPress?: () => void; onLongPress?: () => void }) {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const due = formatDue(task.dueDate);
  const done = isTaskDone(task);
  // Overdue only once the due day has passed in company time; finished tasks never are (XP-03).
  const overdue = isOverdue(task);
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={`${taskRowA11yLabel(task, due, done)}${overdue ? ', overdue' : ''}`}
      accessibilityHint={onLongPress ? 'Long-press to move it to another column' : undefined}
      accessibilityActions={onLongPress ? [{ name: 'longpress', label: 'Move to another column' }] : undefined}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'longpress') onLongPress?.();
      }}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.body}>
        <Text style={[styles.title, done && styles.doneTitle]} numberOfLines={capLines(2)}>
          {task.title}
        </Text>
        <View style={styles.meta}>
          <Text style={styles.key}>{task.key}</Text>
          {due ? <Text style={[styles.due, overdue && styles.overdue]}>· {overdue ? 'Overdue' : 'Due'} {due}</Text> : null}
          {task.progress > 0 && !done ? <Text style={styles.progress}>· {task.progress}%</Text> : null}
          {done ? <Text style={styles.doneTag}>· Done</Text> : null}
          {task.recurrenceRule ? (
            <View style={styles.mark}>
              <Text style={styles.key}>·</Text>
              <Icon name="kit.repeat" size={12} color={c.ink2} />
            </View>
          ) : null}
          {task.isMilestone ? (
            <View style={styles.mark}>
              <Text style={styles.milestone}>·</Text>
              <Icon name="misc.milestone" size={12} color={c.brandText} />
              <Text style={styles.milestone}>Milestone</Text>
            </View>
          ) : null}
        </View>
      </View>
      <PriorityBadge priority={task.priority} />
    </Pressable>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.surface,
      borderRadius: radius.button,
      borderWidth: 1,
      borderColor: c.line,
      padding: spacing.md,
      gap: spacing.md,
    },
    pressed: { opacity: 0.7 },
    body: { flex: 1 },
    mark: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 4 },
    title: { fontSize: fontSize.md, ...font('600'), color: c.ink },
    doneTitle: { textDecorationLine: 'line-through', color: c.ink2 },
    meta: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 2 },
    key: { fontSize: fontSize.xs, color: c.ink2, ...font('600') },
    due: { fontSize: fontSize.xs, color: c.ink2, marginLeft: 4 },
    overdue: { color: c.dangerText, ...font('700') },
    progress: { fontSize: fontSize.xs, color: c.warningText, marginLeft: 4, ...font('600') },
    doneTag: { fontSize: fontSize.xs, color: c.successText, marginLeft: 4, ...font('600') },
    milestone: { fontSize: fontSize.xs, color: c.brandText, ...font('700') },
  });
