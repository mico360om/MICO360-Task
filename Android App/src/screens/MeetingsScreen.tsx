import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, Pressable, FlatList, StyleSheet, RefreshControl, type ListRenderItem } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { useDirectory, useMeetings, useMyActionItems, useProjects, type MeetingScope } from '../core/queries';
import { useColors } from '../core/theme';
import { Loader, EmptyState, ErrorNote, TextField, Button } from '../components/ui';
import { Chip } from '../components/task-detail/kit';
import { MeetingCard } from '../components/meeting/MeetingCard';
import { UpNextCard } from '../components/meeting/UpNextCard';
import { MeetingFiltersSheet } from '../components/meeting/MeetingFiltersSheet';
import { openJoinLink, useMinuteNow, usePullRefresh } from '../components/meeting/live';
import { appTimeZone } from '../lib/due-date';
import { isActionItemOverdue } from '../lib/meeting-detail';
import {
  EMPTY_FILTERS,
  filterChips,
  filterMeetings,
  groupMeetings,
  hasActiveFilters,
  meetingListRows,
  nextUpMeeting,
  type FilterChip,
  type ListContext,
  type MeetingFilters,
  type MeetingListRow,
  type MeetingSort,
} from '../lib/meeting-list';
import { displayName, type ApiMeeting } from '../lib/types';
import { spacing, radius, fontSize, type Palette } from '../lib/theme';
import type { TabScreenProps } from '../navigation/types';

/** What removing a chip clears. */
const CHIP_CLEARS: Record<FilterChip['key'], Partial<MeetingFilters> & { sort?: MeetingSort }> = {
  project: { projectId: '' },
  date: { range: 'any' },
  status: { status: 'ALL' },
  sort: { sort: 'date' },
};

/**
 * Meetings (2a): every meeting you can see, as on the website — "Up next" on top, a search, the
 * filters (project, date, status, sort) with their chips, all meetings or the ones you organize, and
 * the groups Today, Next 7 days, Later, Drafts and Past. Each card opens the meeting; "New meeting"
 * schedules one (2b).
 */
