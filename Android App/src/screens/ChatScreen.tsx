import React, { useMemo } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useProjects, useConversations, useDirectory } from '../core/queries';
import { useServices, useSession } from '../core/providers';
import { useColors } from '../core/theme';
import { Loader, ErrorNote } from '../components/ui';
import { spacing, radius, fontSize, type Palette } from '../lib/theme';
import type { TabScreenProps } from '../navigation/types';

export function ChatScreen({ navigation }: TabScreenProps<'Chat'>) {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const projectsQ = useProjects();
  const inboxQ = useConversations();
  const dirQ = useDirectory();
  const { resources } = useServices();
  const session = useSession();
  const myId = session?.user?.id;

  const nameOf = (userId: string): string => {
    const u = (dirQ.data ?? []).find((d) => d.id === userId);
    return u ? `${u.firstName} ${u.lastName}`.trim() || u.username : 'Someone';
  };
  const inbox = inboxQ.data ?? [];
  const channelUnread = (projectId: string) =>
    inbox.find((s) => s.conversation.kind === 'PROJECT' && s.conversation.projectId === projectId)?.unread ?? 0;
  const dms = inbox.filter((s) => s.conversation.kind === 'DIRECT');
  const dmTitle = (participants: { userId: string }[]) => {
    const other = participants.find((p) => p.userId !== myId)?.userId;
    return other ? nameOf(other) : 'Direct message';
  };

  async function openChannel(projectId: string, name: string) {
    const { conversation } = await resources.chat.openProjectChannel(projectId);
    void resources.chat.markRead(conversation.id).then(() => inboxQ.refetch());
    navigation.navigate('ChatThread', { conversationId: conversation.id, title: name, kind: 'PROJECT' });
  }
  function openDm(conversationId: string, title: string) {
    void resources.chat.markRead(conversationId).then(() => inboxQ.refetch());
    navigation.navigate('ChatThread', { conversationId, title, kind: 'DIRECT' });
  }

  if (projectsQ.isLoading) return <Loader />;
  const refreshing = projectsQ.isRefetching || inboxQ.isRefetching;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void projectsQ.refetch(); void inboxQ.refetch(); }} />}
      >
        {(projectsQ.isError && !projectsQ.data) || (inboxQ.isError && !inboxQ.data) ? (
          <ErrorNote message="Couldn't load your chats. Pull down to retry." />
        ) : null}

        <Text style={styles.section}>Channels</Text>
        {(projectsQ.data ?? []).map((p) => {
          const unread = channelUnread(p.id);
          return (
            <Pressable
              key={p.id}
              style={styles.row}
              onPress={() => void openChannel(p.id, p.name)}
              accessibilityRole="button"
              accessibilityLabel={`${p.name} channel${unread ? `, ${unread} unread` : ''}`}
            >
              <View style={[styles.hashTile, { backgroundColor: c.brand }]}><Text style={styles.hashText}>#</Text></View>
              <Text style={[styles.rowTitle, unread ? styles.bold : null]} numberOfLines={1}>{p.name}</Text>
              {unread ? <View style={styles.badge}><Text style={styles.badgeText}>{unread}</Text></View> : null}
            </Pressable>
          );
        })}

        <Text style={[styles.section, { marginTop: spacing.lg }]}>Direct messages</Text>
        {dms.length === 0 ? (
          <Text style={styles.empty}>No direct messages yet.</Text>
        ) : (
          dms.map((s) => {
            const title = dmTitle(s.participants);
            return (
              <Pressable
                key={s.conversation.id}
                style={styles.row}
                onPress={() => openDm(s.conversation.id, title)}
                accessibilityRole="button"
                accessibilityLabel={`${title}${s.unread ? `, ${s.unread} unread` : ''}`}
              >
                <View style={[styles.hashTile, { backgroundColor: c.brandWash }]}>
                  <Text style={[styles.hashText, { color: c.brand }]}>{title.slice(0, 1).toUpperCase()}</Text>
                </View>
                <Text style={[styles.rowTitle, s.unread ? styles.bold : null]} numberOfLines={1}>{title}</Text>
                {s.unread ? <View style={styles.badge}><Text style={styles.badgeText}>{s.unread}</Text></View> : null}
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.ground },
    scroll: { padding: spacing.lg, gap: spacing.sm },
    section: { fontSize: fontSize.xs, fontWeight: '700', color: c.ink2, textTransform: 'uppercase', letterSpacing: 0.6 },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      backgroundColor: c.surface, borderRadius: radius.md, borderWidth: 1, borderColor: c.line, padding: spacing.md,
    },
    hashTile: { width: 28, height: 28, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
    hashText: { color: c.onBrand, fontWeight: '700', fontSize: fontSize.sm },
    rowTitle: { flex: 1, fontSize: fontSize.md, color: c.ink },
    bold: { fontWeight: '700' },
    badge: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: c.brand, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
    badgeText: { color: c.onBrand, fontSize: fontSize.xs, fontWeight: '700' },
    empty: { fontSize: fontSize.sm, color: c.ink2 },
  });
