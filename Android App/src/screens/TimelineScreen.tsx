import { useCallback, useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View, useWindowDimensions, type ListRenderItem } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { Button, Chip, EmptyState, ErrorNote, IconButton, SkeletonList, StatTile } from '../components/ui';
import { InlinePicker } from '../components/meeting/sheet-kit';
import { useMinuteNow, usePullRefresh } from '../components/meeting/live';
import { TimelineRow } from '../components/timeline/TimelineRow';
import { useTimeline } from '../core/planning-queries';
import { useDatePreferences } from '../core/calendar-queries';
import { useColors } from '../core/theme';
import { weekDays, weekStartOf } from '../lib/calendar';
import { companyTodayKey } from '../lib/due-date';
import type { TimelineProject } from '../lib/planning-api';
import {
  DEFAULT_TIMELINE_STATE,
  TIMELINE_SORTS,
  TIMELINE_VIEWS,
  filterTimeline,
  ownerOptions,
  periodText,
  rangeFor,
  shiftAnchor,
  sortTimeline,
  statusLine,
  timelineSummary,
  type TimelineShow,
  type TimelineState,
} from '../lib/timeline';
import { statTileColumns } from '../lib/stat-grid';
import { spacing, type Palette } from '../lib/theme';
import { typeStyle } from '../lib/typography';
import type { AppScreenProps } from '../navigation/types';

/**
 * Timeline (Stage 3), as the website's phone layout: every open project with its health, the
 * server's progress, its next milestone and target; five cards (Late and At risk narrow the list);
 * a project's tasks under its row. The weeks follow your week start and the company's day. The
 * view, place, owner, sort and card filter are kept while the screen is open.
 */
