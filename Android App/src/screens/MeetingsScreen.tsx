import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, Pressable, FlatList, StyleSheet, RefreshControl, type ListRenderItem } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { useDirectory, useMeetings, useProjects, type MeetingScope } from '../core/queries';
import { useColors } from '../core/theme';
import { SkeletonList, EmptyState, ErrorNote, TextField, Button, PageHeader, Chip } from '../components/ui';
import { Icon } from '../components/Icon';
import { MeetingCard } from '../components/meeting/MeetingCard';
import { UpNextCard } from '../components/meeting/UpNextCard';
import { MeetingSummaryStrip } from '../components/meeting/MeetingSummaryStrip';
import { NothingComingUp } from '../components/meeting/NothingComingUp';
import { MeetingFiltersSheet } from '../components/meeting/MeetingFiltersSheet';
import { openJoinLink, useMinuteNow, usePullRefresh } from '../components/meeting/live';
import { appTimeZone } from '../lib/due-date';
import {
  EMPTY_FILTERS,
  filterChips,
  filterMeetings,
  groupMeetings,
  hasActiveFilters,
  lastMeeting,
  lastMeetingLine,
  meetingListRows,
  meetingSummary,
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
import { font } from '../lib/typography';

/** What removing a chip clears. */
const CHIP_CLEARS: Record<FilterChip['key'], Partial<MeetingFilters> & { sort?: MeetingSort }> = {
  project: { projectId: '' },
  date: { range: 'any' },
  status: { status: 'ALL' },
  sort: { sort: 'date' },
  focus: { focus: undefined },
};

/**
 * Meetings (2a): every meeting you can see, as on the website — the title with "New meeting" beside
 * it, a search, all meetings or the ones you organize, the filters (project, date, status, sort)
 * with their chips, the four numbers at a glance (each also a filter), "Up next" (or "Nothing coming
 * up" with the last meeting), and the groups Today, Next 7 days, Later, Drafts and Past. Each card
 * opens the meeting; "New meeting" schedules one (2b). My Action Items is in the side menu.
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
  const { refetch: refetchMeetings } = meetingsQ;
  const pull = usePullRefresh(useCallback(() => refetchMeetings(), [refetchMeetings]));

  const projects = useMemo(() => [...(projectsQ.data ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'en')), [projectsQ.data]);
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
  // The Filters chip counts what its own sheet sets (not the sort, nor a number tapped above the list).
  const filterCount = chips.filter((ch) => ch.key !== 'sort' && ch.key !== 'focus').length;
  const filtersInUse = filterCount > 0 || sort !== 'date';
  const drafts = all.filter((m) => m.status === 'DRAFT').length;
  // The numbers count the whole list, whatever is searched or filtered (as on the website).
  const summary = useMemo(() => meetingSummary(all, ctx), [all, ctx]);
  // The next meeting, on top — unless the list is being searched or filtered.
  const upNext = filtered ? null : nextUpMeeting(all, now);
  // A quiet week: loaded, nothing filtered, some meetings, none coming up.
  const quiet = !!meetingsQ.data && !filtered && all.length > 0 && !upNext;
  const last = quiet ? lastMeeting(all, now) : null;

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
      <PageHeader
        title="Meetings"
        actions={<Button size="sm" icon="ui.plus" title="New meeting" accessibilityLabel="Schedule a new meeting" onPress={() => navigation.navigate('MeetingForm')} />}
      />
      <TextField
        value={filters.q}
        onChangeText={(q) => change({ q })}
        placeholder="Search title, place, project, organizer"
        accessibilityLabel="Search meetings"
        autoCapitalize="none"
        style={styles.search}
      />
      {/* One wrapping row, as the website's phone layout: whose meetings (short words), Filters, Drafts. */}
      <View style={styles.scope}>
        <Chip label="All" a11yLabel="All meetings" selected={scope === 'all'} onPress={() => setScope('all')} />
        <Chip label="Mine" a11yLabel="Organized by me" selected={scope === 'mine'} onPress={() => setScope('mine')} />
        <Chip
          label={filterCount ? `Filters (${filterCount})` : 'Filters'}
          a11yLabel={filterCount ? `Filters, ${filterCount} in use` : 'Filters'}
          selected={filtersInUse}
          onPress={() => setSheet(true)}
        />
        {drafts > 0 ? (
          <Chip
            label={`Drafts (${drafts})`}
            selected={filters.status === 'DRAFT'}
            onPress={() => change({ status: filters.status === 'DRAFT' ? 'ALL' : 'DRAFT' })}
            a11yLabel={`Show drafts only, ${drafts}`}
          />
        ) : null}
      </View>

      {/* The numbers: once there is a meeting (four zeros over an empty page say nothing). */}
      {meetingsQ.data && all.length > 0 ? <MeetingSummaryStrip summary={summary} focus={filters.focus} onFocus={(focus) => change({ focus })} /> : null}

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
              <Text style={styles.usedChipText}>{ch.label}</Text>
              <Icon name="ui.close" size={12} color={c.ink2} />
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
      {quiet ? (
        <NothingComingUp
          last={last ? lastMeetingLine(last, now, ctx.timeZone) : null}
          onOpen={() => (last ? open(last) : undefined)}
          onSchedule={() => navigation.navigate('MeetingForm')}
        />
      ) : null}
    </View>
  );

  const empty = meetingsQ.isLoading ? (
    <SkeletonList rows={4} />
  ) : meetingsQ.isError && !meetingsQ.data ? (
    <ErrorNote message="Couldn’t load meetings. Check your connection and try again." onRetry={() => void meetingsQ.refetch()} retrying={meetingsQ.isFetching} />
  ) : filtered ? (
    <EmptyState
      icon="ui.search"
      title="No meetings match these filters"
      subtitle="Try another search or date, or clear the filters to see everything."
      action={{ title: 'Clear filters', onPress: clearFilters }}
    />
  ) : (
    <EmptyState
      icon="nav.meetings"
      title={scope === 'mine' ? 'You haven’t organized any meetings yet' : 'No meetings yet'}
      subtitle="Schedule one with “New meeting” — the ones you can see show up here."
      action={{ title: 'New meeting', onPress: () => navigation.navigate('MeetingForm') }}
    />
  );

  return (
    <SafeAreaView style={styles.safe} edges={[]}>
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
    scope: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
    pressed: { opacity: 0.7 },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
    usedChip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: c.brand, backgroundColor: c.brandWash, borderRadius: radius.pill, paddingHorizontal: spacing.md, minHeight: 32, justifyContent: 'center' },
    usedChipText: { fontSize: fontSize.xs, ...font('600'), color: c.ink },
    summary: { fontSize: fontSize.sm, color: c.ink2 },
    clearAll: { minHeight: 32, justifyContent: 'center', paddingHorizontal: spacing.xs },
    clearAllText: { fontSize: fontSize.sm, ...font('700'), color: c.brandText },
    groupTitle: { fontSize: fontSize.xs, ...font('600', 'display'), color: c.ink3, letterSpacing: 0.8, marginTop: spacing.sm },
  });
