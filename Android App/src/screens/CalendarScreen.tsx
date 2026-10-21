import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, SectionList, StyleSheet, RefreshControl, AccessibilityInfo, type SectionListRenderItem } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { useUserId } from '../core/providers';
import { useDirectory, useProjects } from '../core/queries';
import {
  CALENDAR_KEY,
  CALENDAR_MEETINGS_KEY,
  useCalendarMeetingsIn,
  useCalendarOverdue,
  useCalendarRange,
  useDatePreferences,
  useRescheduleTask,
} from '../core/calendar-queries';
import { useColors } from '../core/theme';
import { isNetworkError } from '../lib/api-client';
import { calendarTimeZone, companyTodayKey, dateZones } from '../lib/due-date';
import { dayLabel, periodLabel, stepCursor, visibleRange, weekStartOf, type CalendarView } from '../lib/calendar';
import { activeFilterCount, applyFilters, buildItems, DEFAULT_FILTERS, groupByDay, type CalendarFilters, type CalendarTask, type CalItem } from '../lib/calendar-model';
import { filterCalendarMeetings, groupMeetingsByDay, meetingItems } from '../lib/calendar-meetings';
import { canReschedule, moveFailedText, movedText, planMove, planUndo, queuedMoveText, splitVersion, undoneText, type MoveScope } from '../lib/calendar-reschedule';
import {
  calendarPlace,
  calendarSections,
  canCreateIn,
  chosenDay,
  createDay,
  newTaskProject,
  nothingText,
  offlineNote,
  timeZoneNote,
  type CalendarPlace,
  type CalendarRow,
  type CalendarSection,
} from '../lib/calendar-screen';
import { displayName, type ApiProject } from '../lib/types';
import { MeetingRow } from '../components/MeetingRow';
import { Loader, EmptyState, ErrorNote, Button } from '../components/ui';
import { usePullRefresh } from '../components/meeting/live';
import { MonthGrid, type DayMarks } from '../components/calendar/MonthGrid';
import { CalendarTaskRow } from '../components/calendar/CalendarTaskRow';
import { GoToDateSheet, MoveDaySheet, NewTaskOnDay, TaskInfoSheet } from '../components/calendar/CalendarSheets';
import { CalendarFiltersSheet } from '../components/calendar/CalendarFiltersSheet';
import { spacing, radius, fontSize, type Palette } from '../lib/theme';
import type { AppScreenProps } from '../navigation/types';

const VIEWS: { v: CalendarView; label: string }[] = [
  { v: 'month', label: 'Month' },
  { v: 'week', label: 'Week' },
  { v: 'agenda', label: 'Agenda' },
];

type Toast = { tone: 'moved' | 'info' | 'error'; text: string; undo?: () => void };
type ProjectLook = ApiProject & { color?: string | null };
const NO_TASKS: CalendarTask[] = [];

/**
 * The calendar (5a), as on the website: everyone's tasks in the projects you can see (or yours, a
 * person's or a project's — the filters), the copies repeating tasks will make (marked as not
 * created yet) and your meetings, by month, week or agenda. Weeks start on your day (Settings on
 * the website) and days are in your time zone, else the company's. Tap a task to open it — a
 * repeat not created yet explains itself and opens its current copy — or long-press it to move it
 * to another day (the website drags); "+" adds a task on a day.
 */
