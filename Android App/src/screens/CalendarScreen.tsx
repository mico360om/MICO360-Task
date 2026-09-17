import React, { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMyTasks } from '../core/queries';
import { useColors } from '../core/theme';
import { groupTasksByDueDate } from '../lib/calendar';
import { TaskRow } from '../components/TaskRow';
import { Loader, EmptyState, ErrorNote } from '../components/ui';
import { spacing, fontSize, type Palette } from '../lib/theme';
import type { AppScreenProps } from '../navigation/types';

function formatDay(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export function CalendarScreen({ navigation }: AppScreenProps<'Calendar'>) {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { data: tasks, isLoading, isError, refetch, isRefetching } = useMyTasks();
  const days = useMemo(() => groupTasksByDueDate(tasks ?? []), [tasks]);
  const today = new Date().toISOString().slice(0, 10);

  if (isLoading) return <Loader />;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
      >
        {isError && !tasks ? (
          <ErrorNote message="Couldn't load your schedule. Pull down to retry." />
        ) : days.length === 0 ? (
          <EmptyState title="Nothing scheduled" subtitle="Tasks with a due date will show up on your calendar." />
        ) : (
          days.map((day) => (
            <View key={day.date} style={styles.day}>
              <Text style={[styles.dayLabel, day.date === today && styles.today]}>
                {formatDay(day.date)}
                {day.date === today ? '  · Today' : ''}
              </Text>
              <View style={{ gap: spacing.sm }}>
                {day.tasks.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    onPress={() => navigation.navigate('TaskDetail', { taskId: t.id, title: t.title })}
                  />
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
    scroll: { padding: spacing.lg, gap: spacing.lg },
    day: { gap: spacing.sm },
    dayLabel: { fontSize: fontSize.md, fontWeight: '700', color: c.ink },
    today: { color: c.brand },
  });
