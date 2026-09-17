import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMyTasks } from '../core/queries';
import { useColors } from '../core/theme';
import { summarizeTasks } from '../lib/tasks-summary';
import { TaskRow } from '../components/TaskRow';
import { SectionTitle, Loader, EmptyState, ErrorNote, TextField } from '../components/ui';
import { spacing, radius, fontSize, type Palette } from '../lib/theme';
import type { ApiTask, Priority } from '../lib/types';
import type { TabScreenProps } from '../navigation/types';

const PRIORITIES: Priority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

export function MyTasksScreen({ navigation }: TabScreenProps<'MyTasks'>) {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { data: tasks, isLoading, isError, refetch, isRefetching } = useMyTasks();

  const [q, setQ] = useState('');
  const [priority, setPriority] = useState<Priority | null>(null);

  // Client-side keyword + priority filter over the already-loaded list (instant, offline-friendly).
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (tasks ?? []).filter((t) => {
      if (priority && t.priority !== priority) return false;
      if (needle) {
        const hay = `${t.title} ${t.description ?? ''} ${t.key}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [tasks, q, priority]);

  const summary = useMemo(() => summarizeTasks(filtered, new Date()), [filtered]);
  const completed = useMemo(() => filtered.filter((t) => t.completedAt), [filtered]);
  const noDue = useMemo(() => filtered.filter((t) => !t.dueDate && !t.completedAt), [filtered]);

  if (isLoading) return <Loader />;

  const open = (t: ApiTask) => navigation.navigate('TaskDetail', { taskId: t.id, title: t.title });
  const active = q.trim() !== '' || priority !== null;
  const groups: [string, ApiTask[]][] = [
    ['Overdue', summary.overdue],
    ['Due today', summary.dueToday],
    ['Upcoming', summary.upcoming],
    ['No due date', noDue],
    ['Completed', completed],
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
      >
        <View style={styles.filterBar}>
          <TextField value={q} onChangeText={setQ} placeholder="Search my tasks…" autoCapitalize="none" style={styles.searchInput} />
          <View style={styles.chips}>
            {PRIORITIES.map((p) => {
              const on = priority === p;
              return (
                <Pressable
                  key={p}
                  onPress={() => setPriority(on ? null : p)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`${p} priority filter`}
                  hitSlop={8}
                  style={[styles.chip, on && styles.chipOn]}
                >
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{p}</Text>
                </Pressable>
              );
            })}
            {active ? (
              <Pressable onPress={() => { setQ(''); setPriority(null); }} style={styles.reset} accessibilityRole="button" accessibilityLabel="Reset filters" hitSlop={8}>
                <Text style={styles.resetText}>Reset</Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        {isError && !tasks ? (
          <ErrorNote message="Couldn't load your tasks. Pull down to retry." />
        ) : (tasks ?? []).length === 0 ? (
          <EmptyState title="No tasks assigned" subtitle="You're all clear." />
        ) : filtered.length === 0 ? (
          <EmptyState title="No matches" subtitle="Try a different search or filter." />
        ) : (
          groups
            .filter(([, list]) => list.length > 0)
            .map(([label, list]) => (
              <View key={label} style={styles.section}>
                <SectionTitle>
                  {label} · {list.length}
                </SectionTitle>
                <View style={{ gap: spacing.sm }}>
                  {list.map((t) => (
                    <TaskRow key={t.id} task={t} onPress={() => open(t)} />
                  ))}
                </View>
              </View>
            ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.ground },
    scroll: { padding: spacing.lg, gap: spacing.md },
    section: { gap: spacing.sm },
    filterBar: { gap: spacing.sm },
    searchInput: { marginBottom: 0 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
    chip: {
      borderWidth: 1,
      borderColor: c.line,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
    },
    chipOn: { borderColor: c.brand, backgroundColor: c.brandWash },
    chipText: { fontSize: fontSize.xs, color: c.ink2, fontWeight: '700' },
    chipTextOn: { color: c.brand },
    reset: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
    resetText: { fontSize: fontSize.xs, color: c.brand, fontWeight: '700' },
  });