export function CalendarScreen({ navigation }: AppScreenProps<'Calendar'>) {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const userId = useUserId();
  const myId = userId ?? '';
  // As on the website, the calendar is in your own time zone (else the company's).
  const timeZone = calendarTimeZone();
  const zones = dateZones();
  const today = companyTodayKey(new Date(), timeZone);
  const weekStart = weekStartOf(useDatePreferences().data);

  // The view, day and filters, kept while the app is open (the website keeps them in its address).
  const [place, setPlace] = useState<CalendarPlace>(() => calendarPlace.get(userId));
  useEffect(() => calendarPlace.set(userId, place), [userId, place]);
  const { view, filters } = place;
  const cursor = place.date ?? today;
  const [selected, setSelected] = useState<string | null>(null);
  const chosen = chosenDay(cursor, today, selected);
  const [showEarlier, setShowEarlier] = useState(false);
  const [allOverdue, setAllOverdue] = useState(false);
  const go = useCallback((patch: Partial<CalendarPlace>) => {
    setPlace((p) => ({ ...p, ...patch }));
    setShowEarlier(false);
    setAllOverdue(false);
  }, []);

  const { from, to } = visibleRange(view, cursor, weekStart);
  const rangeQ = useCalendarRange(from, to);
  const meetingsQ = useCalendarMeetingsIn(from, to, timeZone);
  const overdueQ = useCalendarOverdue(view === 'agenda');
  const projectsQ = useProjects();
  const dirQ = useDirectory();
  const rescheduleM = useRescheduleTask();

  const projects = useMemo(() => (projectsQ.data ?? []) as ProjectLook[], [projectsQ.data]);
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const projectStatus = useCallback((id: string) => projectById.get(id)?.status, [projectById]);
  const ctx = useMemo(() => ({ today, timeZone, projectStatus }), [today, timeZone, projectStatus]);

  const items = useMemo(() => (rangeQ.data ? buildItems(rangeQ.data, ctx) : []), [rangeQ.data, ctx]);
  const shown = useMemo(() => applyFilters(items, filters, { myId }), [items, filters, myId]);
  const byDay = useMemo(() => groupByDay(shown), [shown]);
  const shownMeetings = useMemo(() => filterCalendarMeetings(meetingItems(meetingsQ.data ?? [], timeZone), filters, { myId }), [meetingsQ.data, timeZone, filters, myId]);
  const meetingsByDay = useMemo(() => groupMeetingsByDay(shownMeetings), [shownMeetings]);
  const overdueTasks = overdueQ.data ?? NO_TASKS;
  const overdue = useMemo(() => {
    if (view !== 'agenda') return [];
    const list = buildItems({ tasks: overdueTasks, occurrences: [], series: [] }, ctx).filter((i) => i.status === 'overdue');
    return applyFilters(list, filters, { myId });
  }, [view, overdueTasks, ctx, filters, myId]);

  const filtered = activeFilterCount(filters) > 0;
  const { sections, earlier } = useMemo(
    () => calendarSections({ view, from, to, today, chosen, weekStart, byDay, meetingsByDay, overdue, showEarlier, allOverdue, filtered }),
    [view, from, to, today, chosen, weekStart, byDay, meetingsByDay, overdue, showEarlier, allOverdue, filtered],
  );
  const period = periodLabel(view, cursor, weekStart);
  const canCreate = canCreateIn(projects);
  const addDay = createDay(view, cursor, chosen);

  // ── Sheets and the notice at the bottom ──
  const [moving, setMoving] = useState<CalItem | null>(null);
  const [info, setInfo] = useState<CalItem | null>(null);
  const [createOn, setCreateOn] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [goTo, setGoTo] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.tone === 'error' ? 9000 : 8000);
    return () => clearTimeout(t);
  }, [toast]);
  const say = useCallback((next: Toast) => {
    setToast(next);
    AccessibilityInfo.announceForAccessibility(next.text);
  }, []);

  // Back on this screen (from a task, a meeting): what went out of date meanwhile is fetched.
  useEffect(
    () =>
      navigation.addListener('focus', () => {
        for (const queryKey of [CALENDAR_KEY, CALENDAR_MEETINGS_KEY]) void qc.refetchQueries({ queryKey, type: 'active', stale: true }, { cancelRefetch: false });
      }),
    [navigation, qc],
  );

  const { refetch: refetchRange } = rangeQ;
  const { refetch: refetchMeetings } = meetingsQ;
  const { refetch: refetchOverdue } = overdueQ;
  const pull = usePullRefresh(
    useCallback(() => Promise.all([refetchRange(), refetchMeetings(), view === 'agenda' ? refetchOverdue() : null]), [refetchRange, refetchMeetings, refetchOverdue, view]),
  );

  // ── Moving a task: shown at once, saved through the task-edit path, undoable ──
  const { mutate: reschedule } = rescheduleM;
  const undoMove = useCallback(
    (original: CalendarTask, fromDay: string, toDay: string, version: number | undefined) => {
      setToast(null);
      const { patch, version: read } = splitVersion(planUndo(original, fromDay, version));
      reschedule(
        { taskId: original.id, patch, readVersion: read },
        {
          onSuccess: () => say({ tone: 'moved', text: undoneText(original, fromDay) }),
          onError: (err) => say(isNetworkError(err) ? { tone: 'info', text: queuedMoveText(original, fromDay) } : { tone: 'error', text: moveFailedText(original, toDay, err) }),
        },
      );
    },
    [reschedule, say],
  );
  const move = useCallback(
    (item: CalItem, toDay: string, scope: MoveScope) => {
      setMoving(null);
      if (!canReschedule(item) || item.date === toDay) return;
      const original = item.task;
      const fromDay = item.date;
      const { patch, version } = splitVersion(planMove(original, fromDay, toDay, scope));
      reschedule(
        { taskId: original.id, patch, readVersion: version },
        {
          onSuccess: (saved) => say({ tone: 'moved', text: movedText(original, toDay, scope), undo: () => undoMove(original, fromDay, toDay, saved?.version) }),
          onError: (err) => say(isNetworkError(err) ? { tone: 'info', text: queuedMoveText(original, toDay) } : { tone: 'error', text: moveFailedText(original, fromDay, err) }),
        },
      );
    },
    [reschedule, say, undoMove],
  );

  const openTask = useCallback((item: CalItem) => navigation.navigate('TaskDetail', { taskId: item.task.id, title: item.task.title }), [navigation]);
  const press = useCallback((item: CalItem) => (item.kind === 'projected' ? setInfo(item) : openTask(item)), [openTask]);
  const longPress = useCallback((item: CalItem) => (canReschedule(item) ? setMoving(item) : setInfo(item)), []);

  const marks = useCallback(
    (day: string): DayMarks => ({ tasks: (byDay.get(day) ?? []).map((i) => i.status), meetings: (meetingsByDay.get(day) ?? []).length }),
    [byDay, meetingsByDay],
  );

  const projectOptions = useMemo(
    () => [{ value: '', label: 'All projects' }, ...[...projects].sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({ value: p.id, label: p.name }))],
    [projects],
  );
  const personOptions = useMemo(
    () => [{ value: '', label: 'Everyone' }, ...(dirQ.data ?? []).map((u) => ({ value: u.id, label: displayName(u), hint: `@${u.username}` }))],
    [dirQ.data],
  );

  const renderItem: SectionListRenderItem<CalendarRow, CalendarSection> = useCallback(
    ({ item: row }) => {
      if (row.type === 'meeting') {
        const m = row.meeting.meeting;
        return <MeetingRow meeting={m} timeZone={timeZone} onPress={() => navigation.navigate('MeetingDetail', { meetingId: m.id, title: m.title })} />;
      }
      if (row.type === 'task') {
        const p = projectById.get(row.item.task.projectId);
        return (
          <CalendarTaskRow
            item={row.item}
            projectName={p?.name}
            projectColor={p?.color}
            movable={canReschedule(row.item)}
            onPress={() => press(row.item)}
            onLongPress={() => longPress(row.item)}
          />
        );
      }
      if (row.type === 'more') {
        return (
          <Pressable
            onPress={() => setAllOverdue((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded: allOverdue }}
            style={({ pressed }) => [styles.more, pressed && styles.pressed]}
          >
            <Text style={styles.moreText}>{row.text}</Text>
          </Pressable>
        );
      }
      return <Text style={styles.empty}>{row.text}</Text>;
    },
    [timeZone, navigation, projectById, press, longPress, allOverdue, styles],
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: CalendarSection }) => (
      <View style={styles.sectionHead}>
        <Text style={[styles.sectionTitle, section.today && styles.todayTitle, !section.day && styles.overdueTitle]} accessibilityRole="header">
          {section.title}
          {section.today ? ' · Today' : ''}
        </Text>
        {section.day && canCreate ? (
          <Pressable
            onPress={() => setCreateOn(section.day!)}
            accessibilityRole="button"
            accessibilityLabel={`Add a task on ${dayLabel(section.day)}`}
            hitSlop={6}
            style={({ pressed }) => [styles.add, pressed && styles.pressed]}
          >
            <Text style={styles.addText}>＋ Add</Text>
          </Pressable>
        ) : null}
      </View>
    ),
    [styles, canCreate],
  );

  const note = offlineNote(rangeQ.data?.savedCopy ?? null);
  const nothing = shown.length === 0 && shownMeetings.length === 0;
  const clearFilters = () => go({ filters: DEFAULT_FILTERS });
  const header = (
    <View style={styles.header}>
      {note ? (
        <Text style={styles.note} accessibilityLiveRegion="polite">
          {note}
        </Text>
      ) : null}
      {meetingsQ.isError && !meetingsQ.data ? <Text style={styles.note}>Meetings aren’t available right now — pull down to try again.</Text> : null}
      {view === 'month' ? (
        <MonthGrid cursor={cursor} weekStart={weekStart} today={today} selected={chosen} onPick={setSelected} marks={marks} label={period} hint="Shows this day’s tasks and meetings below" />
      ) : null}
      {nothing && rangeQ.data && view !== 'agenda' ? (
        <View style={styles.nothingBar}>
          <Text style={styles.nothingText}>{nothingText(period, filtered)}</Text>
          {filtered ? <Button title="Clear filters" variant="secondary" onPress={clearFilters} /> : null}
        </View>
      ) : null}
      {view === 'agenda' && earlier > 0 ? (
        <Pressable
          onPress={() => setShowEarlier((v) => !v)}
          accessibilityRole="button"
          accessibilityState={{ expanded: showEarlier }}
          style={({ pressed }) => [styles.earlier, pressed && styles.pressed]}
        >
          <Text style={styles.earlierText}>{showEarlier ? 'Hide earlier days' : `Show earlier days this month (${earlier})`}</Text>
        </Pressable>
      ) : null}
    </View>
  );
  const emptyAgenda = (
    <View style={styles.emptyAgenda}>
      <EmptyState title={nothingText(period, filtered)} subtitle={!filtered && canCreate ? 'Use “+” to add a task on a day.' : undefined} />
      {filtered ? <Button title="Clear filters" variant="secondary" onPress={clearFilters} /> : null}
    </View>
  );

  const unit = view === 'week' ? 'week' : 'month';
  const filterCount = activeFilterCount(filters);
  const step = (dir: 1 | -1) => {
    setSelected(null);
    go({ date: stepCursor(view, cursor, dir) });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {/* Previous / Today / Next and the period (tap it to go to a date); the views and the filters. */}
      <View style={styles.toolbar}>
        <View style={styles.toolRow}>
          <Pressable onPress={() => step(-1)} accessibilityRole="button" accessibilityLabel={`Previous ${unit}`} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
            <Text style={styles.iconText}>‹</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setSelected(null);
              go({ date: null });
            }}
            accessibilityRole="button"
            accessibilityLabel="Today"
            style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
          >
            <Text style={styles.pillText}>Today</Text>
          </Pressable>
          <Pressable onPress={() => step(1)} accessibilityRole="button" accessibilityLabel={`Next ${unit}`} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
            <Text style={styles.iconText}>›</Text>
          </Pressable>
          <Pressable onPress={() => setGoTo(true)} accessibilityRole="button" accessibilityLabel={`${period}. Go to a date`} style={({ pressed }) => [styles.periodButton, pressed && styles.pressed]}>
            <Text style={styles.period} numberOfLines={2} accessibilityLiveRegion="polite">
              {period}
            </Text>
          </Pressable>
        </View>
        <View style={styles.toolRow}>
          <View style={styles.segment} accessibilityRole="radiogroup" accessibilityLabel="View">
            {VIEWS.map(({ v, label }) => {
              const on = view === v;
              return (
                <Pressable
                  key={v}
                  // From the month, the week and the agenda open at the day chosen in it.
                  onPress={() => go(view === 'month' && v !== 'month' ? { view: v, date: chosen === today ? place.date : chosen } : { view: v })}
                  accessibilityRole="radio"
                  accessibilityLabel={`${label} view`}
                  accessibilityState={{ selected: on, checked: on }}
                  style={({ pressed }) => [styles.segmentItem, on && styles.segmentOn, pressed && styles.pressed]}
                >
                  <Text style={[styles.segmentText, on && styles.segmentTextOn]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable
            onPress={() => setFiltersOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={filterCount ? `Filters, ${filterCount} on` : 'Filters'}
            style={({ pressed }) => [styles.pill, filterCount > 0 && styles.pillOn, pressed && styles.pressed]}
          >
            <Text style={[styles.pillText, filterCount > 0 && styles.pillTextOn]}>{filterCount ? `Filters (${filterCount})` : 'Filters'}</Text>
          </Pressable>
        </View>
      </View>

      {rangeQ.isLoading ? (
        <Loader />
      ) : rangeQ.isError && !rangeQ.data ? (
        <View style={styles.errorWrap}>
          <ErrorNote
            message={isNetworkError(rangeQ.error) ? 'Couldn’t load the calendar — you appear to be offline, and this phone hasn’t saved it yet.' : 'Couldn’t load the calendar.'}
            onRetry={() => void refetchRange()}
            retrying={rangeQ.isFetching}
          />
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(row) => row.key}
          renderItem={renderItem}
          renderSectionHeader={renderSectionHeader}
          stickySectionHeadersEnabled={false}
          ListHeaderComponent={header}
          ListEmptyComponent={view === 'agenda' ? emptyAgenda : null}
          ListFooterComponent={<Text style={styles.footer}>{timeZoneNote(zones.company, zones.own)}</Text>}
          contentContainerStyle={[styles.list, { paddingBottom: spacing.xxl * 3 + insets.bottom }]}
          style={rangeQ.isPlaceholderData ? styles.dimmed : undefined}
          accessibilityState={{ busy: rangeQ.isFetching }}
          initialNumToRender={12}
          windowSize={7}
          refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
        />
      )}

      {canCreate ? (
        <Pressable
          style={({ pressed }) => [styles.fab, { bottom: spacing.lg + insets.bottom }, pressed && styles.pressed]}
          onPress={() => setCreateOn(addDay)}
          accessibilityRole="button"
          accessibilityLabel={`Add a task on ${dayLabel(addDay)}`}
        >
          <Text style={styles.fabPlus}>＋</Text>
        </Pressable>
      ) : null}

      {toast ? (
        <View
          style={[styles.toast, toast.tone === 'error' && styles.toastError, { bottom: spacing.lg + insets.bottom + 64 }]}
          accessibilityLiveRegion={toast.tone === 'error' ? 'assertive' : 'polite'}
        >
          <Text style={styles.toastText}>{toast.text}</Text>
          {toast.undo ? (
            <Pressable onPress={toast.undo} accessibilityRole="button" accessibilityLabel="Undo the move" style={({ pressed }) => [styles.toastButton, pressed && styles.pressed]}>
              <Text style={styles.toastUndo}>Undo</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={() => setToast(null)} accessibilityRole="button" accessibilityLabel="Dismiss" style={({ pressed }) => [styles.toastButton, pressed && styles.pressed]}>
            <Text style={styles.toastClose}>✕</Text>
          </Pressable>
        </View>
      ) : null}

      <MoveDaySheet item={moving} today={today} weekStart={weekStart} onMove={move} onClose={() => setMoving(null)} />
      <TaskInfoSheet
        item={info}
        projectName={info ? projectById.get(info.task.projectId)?.name : undefined}
        timeZone={timeZone}
        onOpen={(item) => {
          setInfo(null);
          openTask(item);
        }}
        onClose={() => setInfo(null)}
      />
      <NewTaskOnDay day={createOn} presetProjectId={newTaskProject(filters.projectId, projects)} projects={projects} onClose={() => setCreateOn(null)} />
      <GoToDateSheet
        visible={goTo}
        current={cursor}
        today={today}
        weekStart={weekStart}
        onGo={(day) => {
          setGoTo(false);
          setSelected(day);
          go({ date: day });
        }}
        onClose={() => setGoTo(false)}
      />
      <CalendarFiltersSheet
        visible={filtersOpen}
        filters={filters}
        onChange={(next: CalendarFilters) => go({ filters: next })}
        projectOptions={projectOptions}
        personOptions={personOptions}
        timeNote={timeZoneNote(zones.company, zones.own)}
        onClose={() => setFiltersOpen(false)}
      />
    </SafeAreaView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.ground },
    toolbar: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      paddingBottom: spacing.sm,
      gap: spacing.sm,
      backgroundColor: c.ground,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.line,
    },
    toolRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
    iconButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface },
    iconText: { fontSize: fontSize.xl, fontWeight: '700', color: c.ink },
    pill: { minHeight: 44, justifyContent: 'center', borderWidth: 1, borderColor: c.line, borderRadius: radius.pill, paddingHorizontal: spacing.md, backgroundColor: c.surface },
    pillOn: { borderColor: c.brand, backgroundColor: c.brandWash },
    pillText: { fontSize: fontSize.sm, fontWeight: '700', color: c.ink },
    pillTextOn: { color: c.brand },
    periodButton: { flex: 1, minWidth: 120, minHeight: 44, justifyContent: 'center' },
    period: { fontSize: fontSize.lg, fontWeight: '800', color: c.ink },
    segment: { flexDirection: 'row', borderWidth: 1, borderColor: c.line, borderRadius: radius.md, backgroundColor: c.surface, padding: 2 },
    segmentItem: { minHeight: 40, minWidth: 64, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
    segmentOn: { backgroundColor: c.brand },
    segmentText: { fontSize: fontSize.sm, fontWeight: '700', color: c.ink2 },
    segmentTextOn: { color: c.onBrand },
    pressed: { opacity: 0.7 },
    list: { padding: spacing.lg, gap: spacing.sm },
    dimmed: { opacity: 0.6 },
    header: { gap: spacing.sm, marginBottom: spacing.xs },
    note: { fontSize: fontSize.sm, color: c.ink2, backgroundColor: c.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: c.line },
    nothingBar: { gap: spacing.sm, borderWidth: 1, borderStyle: 'dashed', borderColor: c.line, borderRadius: radius.md, padding: spacing.md, backgroundColor: c.surface },
    nothingText: { fontSize: fontSize.sm, fontWeight: '600', color: c.ink },
    earlier: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', borderWidth: 1, borderColor: c.line, borderRadius: radius.md, paddingHorizontal: spacing.md },
    earlierText: { fontSize: fontSize.sm, fontWeight: '700', color: c.ink2 },
    sectionHead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginTop: spacing.md },
    sectionTitle: { flexShrink: 1, fontSize: fontSize.md, fontWeight: '800', color: c.ink },
    todayTitle: { color: c.brand },
    overdueTitle: { color: c.danger },
    add: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface },
    addText: { fontSize: fontSize.sm, fontWeight: '700', color: c.brand },
    empty: { fontSize: fontSize.sm, color: c.ink3, paddingVertical: spacing.xs },
    more: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
    moreText: { fontSize: fontSize.sm, fontWeight: '700', color: c.danger },
    emptyAgenda: { gap: spacing.md },
    errorWrap: { padding: spacing.lg },
    footer: { fontSize: fontSize.xs, color: c.ink3, marginTop: spacing.lg, textAlign: 'center' },
    fab: {
      position: 'absolute',
      right: spacing.lg,
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: c.brand,
      alignItems: 'center',
      justifyContent: 'center',
      elevation: 4,
    },
    fabPlus: { fontSize: 28, color: c.onBrand, fontWeight: '700', lineHeight: 32 },
    toast: {
      position: 'absolute',
      left: spacing.lg,
      right: spacing.lg,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.sm,
      paddingLeft: spacing.md,
      paddingRight: spacing.xs,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.line,
      backgroundColor: c.surface,
      elevation: 6,
    },
    toastError: { borderColor: c.danger },
    toastText: { flex: 1, fontSize: fontSize.sm, color: c.ink },
    toastButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    toastUndo: { fontSize: fontSize.sm, fontWeight: '800', color: c.brand },
    toastClose: { fontSize: fontSize.md, color: c.ink2 },
  });
