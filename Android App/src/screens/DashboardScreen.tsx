import React, { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMyTasks } from '../core/queries';
import { useSession } from '../core/providers';
import { useColors } from '../core/theme';
import { summarizeTasks } from '../lib/tasks-summary';
import { TaskRow } from '../components/TaskRow';
import { Card, SectionTitle, SkeletonList, EmptyState, ErrorNote, PageHeader, StatTile } from '../components/ui';
import { SyncStatus } from '../components/SyncStatus';
import { AdminTotals } from '../components/AdminTotals';
import { useQueryClient } from '@tanstack/react-query';
import { spacing, fontSize, type Palette } from '../lib/theme';
import type { TabScreenProps } from '../navigation/types';
import { font } from '../lib/typography';

export function DashboardScreen({ navigation }: TabScreenProps<'Dashboard'>) {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const session = useSession();
  const { data: tasks, isLoading, isError, refetch, isRefetching } = useMyTasks();
  const summary = useMemo(() => summarizeTasks(tasks ?? [], new Date()), [tasks]);
  // The all-projects totals are for administrators.
  const admin = !!session?.user.roles.includes('ADMIN');
  const qc = useQueryClient();

  if (isLoading) return <SkeletonList rows={6} />;

  const firstName = session?.user.username ?? 'there';
  const openTask = (id: string, title: string) => navigation.navigate('TaskDetail', { taskId: id, title });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => {
              void refetch();
              if (admin) void qc.invalidateQueries({ queryKey: ['dashboard', 'admin-totals'] });
            }}
          />
        }
      >
        <PageHeader title="Dashboard" />
        <Text style={styles.greeting}>Hi {firstName}</Text>
        <Text style={styles.sub}>Here&apos;s what needs your attention.</Text>

        <SyncStatus />

        {isError && !tasks ? (
          <ErrorNote message="Couldn't load your tasks." onRetry={() => void refetch()} retrying={isRefetching} />
        ) : null}

        <View style={styles.tiles}>
          <View style={styles.tile}>
            <StatTile label="Overdue" value={summary.overdue.length} icon="ui.alert" tone="danger" />
          </View>
          <View style={styles.tile}>
            <StatTile label="Due today" value={summary.dueToday.length} icon="kit.calendar" tone="warning" />
          </View>
          <View style={styles.tile}>
            <StatTile label="Upcoming" value={summary.upcoming.length} icon="kit.clock" tone="info" />
          </View>
          <View style={styles.tile}>
            <StatTile label="Completed" value={summary.completed} icon="kit.checkCircle" tone="success" />
          </View>
        </View>

        {/* Administrators: every project's totals, as on the website's dashboard (5b). */}
        {admin ? <AdminTotals onOpenReports={() => navigation.navigate('Reports')} /> : null}

        {summary.overdue.length > 0 && (
          <Section title="Overdue" styles={styles}>
            {summary.overdue.slice(0, 5).map((t) => (
              <TaskRow key={t.id} task={t} onPress={() => openTask(t.id, t.title)} />
            ))}
          </Section>
        )}

        <Section title="Due today" styles={styles}>
          {summary.dueToday.length === 0 ? (
            <Card padded={false}>
              <EmptyState icon="kit.checkCircle" title="Nothing due today." />
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

        {summary.total === 0 && !(isError && !tasks) && (
          <EmptyState title="No tasks yet" subtitle="Tasks assigned to you will show up here." />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

type Styles = ReturnType<typeof makeStyles>;

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
    greeting: { fontSize: fontSize.xxl, ...font('800', 'display'), color: c.ink },
    sub: { fontSize: fontSize.md, color: c.ink2, marginBottom: spacing.sm },
    tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    tile: { flexGrow: 1, flexBasis: '47%' },
    section: { gap: spacing.sm },
  });
