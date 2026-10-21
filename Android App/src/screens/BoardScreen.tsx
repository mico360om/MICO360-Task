import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, useWindowDimensions, Alert, AccessibilityInfo } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDirectory, useProjectColumns, useProjectMembers, useProjectTasks, useProjectProgress, useMoveTask, useReorderColumn } from '../core/queries';
import { useDatePreferences } from '../core/calendar-queries';
import { useBoardRealtime } from '../core/useBoardRealtime';
import { useServices, useSession } from '../core/providers';
import { useColors } from '../core/theme';
import { boardCard, composeBoard, type BoardCard as Card, type BoardColumn } from '../lib/board';
import { movePlan, stepOrder, type Place } from '../lib/board-move';
import { moveCard, reorderCards } from '../lib/board-writes';
import { dateKey } from '../lib/board-date';
import { appTimeZone } from '../lib/due-date';
import { weekStartOf } from '../lib/calendar';
import { serverFileHref } from '../lib/attachments';
import { canManageProject } from '../lib/project-team';
import { spacing, radius, fontSize, type Palette } from '../lib/theme';
import { MoveCardSheet } from '../components/board/MoveCardSheet';
import { BoardColumnView } from '../components/board/BoardColumnView';
import { BoardDayBar } from '../components/board/BoardDayBar';
import { Loader, EmptyState, ErrorNote, Button } from '../components/ui';
import type { ApiTask } from '../lib/types';
import type { AppScreenProps } from '../navigation/types';

/**
 * A project's board (4b), as the website's: one day at a time (the company's today, a day picked
 * from a calendar, or the day before or after); its shown columns side by side, each in its own
 * colour with its count and "+"; and the website's cards. A card is placed by long-pressing it
 * (or TalkBack's actions): up or down one, to the top or the bottom, or into another column at the
 * top, after a card or at the bottom — the moves the website's drag and drop makes. Those who manage
 * the project (the server's rule) manage its columns. Columns and cards are virtualized lists.
 */
export function BoardScreen({ route, navigation }: AppScreenProps<'Board'>) {
  const { projectId, projectName } = route.params;
  const c = useColors();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { baseUrl } = useServices();
  const user = useSession()?.user ?? null;
  const timeZone = appTimeZone();
  // Per-date boards: view one day at a time. "Today" is the company-time-zone date (XP-03), the
  // same day the web board and the API use — not the phone's zone or UTC.
  const todayKey = dateKey(new Date(), timeZone);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const boardDate = selectedDate ?? todayKey;
  const weekStart = weekStartOf(useDatePreferences().data);

  const columnsQ = useProjectColumns(projectId);
  const tasksQ = useProjectTasks(projectId, boardDate);
  const progressQ = useProjectProgress(projectId);
  const membersQ = useProjectMembers(projectId);
  const dirQ = useDirectory();
  // The server's rule (an administrator, or a manager of this project); it has the last word.
  const canManage = canManageProject(user, membersQ.data ?? []);
  // Removed from this project while looking at it (server `project:removed`): leave the board.
  useBoardRealtime(projectId, () => {
    Alert.alert('No longer available', 'You were removed from this project.');
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('Tabs', { screen: 'Projects' });
  });

  const board = useMemo(() => composeBoard(columnsQ.data ?? [], tasksQ.data ?? []), [columnsQ.data, tasksQ.data]);
  const byId = useMemo(() => new Map((tasksQ.data ?? []).map((t) => [t.id, t])), [tasksQ.data]);
  const photos = useMemo(() => new Map((dirQ.data ?? []).map((u) => [u.id, serverFileHref(baseUrl, u.avatarUrl)])), [dirQ.data, baseUrl]);
  const photoOf = useCallback((id: string) => photos.get(id) ?? null, [photos]);

  // ── Moving a card ──
  const [moving, setMoving] = useState<ApiTask | null>(null);
  const move = useMoveTask(projectId);
  const reorder = useReorderColumn(projectId);
  const writes = useMemo(
    () => ({
      move: (id: string, columnId: string, position: number, at: number) => move.mutateAsync({ id, columnId, position, at }),
      reorder: (columnId: string, orderedIds: string[]) => reorder.mutateAsync({ columnId, orderedIds }),
    }),
    // mutateAsync is stable for the life of each mutation hook.
    [move.mutateAsync, reorder.mutateAsync],
  );
  const placeInColumn = useCallback(
    async (columnId: string, orderedIds: string[]) => {
      setMoving(null);
      const out = await reorderCards(writes, { columnId, orderedIds });
      if (out.kind === 'put-back') tell(out.message, true);
      else tell('Moved.');
    },
    [writes],
  );
  const moveToColumn = useCallback(
    async (task: ApiTask, toColumnId: string, place: Place) => {
      setMoving(null);
      const dest = board.find((b) => b.column.id === toColumnId);
      const plan = movePlan((dest?.tasks ?? []).filter((t) => t.id !== task.id), task.id, place);
      const out = await moveCard(writes, { id: task.id, toColumnId, plan });
      if (out.kind === 'moved') tell(`Moved to ${dest?.column.name ?? 'the column'}.`);
      else tell(out.message, out.kind !== 'kept');
    },
    [board, writes],
  );
  const step = useCallback(
    (card: Card, dir: -1 | 1) => {
      const t = byId.get(card.id);
      const col = t ? board.find((b) => b.column.id === t.columnId) : undefined;
      const order = col ? stepOrder(col.tasks, card.id, dir) : null;
      if (col && order) void placeInColumn(col.column.id, order);
    },
    [byId, board, placeInColumn],
  );
  const openTask = useCallback((card: Card) => navigation.navigate('TaskDetail', { taskId: card.id, title: card.title }), [navigation]);
  const openActions = useCallback((card: Card) => setMoving(byId.get(card.id) ?? null), [byId]);

  // Responsive column width: fills a narrow phone (with a peek of the next column)
  // yet stays a comfortable width on tablets/large screens.
  const { width } = useWindowDimensions();
  const columnWidth = Math.round(Math.min(320, Math.max(240, width * 0.82)));
  // Each column is as tall as the board's area, so its own list of cards scrolls (and is virtualized).
  const [boardHeight, setBoardHeight] = useState(0);
  const columnHeight = Math.max(0, boardHeight - spacing.md * 2);

  /** New task in this project (its board): in the column chosen (the first one by default), on the day shown. */
  const addTask = useCallback(
    (columnId?: string) => navigation.navigate('NewTask', { projectId, boardDate, ...(columnId ? { columnId } : {}) }),
    [navigation, projectId, boardDate],
  );

  if (columnsQ.isLoading) return <Loader />;

  const progress = progressQ.data;

  return (
    <View style={styles.container}>
      <BoardDayBar boardDate={boardDate} todayKey={todayKey} weekStart={weekStart} onChange={setSelectedDate} />

      {canManage ? (
        <View style={styles.manageRow}>
          <Button title="Manage columns" variant="secondary" onPress={() => navigation.navigate('BoardColumns', { projectId, projectName })} style={styles.manageBtn} />
        </View>
      ) : null}

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
        <ErrorNote message="Couldn't load this board. Check your connection and try again." onRetry={() => void columnsQ.refetch()} retrying={columnsQ.isRefetching} />
      ) : tasksQ.isLoading ? (
        <Loader />
      ) : tasksQ.isError && !tasksQ.data ? (
        // Never show a failed load as an empty board ("No tasks") — MOB-08.
        <ErrorNote message="Couldn't load the tasks for this day. Check your connection and try again." onRetry={() => void tasksQ.refetch()} retrying={tasksQ.isRefetching} />
      ) : board.length === 0 ? (
        <EmptyState title="No columns" subtitle={canManage ? 'This project has no board columns yet. Add one in Manage columns.' : 'This project has no board columns yet.'} />
      ) : (
        <FlatList
          horizontal
          data={board}
          style={styles.boardList}
          onLayout={(e) => setBoardHeight(e.nativeEvent.layout.height)}
          keyExtractor={(b) => b.column.id}
          renderItem={({ item }) => (
            <ProjectColumn item={item} width={columnWidth} height={columnHeight} timeZone={timeZone} photoOf={photoOf} onAdd={addTask} onOpen={openTask} onActions={openActions} onStep={step} />
          )}
          contentContainerStyle={styles.board}
          showsHorizontalScrollIndicator={false}
          initialNumToRender={3}
          windowSize={5}
          getItemLayout={(_d, index) => ({ length: columnWidth + spacing.md, offset: (columnWidth + spacing.md) * index, index })}
          accessibilityLabel="Board columns"
        />
      )}

      <Pressable style={[styles.fab, { bottom: spacing.lg + insets.bottom }]} onPress={() => addTask()} accessibilityRole="button" accessibilityLabel="New task">
        <Text style={styles.fabPlus}>＋</Text>
      </Pressable>

      <MoveCardSheet
        task={moving}
        board={board}
        onReorder={(columnId, orderedIds) => void placeInColumn(columnId, orderedIds)}
        onMove={(toColumnId, place) => {
          if (moving) void moveToColumn(moving, toColumnId, place);
        }}
        onClose={() => setMoving(null)}
      />

    </View>
  );
}

