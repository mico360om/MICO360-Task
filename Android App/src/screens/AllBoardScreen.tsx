import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, useWindowDimensions, Alert, AccessibilityInfo } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDirectory, useProjects } from '../core/queries';
import { useAllProjectsTasks, useHiddenProjects, useStatusMove } from '../core/all-board-queries';
import { useDatePreferences } from '../core/calendar-queries';
import { useAllBoardRealtime } from '../core/useBoardRealtime';
import { useServices } from '../core/providers';
import { useColors } from '../core/theme';
import { ALL_PROJECTS_TEXT, STATUS_NAME, allBoardCard, boardProjects, composeAllProjectsBoard, projectFilterLabel, type StatusColumn } from '../lib/all-board';
import { dateKey } from '../lib/board-date';
import { appTimeZone } from '../lib/due-date';
import { weekStartOf } from '../lib/calendar';
import { serverFileHref } from '../lib/attachments';
import { categoryColorOf, spacing, radius, fontSize, type Palette } from '../lib/theme';
import { BoardColumnView } from '../components/board/BoardColumnView';
import { BoardDayBar } from '../components/board/BoardDayBar';
import { StatusMoveSheet } from '../components/board/StatusMoveSheet';
import { ProjectFilterSheet } from '../components/board/ProjectFilterSheet';
import { Loader, EmptyState, ErrorNote } from '../components/ui';
import type { BoardCard as Card } from '../lib/board';
import type { ApiTask, ColumnCategory } from '../lib/types';
import type { AppScreenProps } from '../navigation/types';

/**
 * The All projects board (4c), as the website's: every open project's tasks for one day under the
 * six shared statuses, each card with its project, a status sorted by due date then priority.
 * Long-pressing a card (or TalkBack's "Move…") changes its status in its own project — into that
 * project's first column of that kind, or it stays and says why. "Projects:" chooses which projects
 * show (remembered for you); "+" on a status starts a new task in that kind of column, in the
 * project chosen in the form. Live from every shown project on one connection while it is in view;
 * kept offline per day. No column editing here: each project's own board is unchanged.
 */
