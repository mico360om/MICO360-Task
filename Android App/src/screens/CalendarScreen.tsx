import React, { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMyTasks } from '../core/queries';
import { useColors } from '../core/theme';
import { groupTasksByDueDate } from '../lib/calendar';
import { companyTodayKey } from '../lib/due-date';
import { TaskRow } from '../components/TaskRow';
import { Loader, EmptyState, ErrorNote } from '../components/ui';
import { spacing, fontSize, type Palette } from '../lib/theme';
import type { AppScreenProps } from '../navigation/types';

/** Label a 'YYYY-MM-DD' calendar day without letting the phone's time zone shift it. */
function formatDay(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
}

export function CalendarScreen({ navigation }: AppScreenProps<'Calendar'>) {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { data: tasks, isLoading, isError, refetch, isRefetching } = useMyTasks();
  const days = useMemo(() => groupTasksByDueDate(tasks ?? []), [tasks]);
  // "Today" is the company-time-zone date (XP-03) — UTC would still say "yesterday" until 04:00 in Muscat.
  const today = companyTodayKey();

  if (isLoading) return <Loader />;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
      >
        {isError && !tasks ? (
          <ErrorNote message="Couldn't load your schedule." onRetry={() => void refetch()} retrying={isRefetching} />
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
