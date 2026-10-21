import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, Pressable, FlatList, StyleSheet, RefreshControl, type ListRenderItem } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { useMeetings, useMyActionItems } from '../core/queries';
import { useColors } from '../core/theme';
import { Badge, Loader, EmptyState, ErrorNote } from '../components/ui';
import { Chip } from '../components/task-detail/kit';
import { useMinuteNow, usePullRefresh } from '../components/meeting/live';
import { actionDueText, actionStatusLabel, actionStatusTone, isActionItemOverdue } from '../lib/meeting-detail';
import type { ApiActionItem } from '../lib/types';
import { spacing, radius, fontSize, type Palette } from '../lib/theme';
import type { AppScreenProps } from '../navigation/types';

type Scope = 'open' | 'all';

/**
 * My Action Items (2a): everything assigned to you across meetings, with due dates and where each
 * stands — what's still to do, or all of it. An item opens its meeting, and its task when it has one.
 * An item tracked as a task is completed when its task is done; it refreshes after a task moves.
 */
export function MyActionItemsScreen({ navigation }: AppScreenProps<'MyActionItems'>) {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  // Under an opened meeting or task, the list isn't fetched; back in view, it is if it went out of date.
  const focused = useIsFocused();
  const now = useMinuteNow(focused);
  const [scope, setScope] = useState<Scope>('open');
  const itemsQ = useMyActionItems(scope, { active: focused });
  // The meetings' titles, from the Meetings list (one request, shared with the Meetings tab).
  const meetingsQ = useMeetings('all', { active: focused });
  const { refetch } = itemsQ;
  const pull = usePullRefresh(refetch);
  const titles = useMemo(() => new Map((meetingsQ.data ?? []).map((m) => [m.id, m.title])), [meetingsQ.data]);
  const items = useMemo(() => itemsQ.data ?? [], [itemsQ.data]);
  const overdue = items.filter((i) => isActionItemOverdue(i, now)).length;

  const renderItem: ListRenderItem<ApiActionItem> = useCallback(
    ({ item }) => {
      const done = item.status === 'COMPLETED' || item.status === 'CANCELLED';
      const late = isActionItemOverdue(item, now);
      const due = actionDueText(item, now);
      const meetingTitle = item.meetingId ? titles.get(item.meetingId) ?? 'the meeting' : null;
      const meetingId = item.meetingId;
      const taskId = item.taskId;
      return (
        <View style={styles.card}>
          <Pressable
            onPress={meetingId ? () => navigation.navigate('MeetingDetail', { meetingId, title: titles.get(meetingId) }) : undefined}
            disabled={!meetingId}
            accessibilityRole={meetingId ? 'button' : undefined}
            accessibilityLabel={[item.description, actionStatusLabel(item.status), due, meetingTitle ? `from ${meetingTitle}` : null].filter(Boolean).join(', ')}
            accessibilityHint={meetingId ? 'Opens the meeting' : undefined}
            style={({ pressed }) => [styles.main, pressed && styles.pressed]}
          >
            <Text style={[styles.title, done && styles.done]}>{item.description}</Text>
            <View style={styles.meta}>
              <Badge label={actionStatusLabel(item.status)} tone={actionStatusTone(item.status)} />
              <Text style={[styles.sub, late && styles.overdue]}>{due}</Text>
              {meetingTitle ? <Text style={styles.sub} numberOfLines={1}>↗ {meetingTitle}</Text> : null}
            </View>
          </Pressable>
          {taskId ? (
            <Pressable
              onPress={() => navigation.navigate('TaskDetail', { taskId })}
              accessibilityRole="button"
              accessibilityLabel={`Open the linked task${item.taskKey ? `, ${item.taskKey}` : ''}`}
              style={({ pressed }) => [styles.taskChip, pressed && styles.pressed]}
            >
              <Text style={styles.taskChipText}>✓ {item.taskKey ?? 'Task'} ›</Text>
            </Pressable>
          ) : null}
        </View>
      );
    },
    [styles, now, titles, navigation],
  );

  const header = (
    <View style={styles.header}>
      <Text style={styles.intro}>Everything assigned to you across meetings — with due dates and status in one place.</Text>
      <View style={styles.scope} accessibilityRole="radiogroup" accessibilityLabel="Which action items">
        <Chip label="Open" selected={scope === 'open'} onPress={() => setScope('open')} a11yLabel="Open action items" />
        <Chip label="All" selected={scope === 'all'} onPress={() => setScope('all')} a11yLabel="All action items" />
      </View>
      {overdue > 0 ? (
        <Text style={styles.overdueNote} accessibilityLiveRegion="polite">
          {overdue} action item{overdue === 1 ? '' : 's'} overdue.
        </Text>
      ) : null}
      {items.some((i) => i.taskId) ? <Text style={styles.hint}>An item with a task is completed when its task is done.</Text> : null}
    </View>
  );

  const empty = itemsQ.isLoading ? (
    <Loader />
  ) : itemsQ.isError && !itemsQ.data ? (
    <ErrorNote message="Couldn’t load your action items." onRetry={() => void itemsQ.refetch()} retrying={itemsQ.isFetching} />
  ) : (
    <EmptyState title="Nothing on your plate" subtitle={scope === 'open' ? 'You have no open action items. Nice.' : 'No action items are assigned to you.'} />
  );

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        renderItem={renderItem}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        contentContainerStyle={styles.list}
        initialNumToRender={12}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
      />
    </SafeAreaView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.ground },
    list: { padding: spacing.lg, gap: spacing.sm },
    header: { gap: spacing.sm, marginBottom: spacing.xs },
    intro: { fontSize: fontSize.sm, color: c.ink2 },
    scope: { flexDirection: 'row', gap: spacing.sm },
    overdueNote: { fontSize: fontSize.sm, fontWeight: '700', color: c.danger, backgroundColor: c.dangerSoft, borderRadius: radius.md, padding: spacing.sm },
    hint: { fontSize: fontSize.xs, color: c.ink3 },
    card: { backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: c.line, padding: spacing.md, gap: spacing.sm },
    main: { gap: spacing.xs },
    pressed: { opacity: 0.7 },
    // Arabic descriptions read right to left (Android picks the direction from the text).
    title: { fontSize: fontSize.md, fontWeight: '600', color: c.ink, textAlign: 'auto' },
    done: { textDecorationLine: 'line-through', color: c.ink3 },
    meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
    sub: { fontSize: fontSize.xs, color: c.ink3, flexShrink: 1 },
    overdue: { color: c.danger, fontWeight: '700' },
    taskChip: { alignSelf: 'flex-start', minHeight: 36, justifyContent: 'center', backgroundColor: c.successSoft, borderRadius: radius.pill, paddingHorizontal: spacing.md },
    taskChipText: { fontSize: fontSize.xs, fontWeight: '700', color: c.success },
  });