export function AllBoardScreen({ navigation }: AppScreenProps<'AllBoard'>) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { baseUrl } = useServices();
  const timeZone = appTimeZone();
  // The company's today, the same day the web board and the API use (XP-03).
  const todayKey = dateKey(new Date(), timeZone);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const boardDate = selectedDate ?? todayKey;
  const weekStart = weekStartOf(useDatePreferences().data);

  const projectsQ = useProjects();
  const projects = useMemo(() => projectsQ.data ?? [], [projectsQ.data]);
  const shownProjects = useMemo(() => boardProjects(projects), [projects]);
  const [hidden, setHidden, hiddenRead] = useHiddenProjects();
  const [filtering, setFiltering] = useState(false);
  const tasksQ = useAllProjectsTasks(boardDate);
  const dirQ = useDirectory();

  // Live from every project it shows, on one connection — while it is in view (caught up when back).
  const focused = useIsFocused();
  const liveRooms = useMemo(() => shownProjects.map((p) => p.id), [shownProjects]);
  useAllBoardRealtime(focused ? liveRooms : undefined);

  const board = useMemo(() => composeAllProjectsBoard(tasksQ.data ?? [], projects, { hidden }), [tasksQ.data, projects, hidden]);
  const byId = useMemo(() => new Map((tasksQ.data ?? []).map((t) => [t.id, t])), [tasksQ.data]);
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const photos = useMemo(() => new Map((dirQ.data ?? []).map((u) => [u.id, serverFileHref(baseUrl, u.avatarUrl)])), [dirQ.data, baseUrl]);
  const photoOf = useCallback((id: string) => photos.get(id) ?? null, [photos]);
  const shownCount = shownProjects.filter((p) => !hidden.has(p.id)).length;

  // ── Changing a card's status ──
  const [moving, setMoving] = useState<ApiTask | null>(null);
  const statusMove = useStatusMove();
  const moveTo = useCallback(
    async (task: ApiTask, status: ColumnCategory) => {
      setMoving(null);
      const name = projectById.get(task.projectId)?.name ?? null;
      const out = await statusMove(task, status, name);
      if (out.kind === 'moved') tell(`Moved to ${STATUS_NAME[status]}.`);
      else if (out.kind !== 'same') tell(out.message, out.kind !== 'kept');
    },
    [statusMove, projectById],
  );
  const openTask = useCallback((card: Card) => navigation.navigate('TaskDetail', { taskId: card.id, title: card.title }), [navigation]);
  const openActions = useCallback((card: Card) => setMoving(byId.get(card.id) ?? null), [byId]);

  /** New task, in this kind of column (or the first) of the project chosen in the form, on the day shown. */
  const addTask = useCallback(
    (status?: ColumnCategory) => navigation.navigate('NewTask', { boardDate, ...(status ? { columnCategory: status } : {}) }),
    [navigation, boardDate],
  );

  const { width } = useWindowDimensions();
  const columnWidth = Math.round(Math.min(320, Math.max(240, width * 0.82)));
  const [boardHeight, setBoardHeight] = useState(0);
  const columnHeight = Math.max(0, boardHeight - spacing.md * 2);

  if (projectsQ.isLoading || !hiddenRead) return <Loader />;

  return (
    <View style={styles.container}>
      <BoardDayBar boardDate={boardDate} todayKey={todayKey} weekStart={weekStart} onChange={setSelectedDate} />
      <View style={styles.head}>
        <Text style={styles.subtitle}>{ALL_PROJECTS_TEXT.subtitle}</Text>
        {shownProjects.length > 0 ? (
          <Pressable
            onPress={() => setFiltering(true)}
            accessibilityRole="button"
            accessibilityLabel={`${projectFilterLabel(shownCount, shownProjects.length)}. Choose the projects on the board`}
            style={({ pressed }) => [styles.filter, shownCount < shownProjects.length && styles.filterOn, pressed && styles.pressed]}
          >
            <Text style={[styles.filterText, shownCount < shownProjects.length && styles.filterTextOn]}>⏷ {projectFilterLabel(shownCount, shownProjects.length)}</Text>
          </Pressable>
        ) : null}
      </View>

      {projectsQ.isError && !projectsQ.data ? (
        <ErrorNote message="Couldn’t load your projects. Check your connection and try again." onRetry={() => void projectsQ.refetch()} retrying={projectsQ.isRefetching} />
      ) : shownProjects.length === 0 ? (
        <EmptyState title="No projects yet" subtitle="Projects that are finished or archived aren’t on this board." />
      ) : tasksQ.isLoading ? (
        <Loader />
      ) : tasksQ.isError && !tasksQ.data ? (
        // Never show a failed load as an empty board (MOB-08).
        <ErrorNote message="Couldn't load the tasks for this day. Check your connection and try again." onRetry={() => void tasksQ.refetch()} retrying={tasksQ.isRefetching} />
      ) : (
        <FlatList
          horizontal
          data={board}
          style={styles.boardList}
          onLayout={(e) => setBoardHeight(e.nativeEvent.layout.height)}
          keyExtractor={(b) => b.status}
          renderItem={({ item }) => (
            <StatusColumnView item={item} width={columnWidth} height={columnHeight} timeZone={timeZone} photoOf={photoOf} onAdd={addTask} onOpen={openTask} onActions={openActions} />
          )}
          contentContainerStyle={styles.board}
          showsHorizontalScrollIndicator={false}
          initialNumToRender={3}
          windowSize={5}
          getItemLayout={(_d, index) => ({ length: columnWidth + spacing.md, offset: (columnWidth + spacing.md) * index, index })}
          accessibilityLabel="Statuses"
        />
      )}

      {shownProjects.length > 0 ? (
        <Pressable style={[styles.fab, { bottom: spacing.lg + insets.bottom }]} onPress={() => addTask()} accessibilityRole="button" accessibilityLabel="New task">
          <Text style={styles.fabPlus}>＋</Text>
        </Pressable>
      ) : null}

      <StatusMoveSheet
        task={moving}
        projectName={moving ? (projectById.get(moving.projectId)?.name ?? null) : null}
        onMove={(status) => {
          if (moving) void moveTo(moving, status);
        }}
        onClose={() => setMoving(null)}
      />
      <ProjectFilterSheet visible={filtering} projects={shownProjects} hidden={hidden} onChange={setHidden} onClose={() => setFiltering(false)} />
    </View>
  );
}

/** Said to TalkBack; a refusal (or a card that stayed) is shown as well. */
function tell(text: string, show = false) {
  AccessibilityInfo.announceForAccessibility(text);
  if (show) Alert.alert(ALL_PROJECTS_TEXT.title, text);
}

/** One status: its cards (each with its project), in its colour; cards keep their order here. */
const StatusColumnView = React.memo(function StatusColumnView({
  item,
  onAdd,
  ...rest
}: {
  item: StatusColumn;
  width: number;
  height: number;
  timeZone: string;
  photoOf: (id: string) => string | null;
  onAdd: (status?: ColumnCategory) => void;
  onOpen: (card: Card) => void;
  onActions: (card: Card) => void;
}) {
  const c = useColors();
  const color = categoryColorOf(c, item.status);
  const cards = useMemo(() => item.tasks.map((t) => allBoardCard(t.task, item.status, t.project, color)), [item, color]);
  return <BoardColumnView id={item.status} name={item.name} color={color} cards={cards} onAdd={() => onAdd(item.status)} steps={false} {...rest} />;
});

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.ground },
    pressed: { opacity: 0.6 },
    head: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
    subtitle: { flex: 1, minWidth: 180, fontSize: fontSize.xs, color: c.ink2 },
    filter: { minHeight: 44, justifyContent: 'center', borderWidth: 1, borderColor: c.line, borderRadius: radius.md, paddingHorizontal: spacing.md, backgroundColor: c.surface },
    filterOn: { borderColor: c.brand },
    filterText: { fontSize: fontSize.sm, fontWeight: '600', color: c.ink },
    filterTextOn: { color: c.brand },
    boardList: { flex: 1 },
    board: { padding: spacing.md, gap: spacing.md },
    fab: { position: 'absolute', right: spacing.lg, bottom: spacing.lg, width: 56, height: 56, borderRadius: 28, backgroundColor: c.brand, alignItems: 'center', justifyContent: 'center', elevation: 4 },
    fabPlus: { color: c.onBrand, fontSize: 28, fontWeight: '700', lineHeight: 32 },
  });
