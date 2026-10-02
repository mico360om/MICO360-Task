import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { spacing, radius, fontSize, type Palette } from '../lib/theme';
import { useColors } from '../core/theme';
import { taskRowA11yLabel } from '../lib/task-a11y';
import { formatDueDay, isOverdue } from '../lib/due-date';
import type { ApiTask, Priority } from '../lib/types';

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
  const done = !!task.completedAt;
  // Overdue only once the due day has passed in company time; completed tasks never are (XP-03).
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
      <View style={[styles.priority, { backgroundColor: priorityColor(c, task.priority) }]} />
      <View style={styles.body}>
        <Text style={[styles.title, done && styles.doneTitle]} numberOfLines={2}>
          {task.title}
        </Text>
        <View style={styles.meta}>
          <Text style={styles.key}>{task.key}</Text>
          {due ? <Text style={[styles.due, overdue && styles.overdue]}>· {overdue ? 'Overdue' : 'Due'} {due}</Text> : null}
          {task.progress > 0 && !done ? <Text style={styles.progress}>· {task.progress}%</Text> : null}
          {done ? <Text style={styles.doneTag}>· Done</Text> : null}
          {task.recurrenceRule ? <Text style={styles.key}>· 🔁</Text> : null}
        </View>
      </View>
    </Pressable>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.line,
      padding: spacing.md,
      gap: spacing.md,
    },
    pressed: { opacity: 0.7 },
    priority: { width: 6, alignSelf: 'stretch', borderRadius: radius.pill },
    body: { flex: 1 },
    title: { fontSize: fontSize.md, fontWeight: '600', color: c.ink },
    doneTitle: { textDecorationLine: 'line-through', color: c.ink2 },
    meta: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 2 },
    key: { fontSize: fontSize.xs, color: c.ink2, fontWeight: '600' },
    due: { fontSize: fontSize.xs, color: c.ink2, marginLeft: 4 },
    overdue: { color: c.danger, fontWeight: '700' },
    progress: { fontSize: fontSize.xs, color: c.category.IN_PROGRESS, marginLeft: 4, fontWeight: '600' },
    doneTag: { fontSize: fontSize.xs, color: c.category.DONE, marginLeft: 4, fontWeight: '600' },
  });
