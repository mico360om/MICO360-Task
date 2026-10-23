import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, RefreshControl, AccessibilityInfo, type ListRenderItem } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { owned, useNotifications, useMarkNotificationRead } from '../core/queries';
import { notificationToTarget } from '../lib/deep-link';
import { targetToAction } from '../navigation/nav-actions';
import { applyNavAction } from '../navigation/apply-action';
import { useServices } from '../core/providers';
import { useColors } from '../core/theme';
import { Loader, EmptyState, ErrorNote, Button } from '../components/ui';
import { useMinuteNow, usePullRefresh } from '../components/meeting/live';
import { dismissNotificationsAbout } from '../adapters/push';
import { ALERTS_REFRESH, allReadUpTo, markAllProblem, newestShown } from '../lib/alerts';
import { relativeTime } from '../lib/relative-time';
import { refresh } from '../lib/refresh';
import { spacing, radius, fontSize, type Palette } from '../lib/theme';
import type { ApiNotification } from '../lib/types';
import type { TabScreenProps } from '../navigation/types';

/** Does tapping this alert open something besides the alert list? */
function hasTarget(n: ApiNotification): boolean {
  return notificationToTarget({ entityType: n.entityType, entityId: n.entityId }).screen !== 'Notifications';
}

/**
 * Alerts (5c), as the website's Notifications page: mentions, assignments and updates, newest
 * first. Tapping one reads it and opens what it is about — the task, the project's dashboard, the
 * meeting or the chat — and takes the phone's notifications about it off its list. "Mark all read"
 * needs a connection; reading one without a connection is kept and sent later. The list shows the
 * last copy offline. The tab's number is the unread count (lib/alerts has the badge rule).
 */
export function NotificationsScreen({ navigation }: TabScreenProps<'Notifications'>) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const focused = useIsFocused();
  const now = useMinuteNow(focused).getTime();
  const q = useNotifications();
  const { mutate: markRead } = useMarkNotificationRead();
  const services = useServices();
  const qc = useQueryClient();
  const pull = usePullRefresh(q.refetch);
  const [markingAll, setMarkingAll] = useState(false);
  const [markAllErr, setMarkAllErr] = useState<string | null>(null);

  const list = useMemo(() => q.data ?? [], [q.data]);
  const unread = list.filter((n) => !n.readAt).length;

  // Coming to the Alerts tab shows what the tab's number counts: an out-of-date list is asked for again (5c review #11).
  useEffect(
    () => navigation.addListener('focus', () => void qc.refetchQueries({ queryKey: ['notifications'], exact: true, stale: true }, { cancelRefetch: false })),
    [navigation, qc],
  );

  const markAll = () => {
    setMarkingAll(true);
    setMarkAllErr(null);
    // Only what this list shows is read: one that came in meanwhile stays unread (5c review #9).
    const upTo = newestShown(list);
    // Sent as the person who tapped it (lib/owned-write); what it shows is theirs only.
    const w = owned(services);
    void w
      .run((r) => r.notifications.markAllRead(upTo))
      .then(() => {
        if (services.currentUserId() !== w.owner) return;
        const after = allReadUpTo(qc.getQueryData<ApiNotification[]>(['notifications']), new Date().toISOString(), upTo);
        qc.setQueryData<ApiNotification[]>(['notifications'], after);
        qc.setQueryData<{ count: number }>(['notifications', 'unread'], { count: (after ?? []).filter((x) => !x.readAt).length });
        refresh(qc, ALERTS_REFRESH);
        AccessibilityInfo.announceForAccessibility('All alerts marked as read.');
      })
      .catch((e: unknown) => setMarkAllErr(markAllProblem(e)))
      .finally(() => setMarkingAll(false));
  };

  /**
   * Tapping an alert reads it and opens what it is about (WEB-18) — exactly as its push would: one
   * mapping for both (final review B5). An alert about nothing it can open stays on this list.
   */
  const open = useCallback(
    (n: ApiNotification) => {
      if (!n.readAt) markRead(n);
      // The phone's own notifications about it come off its list (one helper: adapters/push).
      if (n.entityType && n.entityId) void dismissNotificationsAbout(n.entityType.trim().toLowerCase(), n.entityId);
      applyNavAction(targetToAction(notificationToTarget({ entityType: n.entityType, entityId: n.entityId })));
    },
    [markRead],
  );

  const renderItem: ListRenderItem<ApiNotification> = useCallback(
    ({ item: n }) => {
      const when = relativeTime(n.createdAt, now);
      return (
        <Pressable
          onPress={() => open(n)}
          accessibilityRole="button"
          accessibilityLabel={[n.readAt ? null : 'Unread', n.title, n.body, when].filter(Boolean).join('. ')}
          accessibilityHint={hasTarget(n) ? 'Opens the related item' : undefined}
          style={({ pressed }) => [s.item, !n.readAt && s.unread, pressed && s.pressed]}
        >
          {!n.readAt ? <View style={s.dot} /> : <View style={s.dotSpacer} />}
          <View style={s.body}>
            <Text style={[s.title, !n.readAt && s.titleUnread]}>{n.title}</Text>
            {n.body ? <Text style={s.desc}>{n.body}</Text> : null}
            {when ? <Text style={s.time}>{when}</Text> : null}
          </View>
        </Pressable>
      );
    },
    [s, now, open],
  );

  if (q.isLoading) return <Loader />;

  const header = (
    <View style={s.header}>
      <Text style={s.intro}>Mentions, assignments and updates across your work.</Text>
      {unread > 0 ? (
        <Button
          title="Mark all read"
          variant="secondary"
          loading={markingAll}
          onPress={markAll}
          accessibilityLabel={`Mark all read, ${unread} unread`}
        />
      ) : null}
      {markAllErr ? <ErrorNote message={markAllErr} /> : null}
    </View>
  );

  const empty =
    q.isError && !q.data ? (
      <ErrorNote message="Couldn’t load notifications." onRetry={() => void q.refetch()} retrying={q.isRefetching} />
    ) : (
      <EmptyState title="You’re all caught up" subtitle="Mentions, assignments and task updates will appear here." />
    );

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <FlatList
        data={list}
        keyExtractor={(n) => n.id}
        renderItem={renderItem}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
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
    list: { padding: spacing.lg, gap: spacing.sm },
    header: { gap: spacing.sm, marginBottom: spacing.xs },
    intro: { fontSize: fontSize.sm, color: c.ink2 },
    item: {
      flexDirection: 'row',
      gap: spacing.sm,
      backgroundColor: c.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.line,
      padding: spacing.md,
      minHeight: 48,
    },
    // Unread: the website's brand edge, and a dot (the colour alone isn't the only sign).
    unread: { borderColor: c.brand, borderLeftWidth: 4, backgroundColor: c.brandWash },
    pressed: { opacity: 0.7 },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.brand, marginTop: 6 },
    dotSpacer: { width: 8 },
    body: { flex: 1, gap: 2 },
    // Arabic titles read right to left (Android picks the direction from the text).
    title: { fontSize: fontSize.md, color: c.ink2, textAlign: 'auto' },
    titleUnread: { fontWeight: '600', color: c.ink },
    desc: { fontSize: fontSize.sm, color: c.ink2, textAlign: 'auto' },
    time: { fontSize: fontSize.xs, color: c.ink2, marginTop: 2 },
  });
