import React, { useEffect, useMemo, useRef } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCalendarMeetings, useMyTasks } from '../core/queries';
import { useColors } from '../core/theme';
import { buildAgenda } from '../lib/meetings';
import { calendarTimeZone, companyTodayKey } from '../lib/due-date';
import { TaskRow } from '../components/TaskRow';
import { MeetingRow } from '../components/MeetingRow';
import { Loader, EmptyState, ErrorNote } from '../components/ui';
import { spacing, fontSize, type Palette } from '../lib/theme';
import type { AppScreenProps } from '../navigation/types';

/** Label a 'YYYY-MM-DD' calendar day without letting the phone's time zone shift it. */
function formatDay(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
}

/** Your schedule: the tasks due each day, with the meetings on that day (a week back, two months ahead). */
export function CalendarScreen({ navigation }: AppScreenProps<'Calendar'>) {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { data: tasks, isLoading, isError, refetch, isRefetching } = useMyTasks();
  const meetingsQ = useCalendarMeetings();
  // As on the website, the calendar is in your own time zone (else the company's).
  const timeZone = calendarTimeZone();
  const days = useMemo(() => buildAgenda(tasks ?? [], meetingsQ.data ?? [], timeZone), [tasks, meetingsQ.data, timeZone]);
  // "Today" is that zone's date (XP-03) — UTC would still say "yesterday" until 04:00 in Muscat.
  const today = companyTodayKey(new Date(), timeZone);
  // The list opens at today (or the next day with something on it); earlier days are above.
  const scrollRef = useRef<ScrollView>(null);
  const opened = useRef(false);
  const dayY = useRef(new Map<string, number>());
  const startDay = meetingsQ.isLoading ? undefined : days.find((d) => d.date >= today)?.date;
  const openAtStart = () => {
    const y = startDay ? dayY.current.get(startDay) : undefined;
    if (opened.current || y === undefined) return;
    opened.current = true;
    scrollRef.current?.scrollTo({ y: Math.max(0, y - spacing.lg), animated: false });
  };
  // Once the meetings are in, whichever comes last: the start day known, or its place laid out.
  useEffect(openAtStart, [startDay]);

  if (isLoading) return <Loader />;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching || meetingsQ.isRefetching}
            onRefresh={() => {
              void refetch();
              void meetingsQ.refetch();
            }}
          />
        }
      >
        {meetingsQ.isError && !meetingsQ.data ? <Text style={styles.note}>Meetings aren’t available right now — pull down to try again.</Text> : null}
        {isError && !tasks ? (
          <ErrorNote message="Couldn't load your schedule." onRetry={() => void refetch()} retrying={isRefetching} />
        ) : days.length === 0 ? (
          <EmptyState title="Nothing scheduled" subtitle="Tasks with a due date and your meetings will show up on your calendar." />
        ) : (
          days.map((day) => (
            <View
              key={day.date}
              style={styles.day}
              onLayout={(e) => {
                dayY.current.set(day.date, e.nativeEvent.layout.y);
                if (day.date === startDay) openAtStart();
              }}
            >
              <Text style={[styles.dayLabel, day.date === today && styles.today]} accessibilityRole="header">
                {formatDay(day.date)}
                {day.date === today ? '  · Today' : ''}
              </Text>
              <View style={{ gap: spacing.sm }}>
                {day.meetings.map((m) => (
                  <MeetingRow key={`m:${m.id}`} meeting={m} timeZone={timeZone} />
                ))}
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
    note: { fontSize: fontSize.sm, color: c.ink2 },
  });
