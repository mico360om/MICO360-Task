import React, { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMyTasks } from '../core/queries';
import { useSession } from '../core/providers';
import { useColors } from '../core/theme';
import { summarizeTasks } from '../lib/tasks-summary';
import { TaskRow } from '../components/TaskRow';
import { Card, SectionTitle, Loader, EmptyState, ErrorNote } from '../components/ui';
import { spacing, fontSize, radius, type Palette } from '../lib/theme';
import type { TabScreenProps } from '../navigation/types';

export function DashboardScreen({ navigation }: TabScreenProps<'Dashboard'>) {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const session = useSession();
  const { data: tasks, isLoading, isError, refetch, isRefetching } = useMyTasks();
  const summary = useMemo(() => summarizeTasks(tasks ?? [], new Date()), [tasks]);

  if (isLoading) return <Loader />;

  const firstName = session?.user.username ?? 'there';
  const openTask = (id: string, title: string) => navigation.navigate('TaskDetail', { taskId: id, title });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
      >
        <Text style={styles.greeting}>Hi {firstName}</Text>
        <Text style={styles.sub}>Here&apos;s what needs your attention.</Text>

        {isError && !tasks ? <ErrorNote message="Couldn't reach the server. Showing what we have." /> : null}

        <View style={styles.tiles}>
          <Tile label="Overdue" value={summary.overdue.length} tone={c.danger} styles={styles} />
          <Tile label="Due today" value={summary.dueToday.length} tone={c.category.IN_PROGRESS} styles={styles} />
          <Tile label="Upcoming" value={summary.upcoming.length} tone={c.category.REVIEW} styles={styles} />
          <Tile label="Completed" value={summary.completed} tone={c.category.DONE} styles={styles} />
        </View>

        {summary.overdue.length > 0 && (
          <Section title="Overdue" styles={styles}>
            {summary.overdue.slice(0, 5).map((t) => (
              <TaskRow key={t.id} task={t} onPress={() => openTask(t.id, t.title)} />
            ))}
          </Section>
        )}

        <Section title="Due today" styles={styles}>
          {summary.dueToday.length === 0 ? (
            <Card>
              <Text style={styles.clear}>Nothing due today. 🎉</Text>
            </Card>
          ) : (
            summary.dueToday.map((t) => <TaskRow key={t.id} task={t} onPress={() => openTask(t.id, t.title)} />)
          )}
        </Section>

        {summary.upcoming.length > 0 && (
          <Section title="Upcoming" styles={styles}>
            {summary.upcoming.slice(0, 5).map((t) => (
              <TaskRow key={t.id} task={t} onPress={() => openTask(t.id, t.title)} />
            ))}
          </Section>
        )}

        {summary.total === 0 && <EmptyState title="No tasks yet" subtitle="Tasks assigned to you will show up here." />}
      </ScrollView>
    </SafeAreaView>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function Tile({ label, value, tone, styles }: { label: string; value: number; tone: string; styles: Styles }) {
  return (
    <View style={styles.tile}>
      <Text style={[styles.tileValue, { color: tone }]}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

function Section({ title, children, styles }: { title: string; children: React.ReactNode; styles: Styles }) {
  return (
    <View style={styles.section}>
      <SectionTitle>{title}</SectionTitle>
      <View style={{ gap: spacing.sm }}>{children}</View>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.ground },
    scroll: { padding: spacing.lg, gap: spacing.md },
    greeting: { fontSize: fontSize.xxl, fontWeight: '800', color: c.ink },
    sub: { fontSize: fontSize.md, color: c.ink2, marginBottom: spacing.sm },
    tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    tile: {
      flexGrow: 1,
      flexBasis: '47%',
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.line,
      padding: spacing.lg,
    },
    tileValue: { fontSize: fontSize.xxl, fontWeight: '800' },
    tileLabel: { fontSize: fontSize.sm, color: c.ink2, marginTop: 2 },
    section: { gap: spacing.sm },
    clear: { color: c.ink2, fontSize: fontSize.md },
  });
