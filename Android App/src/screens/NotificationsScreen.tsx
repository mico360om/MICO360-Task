import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNotifications, useMarkNotificationRead } from '../core/queries';
import { useServices } from '../core/providers';
import { useColors } from '../core/theme';
import { Loader, EmptyState, ErrorNote, Button } from '../components/ui';
import { spacing, radius, fontSize, type Palette } from '../lib/theme';
import type { ApiNotification } from '../lib/types';
import type { TabScreenProps } from '../navigation/types';

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function NotificationsScreen(_props: TabScreenProps<'Notifications'>) {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { data: items, isLoading, isError, refetch, isRefetching } = useNotifications();
  const markRead = useMarkNotificationRead();
  const { resources } = useServices();
  const [markingAll, setMarkingAll] = useState(false);

  if (isLoading) return <Loader />;

  const list = items ?? [];
  const hasUnread = list.some((n) => !n.readAt);
  const markAll = () => {
    setMarkingAll(true);
    void resources.notifications
      .markAllRead()
      .then(() => refetch())
      .finally(() => setMarkingAll(false));
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
      >
        {hasUnread ? (
          <Button title="Mark all as read" variant="secondary" loading={markingAll} onPress={markAll} />
        ) : null}

        {isError && !items ? (
          <ErrorNote message="Couldn't load your notifications. Pull down to retry." />
        ) : list.length === 0 ? (
          <EmptyState title="You're all caught up" subtitle="New notifications will show up here." />
        ) : (
          list.map((n: ApiNotification) => (
            <Pressable
              key={n.id}
              onPress={() => !n.readAt && markRead.mutate(n.id)}
              accessibilityRole="button"
              accessibilityLabel={`${n.readAt ? '' : 'Unread. '}${n.title}${n.body ? '. ' + n.body : ''}, ${timeAgo(n.createdAt)}`}
              style={[styles.item, !n.readAt && styles.unread]}
            >
              {!n.readAt ? <View style={styles.dot} /> : <View style={styles.dotSpacer} />}
              <View style={styles.body}>
                <Text style={styles.title}>{n.title}</Text>
                {n.body ? <Text style={styles.desc}>{n.body}</Text> : null}
                <Text style={styles.time}>{timeAgo(n.createdAt)}</Text>
              </View>
            </Pressable>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.ground },
    scroll: { padding: spacing.lg, gap: spacing.sm },
    item: {
      flexDirection: 'row',
      gap: spacing.sm,
      backgroundColor: c.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.line,
      padding: spacing.md,
    },
    unread: { borderColor: c.brand, backgroundColor: c.brandWash },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.brand, marginTop: 6 },
    dotSpacer: { width: 8 },
    body: { flex: 1 },
    title: { fontSize: fontSize.md, fontWeight: '600', color: c.ink },
    desc: { fontSize: fontSize.sm, color: c.ink2, marginTop: 2 },
    time: { fontSize: fontSize.xs, color: c.ink3, marginTop: 4 },
  });
