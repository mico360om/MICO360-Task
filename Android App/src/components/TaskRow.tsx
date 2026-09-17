import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { spacing, radius, fontSize, type Palette } from '../lib/theme';
import { useColors } from '../core/theme';
import { taskRowA11yLabel } from '../lib/task-a11y';
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

export function formatDue(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function TaskRow({ task, onPress }: { task: ApiTask; onPress?: () => void }) {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const due = formatDue(task.dueDate);
  const done = !!task.completedAt;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={taskRowA11yLabel(task, due, done)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={[styles.priority, { backgroundColor: priorityColor(c, task.priority) }]} />
      <View style={styles.body}>
        <Text style={[styles.title, done && styles.doneTitle]} numberOfLines={2}>
          {task.title}
        </Text>
        <View style={styles.meta}>
          <Text style={styles.key}>{task.key}</Text>
          {due ? <Text style={styles.due}>· Due {due}</Text> : null}
          {task.progress > 0 && !done ? <Text style={styles.progress}>· {task.progress}%</Text> : null}
          {done ? <Text style={styles.doneTag}>· Done</Text> : null}
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
    progress: { fontSize: fontSize.xs, color: c.category.IN_PROGRESS, marginLeft: 4, fontWeight: '600' },
    doneTag: { fontSize: fontSize.xs, color: c.category.DONE, marginLeft: 4, fontWeight: '600' },
  });