/** Said to TalkBack; a refusal (or a place that couldn't be saved) is shown as well. */
function tell(text: string, show = false) {
  AccessibilityInfo.announceForAccessibility(text);
  if (show) Alert.alert('The board', text);
}

/** One of the project's columns, its cards made once per change (the shared column view draws it). */
const ProjectColumn = React.memo(function ProjectColumn({
  item,
  ...rest
}: {
  item: BoardColumn;
  width: number;
  height: number;
  timeZone: string;
  photoOf: (id: string) => string | null;
  onAdd: (columnId?: string) => void;
  onOpen: (card: Card) => void;
  onActions: (card: Card) => void;
  onStep: (card: Card, dir: -1 | 1) => void;
}) {
  const { column, tasks } = item;
  const cards = useMemo(() => tasks.map((t) => boardCard(t, column)), [tasks, column]);
  return <BoardColumnView id={column.id} name={column.name} color={column.color} cards={cards} {...rest} />;
});

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.ground },
    pressed: { opacity: 0.6 },
    manageRow: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, flexDirection: 'row' },
    manageBtn: { minHeight: 44 },
    progressHead: { paddingHorizontal: spacing.md, paddingTop: spacing.md, gap: spacing.xs },
    progressBarTrack: { height: 8, backgroundColor: c.line, borderRadius: radius.pill, overflow: 'hidden' },
    progressBarFill: { height: 8, backgroundColor: c.category.DONE },
    progressText: { fontSize: fontSize.xs, color: c.ink2, fontWeight: '600' },
    boardList: { flex: 1 },
    board: { padding: spacing.md, gap: spacing.md },
    fab: { position: 'absolute', right: spacing.lg, bottom: spacing.lg, width: 56, height: 56, borderRadius: 28, backgroundColor: c.brand, alignItems: 'center', justifyContent: 'center', elevation: 4 },
    fabPlus: { color: c.onBrand, fontSize: 28, fontWeight: '700', lineHeight: 32 },
  });
