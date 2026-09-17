import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useProjectColumns, useProjectTasks, useProjectProgress } from '../core/queries';
import { useBoardRealtime } from '../core/useBoardRealtime';
import { useColors } from '../core/theme';
import { composeBoard } from '../lib/board';
import { dateKey, shiftKey, formatKeyLabel, relativeKeyHint } from '../lib/board-date';
import { categoryColorOf, spacing, radius, fontSize, type Palette } from '../lib/theme';
import { TaskRow } from '../components/TaskRow';
import { Loader, EmptyState, ErrorNote } from '../components/ui';
import { QuickAddTaskSheet } from '../components/QuickAddTaskSheet';
import type { AppScreenProps } from '../navigation/types';

export function BoardScreen({ route, navigation }: AppScreenProps<'Board'>) {
  const { projectId } = route.params;
  const c = useColors();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(c), [c]);
  // Per-date boards: view one day at a time (default today, device time zone).
  const tz = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  }, []);
  const todayKey = dateKey(new Date(), tz);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const boardDate = selectedDate ?? todayKey;

  const columnsQ = useProjectColumns(projectId);
  const tasksQ = useProjectTasks(projectId, boardDate);
  const progressQ = useProjectProgress(projectId);
  useBoardRealtime(projectId);
  const [adding, setAdding] = useState(false);

  // Responsive column width: fills a narrow phone (with a peek of the next column)
  // yet stays a comfortable width on tablets/large screens.
  const { width } = useWindowDimensions();
  const columnWidth = Math.round(Math.min(320, Math.max(240, width * 0.82)));

  const board = useMemo(
    () => composeBoard(columnsQ.data ?? [], tasksQ.data ?? []),
    [columnsQ.data, tasksQ.data],
  );

  if (columnsQ.isLoading) return <Loader />;

  const progress = progressQ.data;
  const hint = relativeKeyHint(boardDate, todayKey);

  return (
    <View style={styles.container}>
      <View style={styles.dateBar}>
        <Pressable style={styles.dateBtn} onPress={() => setSelectedDate(shiftKey(boardDate, -1))} accessibilityRole="button" accessibilityLabel="Previous day" hitSlop={8}>
          <Text style={styles.dateBtnText}>‹</Text>
        </Pressable>
        <View style={styles.dateLabelWrap}>
          <Text style={styles.dateLabel}>{formatKeyLabel(boardDate)}</Text>
          {hint ? <Text style={styles.dateHint}>{hint}</Text> : null}
        </View>
        <Pressable style={styles.dateBtn} onPress={() => setSelectedDate(shiftKey(boardDate, 1))} accessibilityRole="button" accessibilityLabel="Next day" hitSlop={8}>
          <Text style={styles.dateBtnText}>›</Text>
        </Pressable>
        {boardDate !== todayKey ? (
          <Pressable style={styles.todayBtn} onPress={() => setSelectedDate(null)} accessibilityRole="button" accessibilityLabel="Jump to today">
            <Text style={styles.todayBtnText}>Today</Text>
          </Pressable>
        ) : null}
      </View>

      {progress && progress.total > 0 ? (
        <View style={styles.progressHead}>
          <View style={styles.progressBarTrack}>
            <View style={[styles.progressBarFill, { width: `${progress.completionPct}%` }]} />
          </View>
          <Text style={styles.progressText}>
            {progress.completionPct}% · {progress.completed}/{progress.total} done
            {progress.overdue > 0 ? ` · ${progress.overdue} overdue` : ''}
          </Text>
        </View>
      ) : null}
      {columnsQ.isError && !columnsQ.data ? (
        <ErrorNote message="Couldn't load this board. Check your connection and try again." />
      ) : tasksQ.isLoading ? (
        <Loader />
      ) : board.length === 0 ? (
        <EmptyState title="No columns" subtitle="This project has no board columns yet." />
      ) : (
        <ScrollView horizontal contentContainerStyle={styles.board} showsHorizontalScrollIndicator={false}>
          {board.map(({ column, tasks }) => (
            <View key={column.id} style={[styles.column, { width: columnWidth }]}>
              <View style={styles.columnHead}>
                <View style={[styles.dot, { backgroundColor: categoryColorOf(c, column.category) }]} />
                <Text style={styles.columnName} numberOfLines={1}>
                  {column.name}
                </Text>
                <Text style={styles.count}>{tasks.length}</Text>
              </View>
              <ScrollView contentContainerStyle={styles.columnBody} showsVerticalScrollIndicator={false}>
                {tasks.length === 0 ? (
                  <Text style={styles.emptyCol}>No tasks</Text>
                ) : (
                  tasks.map((t) => (
                    <TaskRow
                      key={t.id}
                      task={t}
                      onPress={() => navigation.navigate('TaskDetail', { taskId: t.id, title: t.title })}
                    />
                  ))
                )}
              </ScrollView>
            </View>
          ))}
        </ScrollView>
      )}

      <Pressable
        style={[styles.fab, { bottom: spacing.lg + insets.bottom }]}
        onPress={() => setAdding(true)}
        accessibilityRole="button"
        accessibilityLabel="Add task"
      >
        <Text style={styles.fabPlus}>＋</Text>
      </Pressable>

      <QuickAddTaskSheet
        visible={adding}
        onClose={() => setAdding(false)}
        projectId={projectId}
        columns={columnsQ.data ?? []}
        boardDate={boardDate}
      />
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.ground },
    dateBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.md,
    },
    dateBtn: {
      width: 36,
      height: 36,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.line,
      backgroundColor: c.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dateBtnText: { color: c.ink, fontSize: 20, fontWeight: '700', lineHeight: 22 },
    dateLabelWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    dateLabel: { fontSize: fontSize.md, fontWeight: '700', color: c.ink },
    dateHint: {
      fontSize: fontSize.xs,
      fontWeight: '700',
      color: c.brand,
      backgroundColor: c.ground,
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
      borderRadius: radius.pill,
      overflow: 'hidden',
    },
    todayBtn: {
      borderWidth: 1,
      borderColor: c.line,
      borderRadius: radius.md,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      backgroundColor: c.surface,
    },
    todayBtnText: { fontSize: fontSize.sm, fontWeight: '600', color: c.ink },
    progressHead: { paddingHorizontal: spacing.md, paddingTop: spacing.md, gap: spacing.xs },
    progressBarTrack: { height: 8, backgroundColor: c.line, borderRadius: radius.pill, overflow: 'hidden' },
    progressBarFill: { height: 8, backgroundColor: c.category.DONE },
    progressText: { fontSize: fontSize.xs, color: c.ink2, fontWeight: '600' },
    board: { padding: spacing.md, gap: spacing.md },
    column: {
      backgroundColor: c.ground,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.line,
      padding: spacing.sm,
    },
    columnHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm },
    dot: { width: 10, height: 10, borderRadius: 5 },
    columnName: { flex: 1, fontSize: fontSize.md, fontWeight: '700', color: c.ink },
    count: { fontSize: fontSize.sm, fontWeight: '700', color: c.ink2 },
    columnBody: { gap: spacing.sm, paddingBottom: spacing.sm },
    emptyCol: { color: c.ink3, fontSize: fontSize.sm, padding: spacing.sm },
    fab: {
      position: 'absolute',
      right: spacing.lg,
      bottom: spacing.lg,
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: c.brand,
      alignItems: 'center',
      justifyContent: 'center',
      elevation: 4,
    },
    fabPlus: { color: c.onBrand, fontSize: 28, fontWeight: '700', lineHeight: 32 },
  });
