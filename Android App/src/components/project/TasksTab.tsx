import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useColors } from '../../core/theme';
import { TextField } from '../ui';
import { FilterChips } from './parts';
import { priorityColor } from '../TaskRow';
import { formatDueDay } from '../../lib/due-date';
import { TASK_FILTERS, shownProgress, taskPeople, taskPhase, tasksTabRowLabel, type TaskFilter, type TaskGroup } from '../../lib/project-dashboard';
import { categoryColorOf, spacing, radius, fontSize, type Palette } from '../../lib/theme';
import type { ApiTask } from '../../lib/types';

/** What the Tasks tab's list shows, row by row: a status column's heading, then its tasks. */
export type TasksTabItem = { kind: 'group'; group: TaskGroup } | { kind: 'task'; task: ApiTask; group: TaskGroup };

export function tasksTabItems(groups: TaskGroup[]): TasksTabItem[] {
  return groups.flatMap((g) => [{ kind: 'group' as const, group: g }, ...g.tasks.map((t) => ({ kind: 'task' as const, task: t, group: g }))]);
}

/** The filters (with counts) and the search above the Tasks tab's list. */
export function TasksTabBar({
  counts,
  filter,
  onFilter,
  query,
  onQuery,
}: {
  counts: Record<TaskFilter, number>;
  filter: TaskFilter;
  onFilter: (f: TaskFilter) => void;
  query: string;
  onQuery: (q: string) => void;
}) {
  return (
    <View>
      <FilterChips
        label="Show tasks"
        options={TASK_FILTERS.map((f) => ({ value: f.value, label: f.label, count: counts[f.value], danger: f.value === 'overdue' && counts.overdue > 0 }))}
        value={filter}
        onChange={onFilter}
      />
      <TextField value={query} onChangeText={onQuery} placeholder="Find a task…" accessibilityLabel="Find a task" autoCapitalize="none" autoCorrect={false} returnKeyType="search" />
    </View>
  );
}

/** A status column's heading in the Tasks tab. */
export function TaskGroupHeading({ group }: { group: TaskGroup }) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const color = group.color ?? (group.category ? categoryColorOf(c, group.category) : c.ink3);
  return (
    <View style={s.heading} accessible accessibilityRole="header" accessibilityLabel={`${group.name}, ${group.tasks.length}`}>
      <View style={[s.dot, { backgroundColor: color }]} />
      <Text style={s.headingText}>{group.name}</Text>
      <View style={s.count}>
        <Text style={s.countText}>{group.tasks.length}</Text>
      </View>
    </View>
  );
}

/** One task of the Tasks tab: key, milestone, title, status, priority, progress, people and due day. */
export const TasksTabRow = React.memo(function TasksTabRow({ task, group, today, onOpen }: { task: ApiTask; group: TaskGroup; today: string; onOpen: (t: ApiTask) => void }) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const phase = taskPhase(task, today);
  const progress = shownProgress(task, phase);
  const due = formatDueDay(task.dueDate);
  const people = taskPeople(task);
  const overdue = phase === 'overdue';
  const statusColor = group.color ?? (group.category ? categoryColorOf(c, group.category) : c.ink3);
  return (
    <Pressable
      onPress={() => onOpen(task)}
      accessibilityRole="button"
      accessibilityLabel={tasksTabRowLabel(task, { statusName: group.name, phase, dueText: due })}
      accessibilityHint="Opens the task"
      style={({ pressed }) => [s.row, pressed && s.pressed]}
    >
      <View style={s.top}>
        <Text style={s.key}>{task.key}</Text>
        {task.isMilestone ? (
          <Text style={s.flag} importantForAccessibility="no">
            🏁
          </Text>
        ) : null}
        <Text style={[s.title, phase === 'completed' && s.doneTitle]} numberOfLines={2}>
          {task.title}
        </Text>
      </View>
      <View style={s.meta}>
        <View style={s.status}>
          <View style={[s.smallDot, { backgroundColor: statusColor }]} />
          <Text style={s.metaText}>{group.name}</Text>
        </View>
        <View style={[s.priority, { borderColor: priorityColor(c, task.priority) }]}>
          <Text style={[s.metaText, { color: priorityColor(c, task.priority) }]}>{task.priority.charAt(0) + task.priority.slice(1).toLowerCase()}</Text>
        </View>
        <View style={s.progress}>
          <View style={s.track}>
            <View style={[s.fill, { width: `${progress}%`, backgroundColor: phase === 'completed' ? c.success : c.brand }]} />
          </View>
          <Text style={s.metaText}>{progress}%</Text>
        </View>
        <Text style={s.metaText} numberOfLines={1}>
          {people.length ? people.map((p) => p.name).join(', ') : 'Unassigned'}
        </Text>
        <Text style={[s.metaText, overdue && s.overdue]}>
          {overdue ? 'Overdue · ' : ''}
          {due ?? 'No due date'}
        </Text>
      </View>
    </Pressable>
  );
});

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    pressed: { opacity: 0.7 },
    heading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingTop: spacing.md, paddingBottom: spacing.xs },
    dot: { width: 10, height: 10, borderRadius: 5 },
    headingText: { fontSize: fontSize.md, fontWeight: '800', color: c.ink, flexShrink: 1 },
    count: { backgroundColor: c.ground, borderRadius: radius.pill, paddingHorizontal: spacing.sm },
    countText: { fontSize: fontSize.xs, fontWeight: '700', color: c.ink2 },
    row: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs, marginBottom: spacing.sm, minHeight: 56 },
    top: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
    key: { fontSize: fontSize.xs, fontWeight: '700', color: c.ink3, marginTop: 3 },
    flag: { fontSize: fontSize.sm, marginTop: 1 },
    title: { flex: 1, fontSize: fontSize.md, fontWeight: '600', color: c.ink },
    doneTitle: { color: c.ink2 },
    meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: spacing.sm, rowGap: 4 },
    status: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: c.ground, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 2 },
    smallDot: { width: 8, height: 8, borderRadius: 4 },
    priority: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 6 },
    progress: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    track: { width: 48, height: 6, borderRadius: 3, backgroundColor: c.ground, overflow: 'hidden' },
    fill: { height: 6, borderRadius: 3 },
    metaText: { fontSize: fontSize.xs, color: c.ink2 },
    overdue: { color: c.danger, fontWeight: '700' },
  });