export function TimelineScreen({ navigation }: AppScreenProps<'Timeline'>) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  // Two cards a row only while every label fits (a narrow phone or a large font gets one a row).
  const { width, fontScale } = useWindowDimensions();
  const cols = statTileColumns(['Open projects', 'Late · target passed', 'At risk', 'Milestones in 30 days', 'Meetings this week'], width, fontScale);
  const focused = useIsFocused();
  const today = companyTodayKey(useMinuteNow(focused));
  const weekStart = weekStartOf(useDatePreferences().data);
  const thisWeek = weekDays(today, weekStart)[0]!;
  const [state, setState] = useState<TimelineState>(DEFAULT_TIMELINE_STATE);
  const update = (changes: Partial<TimelineState>) => setState((prev) => ({ ...prev, ...changes }));
  const anchor = state.at ?? thisWeek;
  const range = rangeFor(state.view, anchor);
  const q = useTimeline({ ...range, weekStart });
  const pull = usePullRefresh(q.refetch);

  const data = q.data;
  const ready = !!data && !q.isError;
  const all = useMemo(() => data?.projects ?? [], [data]);
  const owners = useMemo(() => ownerOptions(all), [all]);
  const owner = owners.some((o) => o.id === state.owner) ? state.owner : '';
  const byOwner = useMemo(() => filterTimeline(all, { owner, show: '' }), [all, owner]);
  const summary = timelineSummary(byOwner);
  const shown = useMemo(() => sortTimeline(filterTimeline(byOwner, { owner: '', show: state.show }), state.sort), [byOwner, state.show, state.sort]);
  // The rows' tasks are read for the weeks the server answered for.
  const from = data?.from ?? range.from;
  const to = data?.to ?? range.to;
  const rowRange = useMemo(() => ({ from, to }), [from, to]);

  // The projects whose tasks show under them.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const toggleRow = useCallback(
    (projectId: string) =>
      setExpanded((prev) => {
        const next = new Set(prev);
        if (!next.delete(projectId)) next.add(projectId);
        return next;
      }),
    [],
  );
  const toggle = (show: Exclude<TimelineShow, ''>) => update({ show: state.show === show ? '' : show });
  const cardHint = (show: Exclude<TimelineShow, ''>) => (state.show === show ? 'Show every project again' : 'Show only these projects');
  const tile = cols === 2 ? s.tileHalf : s.tileFull;

  const renderItem: ListRenderItem<TimelineProject> = useCallback(
    ({ item }) => <TimelineRow project={item} today={today} range={rowRange} open={expanded.has(item.id)} onToggle={() => toggleRow(item.id)} />,
    [today, rowRange, expanded, toggleRow],
  );

  const header = (
    <View style={s.header}>
      <View style={s.chips} accessibilityLabel="Show">
        {TIMELINE_VIEWS.map((v) => (
          <Chip key={v.value} label={v.label} selected={state.view === v.value} onPress={() => update({ view: v.value })} />
        ))}
      </View>
      <View style={s.weeks}>
        <IconButton icon="ui.back" label="Earlier" variant="outlined" onPress={() => update({ at: shiftAnchor(state.view, anchor, -1) })} />
        <Button title="Today" variant="secondary" size="sm" onPress={() => update({ at: null })} />
        <IconButton icon="ui.back" rotate={180} label="Later" variant="outlined" onPress={() => update({ at: shiftAnchor(state.view, anchor, 1) })} />
      </View>
      <InlinePicker
        label="Owner"
        options={[{ value: '', label: 'Anyone' }, ...owners.map((o) => ({ value: o.id, label: o.name }))]}
        value={owner}
        onChange={(v) => update({ owner: v })}
        placeholder="Anyone"
      />
      <Text style={s.label}>Sort</Text>
      <View style={s.chips} accessibilityLabel="Sort">
        {TIMELINE_SORTS.map((o) => (
          <Chip key={o.value} label={o.label} selected={state.sort === o.value} onPress={() => update({ sort: o.value })} a11yLabel={`Sort by ${o.label.toLowerCase()}`} />
        ))}
      </View>

      <View style={s.tiles} accessibilityLabel="Summary">
        <View style={tile}>
          <StatTile label="Open projects" value={ready ? summary.open : '–'} icon="nav.projects" tone="info" />
        </View>
        <View style={tile}>
          <StatTile
            label="Late · target passed"
            value={ready ? summary.late : '–'}
            icon="kit.clock"
            tone="danger"
            onPress={() => toggle('late')}
            selected={state.show === 'late'}
            actionLabel={cardHint('late')}
          />
        </View>
        <View style={tile}>
          <StatTile
            label="At risk"
            value={ready ? summary.atRisk : '–'}
            icon="ui.alert"
            tone="warning"
            onPress={() => toggle('at-risk')}
            selected={state.show === 'at-risk'}
            actionLabel={cardHint('at-risk')}
          />
        </View>
        <View style={tile}>
          <StatTile label="Milestones in 30 days" value={ready ? summary.milestonesSoon : '–'} icon="misc.milestone" tone="brand" />
        </View>
        <View style={tile}>
          <StatTile label="Meetings this week" value={ready ? summary.meetingsThisWeek : '–'} icon="nav.meetings" tone="info" />
        </View>
      </View>

      {/* Said aloud as the cards, owner or weeks change. */}
      <Text style={s.status} accessibilityLiveRegion="polite">
        {data && !q.isError ? `${statusLine(summary, state.show, shown.length)} · ${periodText(data.from, data.to)}` : ''}
      </Text>
    </View>
  );

  const empty = q.isLoading ? (
    <SkeletonList avatar />
  ) : q.isError || !data ? (
    <ErrorNote message="Couldn’t load the timeline." onRetry={() => void q.refetch()} retrying={q.isRefetching} />
  ) : all.length === 0 ? (
    <EmptyState
      icon="nav.timeline"
      title="No open projects"
      subtitle="Projects that are not completed or archived appear here, along their dates."
      action={{ title: 'Go to Projects', onPress: () => navigation.navigate('Tabs', { screen: 'Projects' }) }}
    />
  ) : (
    <EmptyState
      icon="nav.timeline"
      title={state.show === 'late' ? 'No late projects' : state.show === 'at-risk' ? 'No projects at risk' : 'No projects for this owner'}
      action={{ title: 'Show every project', onPress: () => update({ show: '', owner: '' }) }}
    />
  );

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <FlatList
        data={ready ? shown : []}
        keyExtractor={(p) => p.id}
        renderItem={renderItem}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ItemSeparatorComponent={Separator}
        contentContainerStyle={s.list}
        accessibilityLabel="Projects"
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
      />
    </SafeAreaView>
  );
}

function Separator() {
  return <View style={separator.gap} />;
}

const separator = StyleSheet.create({ gap: { height: spacing.sm } });

function makeStyles(c: Palette) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.ground },
    list: { padding: spacing.lg, paddingBottom: spacing.xxl },
    header: { gap: spacing.md, marginBottom: spacing.md },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    weeks: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    label: { ...typeStyle('label'), color: c.ink, marginBottom: -spacing.xs },
    tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    tileFull: { flexBasis: '100%', flexGrow: 1 },
    tileHalf: { flexBasis: '47%', flexGrow: 1 },
    status: { ...typeStyle('body'), color: c.ink2, minHeight: 20 },
  });
}
