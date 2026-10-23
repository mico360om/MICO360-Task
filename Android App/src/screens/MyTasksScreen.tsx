import React, { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { View, Text, Pressable, FlatList, StyleSheet, RefreshControl, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useDirectory, useMyTasks, useProjectColumns, useProjects } from '../core/queries';
import { useBulkTaskActions, useSavedViews } from '../core/my-tasks-queries';
import { useServices } from '../core/providers';
import { useDatePreferences } from '../core/calendar-queries';
import { useColors } from '../core/theme';
import { Loader, EmptyState, ErrorNote, TextField, Button } from '../components/ui';
import { Sheet } from '../components/meeting/sheet-kit';
import { DayPicker } from '../components/calendar/CalendarSheets';
import { ChoiceSheet } from '../components/my-tasks/ChoiceSheet';
import { MyTaskItem } from '../components/my-tasks/MyTaskItem';
import { notice } from '../components/notice';
import {
  BUILT_IN_VIEWS,
  DUE_OPTIONS,
  EMPTY_FILTERS,
  MY_TASKS_TEXT,
  PRIORITY_OPTIONS,
  SORT_OPTIONS,
  assigneeFilterOptions,
  chipState,
  enrichMyTasks,
  filterMyTasks,
  filtersActive,
  filtersEqual,
  myTaskCounts,
  projectFilterOptions,
  selectedOf,
  showingText,
  sortMyTasks,
  statusFilterOptions,
  toggleAllVisible,
  toggleChip,
  type MyTaskRow,
  type Option,
  type TaskFilters,
} from '../lib/my-tasks';
import { BULK_LABELS, bulkProgressText, bulkResultText, clearDatesQuestion, type BulkAction } from '../lib/bulk-actions';
import { formColumns } from '../lib/task-form';
import { stillSignedIn } from '../lib/owned-write';
import { companyTodayKey, dateZones, subscribeTimeZone } from '../lib/due-date';
import { shiftDayKey, weekStartOf, fullDayLabel } from '../lib/calendar';
import { spacing, radius, fontSize, type Palette } from '../lib/theme';
import { displayName, type Priority } from '../lib/types';
import type { TabScreenProps } from '../navigation/types';

type FilterSheet = 'project' | 'status' | 'priority' | 'assignee' | 'due' | 'sort';

/** Room under the list for the New task button (and the bulk bar, at least). */
const LIST_BOTTOM = spacing.xxl * 4;
type BulkSheet = 'due' | 'priority' | 'assign' | 'move';

/**
 * My Tasks (4d), as the website's page: everything assigned to you, across every project. The
 * All / Open / Overdue / Completed chips; filters by project, status, priority, assignee and due
 * date; four sorts; saved views (the website's three, and your own, kept on this phone); and — for
 * the tasks you tick (only ones shown) — Complete, a due date (cleared after asking), a priority,
 * someone to assign, or a column of the project filtered to, each task through its own write
 * (kept on this phone offline). A virtualized list; the search box is this app's own.
 */
export function MyTasksScreen({ navigation }: TabScreenProps<'MyTasks'>) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const tasksQ = useMyTasks();
  const projectsQ = useProjects();
  const projects = useMemo(() => projectsQ.data ?? [], [projectsQ.data]);
  const dirQ = useDirectory();
  // "Today" and "overdue" are company calendar days.
  const timeZone = useSyncExternalStore(subscribeTimeZone, dateZones, dateZones).company;
  const now = useMemo(() => new Date(), [tasksQ.dataUpdatedAt, timeZone]);
  const today = companyTodayKey(now, timeZone);
  const weekStart = weekStartOf(useDatePreferences().data);

  const [filters, setFilters] = useState<TaskFilters>(EMPTY_FILTERS);
  const set = (patch: Partial<TaskFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const [q, setQ] = useState('');
  const rows = useMemo(() => enrichMyTasks(tasksQ.data ?? [], projects, { timeZone, now }), [tasksQ.data, projects, timeZone, now]);
  const shown = useMemo(() => sortMyTasks(filterMyTasks(rows, filters, { timeZone, now, q }), filters.sort), [rows, filters, timeZone, now, q]);
  const counts = useMemo(() => myTaskCounts(rows), [rows]);
  const chips = chipState(filters);
  const active = filtersActive(filters) || q.trim() !== '';
  const clearFilters = () => {
    setFilters((f) => toggleChip(f, 'all'));
    setQ('');
  };

  // ── Filters and sort ──
  const [sheet, setSheet] = useState<FilterSheet | null>(null);
  const options: Record<FilterSheet, Option[]> = {
    project: projectFilterOptions(tasksQ.data ?? [], projects),
    status: statusFilterOptions(rows),
    priority: PRIORITY_OPTIONS,
    assignee: assigneeFilterOptions(tasksQ.data ?? []),
    due: DUE_OPTIONS,
    sort: SORT_OPTIONS,
  };
  const labelOf = (k: FilterSheet) => options[k].find((o) => o.value === filters[k === 'due' ? 'due' : k])?.label ?? options[k][0]!.label;
  const filterButtons: { key: FilterSheet; a11y: string; title: string }[] = [
    { key: 'project', a11y: 'Filter by project', title: 'Project' },
    { key: 'status', a11y: 'Filter by status', title: 'Status' },
    { key: 'priority', a11y: 'Filter by priority', title: 'Priority' },
    { key: 'assignee', a11y: 'Filter by assignee', title: 'Assignee' },
    { key: 'due', a11y: 'Filter by due date', title: 'Due' },
    { key: 'sort', a11y: 'Sort tasks', title: 'Sort' },
  ];

  // ── Saved views ──
  const views = useSavedViews();
  const allViews = [...BUILT_IN_VIEWS, ...views.custom];
  const activeView = allViews.find((v) => filtersEqual(filters, v.filters))?.id;
  const [naming, setNaming] = useState<string | null>(null);

  // ── Selecting, and bulk actions ──
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const chosen = useMemo(() => selectedOf(shown, selected), [shown, selected]);
  const allShownSelected = shown.length > 0 && chosen.length === shown.length;
  const toggle = useCallback((id: string) => setSelected((sel) => {
    const next = new Set(sel);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  }), []);
  const bulk = useBulkTaskActions();
  const { currentUserId } = useServices();
  const [busy, setBusy] = useState(false);
  // How far a run is ("12 of 150 done…"), and its Stop: the tasks after it stay as they are (final review A2).
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const stopRun = useRef(false);
  const [bulkSheet, setBulkSheet] = useState<BulkSheet | null>(null);
  const [bulkDay, setBulkDay] = useState<string | null>(null);
  const runBulkAction = async (action: BulkAction, label: string) => {
    if (chosen.length === 0 || busy) return;
    setBulkSheet(null);
    setBusy(true);
    stopRun.current = false;
    setProgress({ done: 0, total: chosen.length });
    // Who ran it: how it went is said to them only (final review A5).
    const maker = currentUserId();
    try {
      const result = await bulk(
        chosen.map((r) => ({ id: r.task.id, projectId: r.task.projectId, version: r.task.version })),
        action,
        { onProgress: (done, total) => setProgress({ done, total }), shouldContinue: () => !stopRun.current },
      );
      if (!stillSignedIn(maker, currentUserId())) return;
      setSelected(new Set());
      notice(bulkResultText(label, result));
    } catch {
      if (stillSignedIn(maker, currentUserId())) notice('Bulk action failed. Please try again.');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };
  const clearDates = () =>
    Alert.alert(clearDatesQuestion(chosen.length), undefined, [
      { text: 'Keep', style: 'cancel' },
      { text: 'Clear dates', style: 'destructive', onPress: () => void runBulkAction({ type: 'setDueDate', dueDate: null }, BULK_LABELS.setDueDate) },
    ]);
  // Move to…: only with one project chosen (its shown columns), as on the website.
  const moveColumnsQ = useProjectColumns(filters.project);
  const moveColumns = filters.project ? formColumns(moveColumnsQ.data).map((col) => ({ value: col.id, label: col.name, dot: col.color })) : [];
  const people = (dirQ.data ?? []).filter((u) => u.active !== false).map((u) => ({ value: u.id, label: displayName(u) }));

  const open = useCallback((r: MyTaskRow) => navigation.navigate('TaskDetail', { taskId: r.task.id, title: r.task.title }), [navigation]);

  // The bulk bar: while tasks are ticked, and until a run ends. The list leaves room for it as tall as
  // it really is — at large text its buttons wrap to two or three rows (final review A9).
  const showBar = chosen.length > 0 || busy;
  const [barHeight, setBarHeight] = useState(0);
  const listBottom = showBar ? Math.max(LIST_BOTTOM, barHeight + spacing.md + spacing.lg) : LIST_BOTTOM;

  if (tasksQ.isLoading) return <Loader />;

  const header = (
    <View style={s.head}>
      <Text style={s.subtitle}>{MY_TASKS_TEXT.subtitle}</Text>
      <TextField value={q} onChangeText={setQ} placeholder="Search my tasks…" accessibilityLabel="Search my tasks" autoCapitalize="none" style={s.search} />
      {counts.total > 0 ? (
        <>
          <View style={s.rowWrap}>
            <Text style={s.eyebrow}>Views</Text>
            {allViews.map((v) => (
              <View key={v.id} style={[s.view, v.id === activeView && s.chipOn]}>
                <Pressable onPress={() => setFilters(v.filters)} accessibilityRole="button" accessibilityLabel={`View: ${v.name}`} accessibilityState={{ selected: v.id === activeView }} style={s.viewMain}>
                  <Text style={[s.chipText, v.id === activeView && s.chipTextOn]}>
                    {v.builtIn ? '★ ' : ''}
                    {v.name}
                  </Text>
                </Pressable>
                {!v.builtIn ? (
                  <Pressable onPress={() => views.remove(v.id)} accessibilityRole="button" accessibilityLabel={`Delete view ${v.name}`} hitSlop={6} style={s.viewX}>
                    <Text style={s.viewXText}>×</Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
            {naming === null && filtersActive(filters) ? (
              <Pressable onPress={() => setNaming('')} accessibilityRole="button" accessibilityLabel="Save view" style={s.saveView}>
                <Text style={s.chipText}>＋ Save view</Text>
              </Pressable>
            ) : null}
          </View>
          {naming !== null ? (
            <View style={s.naming}>
              <View style={s.flex}>
                <TextField value={naming} onChangeText={setNaming} placeholder="Name this view…" accessibilityLabel="Name this view" autoFocus />
              </View>
              <Button
                title="Save"
                disabled={!naming.trim()}
                onPress={() => {
                  views.save(naming, filters);
                  setNaming(null);
                }}
              />
              <Button title="Cancel" variant="ghost" onPress={() => setNaming(null)} />
            </View>
          ) : null}
          <View style={s.rowWrap}>
            <Chip label="All" value={counts.total} on={chips.all} onPress={() => setFilters((f) => toggleChip(f, 'all'))} dot={c.ink3} s={s} />
            <Chip label="Open" value={counts.open} on={chips.open} onPress={() => setFilters((f) => toggleChip(f, 'open'))} dot={c.info} s={s} />
            <Chip label="Overdue" value={counts.overdue} on={chips.overdue} onPress={() => setFilters((f) => toggleChip(f, 'overdue'))} dot={c.danger} s={s} />
            <Chip label="Completed" value={counts.done} on={chips.completed} onPress={() => setFilters((f) => toggleChip(f, 'completed'))} dot={c.success} s={s} />
          </View>
          <View style={s.rowWrap}>
            {filterButtons.map((b) => {
              const on = b.key !== 'sort' && !!filters[b.key];
              return (
                <Pressable key={b.key} onPress={() => setSheet(b.key)} accessibilityRole="button" accessibilityLabel={`${b.a11y}: ${labelOf(b.key)}`} style={({ pressed }) => [s.filter, on && s.chipOn, pressed && s.pressed]}>
                  <Text style={[s.chipText, on && s.chipTextOn]} numberOfLines={1}>
                    {b.title}: {labelOf(b.key)} ▾
                  </Text>
                </Pressable>
              );
            })}
            {filtersActive(filters) ? (
              <Pressable onPress={clearFilters} accessibilityRole="button" accessibilityLabel="Clear filters" style={s.clear}>
                <Text style={s.clearText}>Clear</Text>
              </Pressable>
            ) : null}
          </View>
          {shown.length > 0 ? (
            <View style={s.selectRow}>
              <Pressable
                onPress={() => setSelected(toggleAllVisible(shown, selected))}
                accessibilityRole="checkbox"
                accessibilityLabel="Select all tasks"
                accessibilityState={{ checked: allShownSelected }}
                style={s.selectAll}
              >
                <View style={[s.box, allShownSelected && s.boxOn]}>{allShownSelected ? <Text style={s.tick}>✓</Text> : null}</View>
                <Text style={s.selectText}>Select all</Text>
              </Pressable>
              <Text style={s.showing} accessibilityLiveRegion="polite">
                {showingText(shown.length, counts.total, active)}
              </Text>
            </View>
          ) : null}
        </>
      ) : null}
      {tasksQ.isError && !tasksQ.data ? <ErrorNote message="Couldn't load your tasks." onRetry={() => void tasksQ.refetch()} retrying={tasksQ.isRefetching} /> : null}
    </View>
  );

  const empty =
    tasksQ.isError && !tasksQ.data ? null : counts.total === 0 ? (
      <EmptyState title={MY_TASKS_TEXT.emptyTitle} subtitle={MY_TASKS_TEXT.emptyText} />
    ) : (
      <View style={s.noMatch}>
        <EmptyState title={MY_TASKS_TEXT.noMatchTitle} subtitle={MY_TASKS_TEXT.noMatchText} />
        <Button title="Clear filters" variant="secondary" onPress={clearFilters} />
      </View>
    );

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <FlatList
        data={shown}
        keyExtractor={(r) => r.task.id}
        renderItem={({ item }) => <MyTaskItem row={item} selected={selected.has(item.task.id)} onOpen={open} onToggle={toggle} />}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        contentContainerStyle={[s.list, { paddingBottom: listBottom }]}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={10}
        windowSize={9}
        refreshControl={<RefreshControl refreshing={tasksQ.isRefetching} onRefresh={() => void tasksQ.refetch()} />}
      />

      {showBar ? (
        <View style={s.bulkBar} onLayout={(e) => setBarHeight(e.nativeEvent.layout.height)} accessibilityLabel="Bulk actions">
          <View style={s.bulkHead}>
            {busy ? <ActivityIndicator size="small" color={c.brand} /> : null}
            <Text style={s.bulkCount} accessibilityLiveRegion="polite">
              {busy && progress ? bulkProgressText(progress.done, progress.total) : `${chosen.length} selected`}
            </Text>
            {busy ? (
              // While it runs, the bar stays (and says how far it is); Stop, not Clear (final review A2, A9).
              <Pressable
                onPress={() => (stopRun.current = true)}
                accessibilityRole="button"
                accessibilityLabel="Stop the bulk action"
                accessibilityHint="The tasks not changed yet stay as they are"
                style={s.clear}
              >
                <Text style={s.clearText}>Stop</Text>
              </Pressable>
            ) : (
              <Pressable onPress={() => setSelected(new Set())} accessibilityRole="button" accessibilityLabel="Clear selection" style={s.clear}>
                <Text style={s.clearText}>Clear</Text>
              </Pressable>
            )}
          </View>
          <View style={s.rowWrap}>
            <BulkButton label="Complete" onPress={() => void runBulkAction({ type: 'complete' }, BULK_LABELS.complete)} disabled={busy} s={s} strong />
            <BulkButton label="Due date…" onPress={() => setBulkSheet('due')} disabled={busy} s={s} />
            <BulkButton label="Priority…" onPress={() => setBulkSheet('priority')} disabled={busy} s={s} />
            <BulkButton label="Assign to…" onPress={() => setBulkSheet('assign')} disabled={busy || people.length === 0} s={s} />
            {filters.project ? <BulkButton label="Move to…" onPress={() => setBulkSheet('move')} disabled={busy || moveColumns.length === 0} s={s} /> : null}
          </View>
        </View>
      ) : (
        <Pressable
          style={({ pressed }) => [s.fab, pressed && { opacity: 0.8 }]}
          // New task (4a): in the project filtered to (changeable), else the one used last time.
          onPress={() => navigation.navigate('NewTask', filters.project ? { defaultProjectId: filters.project } : undefined)}
          accessibilityRole="button"
          accessibilityLabel="New task"
        >
          <Text style={s.fabPlus}>＋</Text>
        </Pressable>
      )}

      {sheet ? (
        <ChoiceSheet
          visible
          title={filterButtons.find((b) => b.key === sheet)!.a11y}
          options={options[sheet]}
          value={filters[sheet]}
          onChoose={(v) => set({ [sheet]: v } as Partial<TaskFilters>)}
          onClose={() => setSheet(null)}
        />
      ) : null}

      <ChoiceSheet
        visible={bulkSheet === 'priority'}
        title="Set priority"
        options={PRIORITY_OPTIONS.filter((o) => o.value)}
        onChoose={(p) => void runBulkAction({ type: 'setPriority', priority: p as Priority }, BULK_LABELS.setPriority)}
        onClose={() => setBulkSheet(null)}
      />
      <ChoiceSheet visible={bulkSheet === 'assign'} title="Assign to" options={people} onChoose={(userId) => void runBulkAction({ type: 'assign', userId }, BULK_LABELS.assign)} onClose={() => setBulkSheet(null)} />
      <ChoiceSheet visible={bulkSheet === 'move'} title="Move to" options={moveColumns} onChoose={(columnId) => void runBulkAction({ type: 'move', columnId }, BULK_LABELS.move)} onClose={() => setBulkSheet(null)} />
      <Sheet
        visible={bulkSheet === 'due'}
        title="Due date for selected tasks"
        subtitle={bulkDay ? fullDayLabel(bulkDay) : 'Pick the day'}
        onClose={() => setBulkSheet(null)}
        footer={
          <>
            <Button
              title="Clear date…"
              variant="ghost"
              onPress={() => {
                setBulkSheet(null);
                clearDates();
              }}
              style={s.flex}
            />
            <Button
              title="Set date"
              disabled={!bulkDay}
              onPress={() => {
                if (bulkDay) void runBulkAction({ type: 'setDueDate', dueDate: bulkDay }, BULK_LABELS.setDueDate);
                setBulkDay(null);
              }}
              style={s.flex}
            />
          </>
        }
      >
        <DayPicker
          value={bulkDay}
          onChange={setBulkDay}
          today={today}
          weekStart={weekStart}
          quick={[
            { label: 'Today', day: today },
            { label: 'Tomorrow', day: shiftDayKey(today, 1) },
            { label: 'In a week', day: shiftDayKey(today, 7) },
          ]}
          hint="Sets the due date of the selected tasks"
        />
      </Sheet>
    </SafeAreaView>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function Chip({ label, value, on, onPress, dot, s }: { label: string; value: number; on: boolean; onPress: () => void; dot: string; s: Styles }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} accessibilityState={{ selected: on }} style={({ pressed }) => [s.chip, on && s.chipOn, pressed && s.pressed]}>
      <View style={[s.chipDot, { backgroundColor: dot }]} />
      <Text style={[s.chipText, on && s.chipTextOn]}>{label}</Text>
      <Text style={[s.chipValue, on && s.chipTextOn]}>{value}</Text>
    </Pressable>
  );
}

function BulkButton({ label, onPress, disabled, s, strong }: { label: string; onPress: () => void; disabled?: boolean; s: Styles; strong?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }} style={({ pressed }) => [s.bulkButton, strong && s.bulkStrong, (pressed || disabled) && s.pressed]}>
      <Text style={[s.bulkText, strong && s.bulkStrongText]}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.ground },
    flex: { flex: 1 },
    pressed: { opacity: 0.6 },
    list: { padding: spacing.lg, gap: spacing.sm, paddingBottom: LIST_BOTTOM },
    head: { gap: spacing.sm, marginBottom: spacing.xs },
    subtitle: { fontSize: fontSize.sm, color: c.ink2 },
    search: { marginBottom: 0 },
    eyebrow: { fontSize: fontSize.xs, fontWeight: '700', color: c.ink3, textTransform: 'uppercase', letterSpacing: 0.5 },
    rowWrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
    view: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: c.line, borderRadius: radius.pill, backgroundColor: c.surface },
    viewMain: { minHeight: 40, justifyContent: 'center', paddingHorizontal: spacing.md },
    viewX: { minHeight: 40, minWidth: 32, alignItems: 'center', justifyContent: 'center', paddingRight: spacing.sm },
    viewXText: { fontSize: fontSize.md, color: c.ink3, fontWeight: '700' },
    saveView: { minHeight: 40, justifyContent: 'center', borderWidth: 1, borderStyle: 'dashed', borderColor: c.line, borderRadius: radius.pill, paddingHorizontal: spacing.md },
    naming: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    chip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, borderWidth: 1, borderColor: c.line, borderRadius: radius.pill, paddingHorizontal: spacing.md, backgroundColor: c.surface },
    chipOn: { borderColor: c.brand, backgroundColor: c.brandWash },
    chipDot: { width: 7, height: 7, borderRadius: 4 },
    chipText: { fontSize: fontSize.sm, color: c.ink2, fontWeight: '600' },
    chipTextOn: { color: c.brand },
    chipValue: { fontSize: fontSize.sm, color: c.ink, fontWeight: '800' },
    filter: { minHeight: 40, maxWidth: '100%', justifyContent: 'center', borderWidth: 1, borderColor: c.line, borderRadius: radius.md, paddingHorizontal: spacing.md, backgroundColor: c.surface },
    clear: { minHeight: 40, justifyContent: 'center', paddingHorizontal: spacing.sm },
    clearText: { fontSize: fontSize.sm, color: c.brand, fontWeight: '700' },
    selectRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.xs },
    selectAll: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
    box: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: c.ink3, alignItems: 'center', justifyContent: 'center' },
    boxOn: { borderColor: c.brand, backgroundColor: c.brand },
    tick: { color: c.onBrand, fontSize: 14, fontWeight: '900', lineHeight: 16 },
    selectText: { fontSize: fontSize.sm, color: c.ink2, fontWeight: '600' },
    showing: { flex: 1, textAlign: 'right', fontSize: fontSize.xs, color: c.ink2 },
    noMatch: { gap: spacing.md, alignItems: 'center' },
    bulkBar: { position: 'absolute', left: spacing.md, right: spacing.md, bottom: spacing.md, backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: c.line, padding: spacing.md, gap: spacing.sm, elevation: 6 },
    bulkHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    bulkCount: { flex: 1, fontSize: fontSize.md, fontWeight: '800', color: c.ink },
    bulkButton: { minHeight: 44, justifyContent: 'center', borderWidth: 1, borderColor: c.line, borderRadius: radius.md, paddingHorizontal: spacing.md },
    bulkStrong: { borderColor: c.success, backgroundColor: c.successSoft },
    bulkText: { fontSize: fontSize.sm, fontWeight: '700', color: c.brand },
    bulkStrongText: { color: c.success },
    fab: { position: 'absolute', right: spacing.lg, bottom: spacing.lg, width: 56, height: 56, borderRadius: 28, backgroundColor: c.brand, alignItems: 'center', justifyContent: 'center', elevation: 4 },
    fabPlus: { color: c.onBrand, fontSize: 28, fontWeight: '700', lineHeight: 32 },
  });
