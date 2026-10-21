import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, SectionList, Pressable, StyleSheet, RefreshControl, type SectionListRenderItem } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { useActivityFeed } from '../core/activity-queries';
import { useColors } from '../core/theme';
import { Button, EmptyState, ErrorNote, Loader } from '../components/ui';
import { Chip } from '../components/task-detail/kit';
import { useMinuteNow, usePullRefresh } from '../components/meeting/live';
import {
  ACTIVITY_FILTERS,
  activityEmpty,
  activityLine,
  activityRowLabel,
  activityTone,
  activityVerb,
  actorInitials,
  filterActivity,
  groupActivity,
  type ApiActivityRow,
} from '../lib/activity-page';
import { isNetworkError } from '../lib/api-client';
import { relativeTime } from '../lib/relative-time';
import { toneStyle } from '../lib/tone';
import { spacing, radius, fontSize, type Palette } from '../lib/theme';
import type { AppScreenProps } from '../navigation/types';

type Section = { key: string; title: string; data: ApiActivityRow[] };

/**
 * Activity (5c), as the website's Activity page: who did what, across your tasks and projects —
 * the newest 50 things done in the projects you're on, by day, with the website's filters. A row
 * opens its task; the project under it opens the project's dashboard. It shows the last copy offline.
 */
export function ActivityScreen({ navigation }: AppScreenProps<'Activity'>) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  // Under a task opened from here the feed isn't fetched; back in view it is, if out of date.
  const focused = useIsFocused();
  const now = useMinuteNow(focused).getTime();
  const q = useActivityFeed({ active: focused });
  const pull = usePullRefresh(q.refetch);
  const [filter, setFilter] = useState('');

  const rows = useMemo(() => filterActivity(q.data ?? [], filter), [q.data, filter]);
  const sections: Section[] = useMemo(() => groupActivity(rows, now).map((g) => ({ key: g.key, title: g.title, data: g.items })), [rows, now]);

  const renderItem: SectionListRenderItem<ApiActivityRow, Section> = useCallback(
    ({ item: a }) => {
      const task = a.task;
      const project = a.project;
      const tone = toneStyle(c, activityTone(a.action)).fg;
      const actor = a.actor?.name ?? 'Someone';
      const line = activityLine(a, { project: false });
      return (
        <View style={s.row}>
          <View style={[s.dot, { backgroundColor: activityTone(a.action) === 'neutral' ? c.ink3 : tone }]} />
          <View style={s.card}>
            <Pressable
              onPress={task ? () => navigation.navigate('TaskDetail', { taskId: task.id, title: task.title }) : undefined}
              disabled={!task}
              accessibilityRole={task ? 'button' : undefined}
              accessibilityLabel={activityRowLabel(a, now)}
              accessibilityHint={task ? 'Opens the task' : undefined}
              style={({ pressed }) => [s.main, pressed && s.pressed]}
            >
              <View style={s.avatar}>
                <Text style={s.avatarText}>{actorInitials(actor)}</Text>
              </View>
              <View style={s.text}>
                <Text style={s.what}>
                  <Text style={s.actor}>{actor}</Text> <Text style={{ color: tone }}>{activityVerb(a.action)}</Text>{' '}
                  {task ? <Text style={s.key}>{task.key}</Text> : <Text style={s.none}>a task</Text>}
                </Text>
                {line ? <Text style={s.line}>{line}</Text> : null}
                <Text style={s.time}>{relativeTime(a.createdAt, now)}</Text>
              </View>
            </Pressable>
            {project ? (
              <Pressable
                onPress={() => navigation.navigate('ProjectDetail', { projectId: project.id, projectName: project.name })}
                accessibilityRole="button"
                accessibilityLabel={`Open the project ${project.name}`}
                hitSlop={{ top: 4, bottom: 4 }}
                style={({ pressed }) => [s.project, pressed && s.pressed]}
              >
                <Text style={s.projectText}>{project.name} ›</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      );
    },
    [c, s, now, navigation],
  );

  if (q.isLoading) return <Loader />;

  const empty = activityEmpty(filter);
  const header = (
    <View style={s.header}>
      <Text style={s.intro}>Who did what, across your tasks and projects.</Text>
      <View style={s.filters} accessibilityRole="radiogroup" accessibilityLabel="Show activity">
        {ACTIVITY_FILTERS.map((f) => (
          <Chip key={f.value || 'all'} label={f.label} selected={filter === f.value} onPress={() => setFilter(f.value)} a11yLabel={`${f.label} activity`} />
        ))}
      </View>
    </View>
  );

  const listEmpty =
    q.isError && !q.data ? (
      <ErrorNote
        message={isNetworkError(q.error) ? 'Couldn’t load activity — you appear to be offline.' : 'Couldn’t load activity.'}
        onRetry={() => void q.refetch()}
        retrying={q.isRefetching}
      />
    ) : (
      <View style={s.empty}>
        <EmptyState title={empty.title} subtitle={empty.subtitle} />
        {empty.showAll ? <Button title="Show all activity" variant="ghost" onPress={() => setFilter('')} /> : null}
      </View>
    );

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <SectionList
        sections={sections}
        keyExtractor={(a) => a.id}
        renderItem={renderItem}
        renderSectionHeader={({ section }) => (
          <Text style={s.day} accessibilityRole="header">
            {section.title}
          </Text>
        )}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={header}
        ListEmptyComponent={listEmpty}
        contentContainerStyle={s.list}
        initialNumToRender={12}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
      />
    </SafeAreaView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.ground },
    list: { padding: spacing.lg, paddingBottom: spacing.xxl },
    header: { gap: spacing.sm, marginBottom: spacing.sm },
    intro: { fontSize: fontSize.sm, color: c.ink2 },
    filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    day: { fontSize: fontSize.xs, fontWeight: '700', color: c.ink2, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: spacing.md, marginBottom: spacing.sm },
    row: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
    // The website's timeline dot, coloured by what happened (the words say it too).
    dot: { width: 10, height: 10, borderRadius: 5, marginTop: spacing.lg },
    card: { flex: 1, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: radius.md, padding: spacing.sm, gap: spacing.xs },
    main: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', minHeight: 44 },
    pressed: { opacity: 0.7 },
    avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: c.brandWash, alignItems: 'center', justifyContent: 'center' },
    avatarText: { fontSize: fontSize.xs, fontWeight: '700', color: c.brand },
    text: { flex: 1, gap: 2 },
    // Names and titles in Arabic read right to left (Android picks the direction from the text).
    what: { fontSize: fontSize.sm, color: c.ink, textAlign: 'auto' },
    actor: { fontWeight: '700', color: c.ink },
    key: { fontWeight: '700', color: c.brand },
    none: { color: c.ink2 },
    line: { fontSize: fontSize.xs, color: c.ink2, textAlign: 'auto' },
    time: { fontSize: fontSize.xs, color: c.ink2 },
    project: { alignSelf: 'flex-start', minHeight: 36, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: c.ground, marginLeft: 40 },
    projectText: { fontSize: fontSize.xs, fontWeight: '700', color: c.ink2 },
    empty: { gap: spacing.sm, alignItems: 'center' },
  });