export function MeetingsScreen({ navigation }: TabScreenProps<'Meetings'>) {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  // The tab stays mounted elsewhere: out of view, its lists aren't fetched and "now" doesn't tick;
  // back in view, whatever went out of date meanwhile is fetched.
  const focused = useIsFocused();
  const now = useMinuteNow(focused);
  const [scope, setScope] = useState<MeetingScope>('all');
  const [filters, setFilters] = useState<MeetingFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<MeetingSort>('date');
  const [sheet, setSheet] = useState(false);
  const meetingsQ = useMeetings(scope, { active: focused });
  const projectsQ = useProjects();
  const dirQ = useDirectory();
  const itemsQ = useMyActionItems('open', { active: focused });
  const { refetch: refetchMeetings } = meetingsQ;
  const { refetch: refetchItems } = itemsQ;
  const pull = usePullRefresh(useCallback(() => Promise.all([refetchMeetings(), refetchItems()]), [refetchMeetings, refetchItems]));

  const projects = useMemo(() => [...(projectsQ.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [projectsQ.data]);
  const ctx: ListContext = useMemo(() => {
    const projectNames = new Map(projects.map((p) => [p.id, p.name]));
    const people = new Map((dirQ.data ?? []).map((u) => [u.id, displayName(u)]));
    return {
      timeZone: appTimeZone(),
      now,
      projectName: (id: string) => projectNames.get(id) ?? null,
      organizerName: (id: string) => people.get(id) ?? null,
    };
  }, [projects, dirQ.data, now]);

  const all = useMemo(() => meetingsQ.data ?? [], [meetingsQ.data]);
  const visible = useMemo(() => filterMeetings(all, filters, ctx), [all, filters, ctx]);
  const rows = useMemo(() => meetingListRows(groupMeetings(visible, ctx, sort)), [visible, ctx, sort]);
  const filtered = hasActiveFilters(filters);
  const chips = filterChips(filters, sort, ctx);
  const filterCount = chips.filter((ch) => ch.key !== 'sort').length;
  const drafts = all.filter((m) => m.status === 'DRAFT').length;
  // The next meeting, on top — unless the list is being searched or filtered.
  const upNext = filtered ? null : nextUpMeeting(all, now);
  const openItems = itemsQ.data ?? [];
  const overdueItems = openItems.filter((i) => isActionItemOverdue(i, now)).length;

  const change = useCallback((changes: Partial<MeetingFilters> & { sort?: MeetingSort }) => {
    const { sort: nextSort, ...rest } = changes;
    if (nextSort) setSort(nextSort);
    if (Object.keys(rest).length) setFilters((f) => ({ ...f, ...rest }));
  }, []);
  const clearFilters = () => setFilters(EMPTY_FILTERS);
  const clearAll = () => {
    setFilters(EMPTY_FILTERS);
    setSort('date');
  };
  const open = useCallback((m: Pick<ApiMeeting, 'id' | 'title'>) => navigation.navigate('MeetingDetail', { meetingId: m.id, title: m.title }), [navigation]);

  const renderItem: ListRenderItem<MeetingListRow> = useCallback(
    ({ item }) =>
      item.kind === 'group' ? (
        <Text style={styles.groupTitle} accessibilityRole="header">
          {item.label.toUpperCase()} · {item.count}
        </Text>
      ) : (
        <MeetingCard meeting={item.meeting} ctx={ctx} statusShown={item.statusShown} onPress={open} />
      ),
    [styles, ctx, open],
  );

  const header = (
    <View style={styles.header}>
      <Button title="＋ New meeting" accessibilityLabel="Schedule a new meeting" onPress={() => navigation.navigate('MeetingForm')} />
      <TextField
        value={filters.q}
        onChangeText={(q) => change({ q })}
        placeholder="Search title, place, project, organizer"
        accessibilityLabel="Search meetings"
        autoCapitalize="none"
        style={styles.search}
      />
      <View style={styles.controls}>
        <View style={styles.scope} accessibilityRole="radiogroup" accessibilityLabel="Whose meetings">
          <Chip label="All meetings" selected={scope === 'all'} onPress={() => setScope('all')} />
          <Chip label="Organized by me" selected={scope === 'mine'} onPress={() => setScope('mine')} />
        </View>
        <View style={styles.scope}>
          <Pressable
            onPress={() => setSheet(true)}
            accessibilityRole="button"
            accessibilityLabel={filterCount ? `Filters, ${filterCount} in use` : 'Filters'}
            style={({ pressed }) => [styles.filterButton, (filterCount > 0 || sort !== 'date') && styles.filterButtonOn, pressed && styles.pressed]}
          >
            <Text style={[styles.filterText, (filterCount > 0 || sort !== 'date') && styles.filterTextOn]}>⚙ Filters{filterCount ? ` (${filterCount})` : ''}</Text>
          </Pressable>
          {drafts > 0 ? (
            <Chip
              label={`Drafts (${drafts})`}
              selected={filters.status === 'DRAFT'}
              onPress={() => change({ status: filters.status === 'DRAFT' ? 'ALL' : 'DRAFT' })}
              a11yLabel={`Show drafts only, ${drafts}`}
            />
          ) : null}
        </View>
      </View>

      {filtered || chips.length ? (
        <View style={styles.chipRow}>
          {chips.map((ch) => (
            <Pressable
              key={ch.key}
              onPress={() => change(CHIP_CLEARS[ch.key])}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${ch.label}`}
              hitSlop={6}
              style={({ pressed }) => [styles.usedChip, pressed && styles.pressed]}
            >
              <Text style={styles.usedChipText}>{ch.label} ✕</Text>
            </Pressable>
          ))}
          {meetingsQ.data ? (
            <Text style={styles.summary} accessibilityLiveRegion="polite">
              {visible.length} {visible.length === 1 ? 'meeting matches' : 'meetings match'}
            </Text>
          ) : null}
          <Pressable onPress={clearAll} accessibilityRole="button" hitSlop={6} style={styles.clearAll}>
            <Text style={styles.clearAllText}>Clear all</Text>
          </Pressable>
        </View>
      ) : null}

      {upNext ? <UpNextCard meeting={upNext} ctx={ctx} onOpen={() => open(upNext)} onJoin={openJoinLink} /> : null}

      <Pressable
        onPress={() => navigation.navigate('MyActionItems')}
        accessibilityRole="button"
        accessibilityLabel={`My action items${openItems.length ? `, ${openItems.length} open${overdueItems ? `, ${overdueItems} overdue` : ''}` : ''}`}
        style={({ pressed }) => [styles.itemsLink, pressed && styles.pressed]}
      >
        <Text style={styles.itemsIcon} importantForAccessibility="no">☑</Text>
        <Text style={styles.itemsText}>My action items</Text>
        {openItems.length ? (
          <Text style={[styles.itemsCount, overdueItems > 0 && styles.overdue]}>
            {openItems.length} open{overdueItems ? ` · ${overdueItems} overdue` : ''}
          </Text>
        ) : null}
        <Text style={styles.chevron} importantForAccessibility="no">›</Text>
      </Pressable>
    </View>
  );

  const empty = meetingsQ.isLoading ? (
    <Loader />
  ) : meetingsQ.isError && !meetingsQ.data ? (
    <ErrorNote message="Couldn’t load meetings. Check your connection and try again." onRetry={() => void meetingsQ.refetch()} retrying={meetingsQ.isFetching} />
  ) : filtered ? (
    <View>
      <EmptyState title="No meetings match these filters" subtitle="Try another search or date, or clear the filters to see everything." />
      <Button title="Clear filters" variant="secondary" onPress={clearFilters} />
    </View>
  ) : (
    <EmptyState
      title={scope === 'mine' ? 'You haven’t organized any meetings yet' : 'No meetings yet'}
      subtitle="Schedule one with “New meeting” — the ones you can see show up here."
    />
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        renderItem={renderItem}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={10}
        windowSize={7}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
      />
      <MeetingFiltersSheet
        visible={sheet}
        filters={filters}
        sort={sort}
        projects={projects}
        onChange={change}
        onReset={clearAll}
        onClose={() => setSheet(false)}
      />
    </SafeAreaView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.ground },
    list: { padding: spacing.lg, gap: spacing.sm },
    header: { gap: spacing.sm, marginBottom: spacing.xs },
    search: { marginBottom: 0 },
    controls: { gap: spacing.sm },
    scope: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
    filterButton: {
      minHeight: 40,
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: c.line,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.md,
      backgroundColor: c.surface,
    },
    filterButtonOn: { borderColor: c.brand },
    filterText: { fontSize: fontSize.sm, fontWeight: '700', color: c.ink },
    filterTextOn: { color: c.brand },
    pressed: { opacity: 0.7 },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
    usedChip: { borderWidth: 1, borderColor: c.brand, backgroundColor: c.brandWash, borderRadius: radius.pill, paddingHorizontal: spacing.md, minHeight: 32, justifyContent: 'center' },
    usedChipText: { fontSize: fontSize.xs, fontWeight: '600', color: c.ink },
    summary: { fontSize: fontSize.sm, color: c.ink2 },
    clearAll: { minHeight: 32, justifyContent: 'center', paddingHorizontal: spacing.xs },
    clearAllText: { fontSize: fontSize.sm, fontWeight: '700', color: c.brand },
    itemsLink: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      minHeight: 48,
      paddingHorizontal: spacing.md,
      backgroundColor: c.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.line,
    },
    itemsIcon: { fontSize: fontSize.md, color: c.brand },
    itemsText: { flex: 1, fontSize: fontSize.md, fontWeight: '600', color: c.ink },
    itemsCount: { fontSize: fontSize.xs, fontWeight: '700', color: c.ink2 },
    overdue: { color: c.danger },
    chevron: { fontSize: fontSize.xl, color: c.ink3 },
    groupTitle: { fontSize: fontSize.xs, fontWeight: '800', color: c.ink3, letterSpacing: 0.8, marginTop: spacing.sm },
  });
