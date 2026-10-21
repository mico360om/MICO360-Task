import React, { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, RefreshControl, TextInput, type AccessibilityActionEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useProjects, useConversations, useDirectory } from '../core/queries';
import { useSession } from '../core/providers';
import { useOpenProjectChat } from '../core/chat';
import { useConversationPrefs, usePresence, useStartDirect } from '../core/chat-features';
import { useColors } from '../core/theme';
import { Loader, ErrorNote } from '../components/ui';
import { ChatSearchResults, NewMessageSheet, PrefsSheet } from '../components/chat/ChatSheets';
import { inboxSections, previewOf, type InboxRow } from '../lib/chat-model';
import { listTime } from '../lib/chat-ui';
import { CHAT_SEARCH_MIN } from '../core/queries';
import { spacing, radius, fontSize, type Palette } from '../lib/theme';
import type { ApiChatMessage, ConversationPrefs } from '../lib/types';
import type { TabScreenProps } from '../navigation/types';

type SectionKey = 'favorites' | 'channels' | 'directs' | 'archived';
const SECTION_TITLE: Record<SectionKey, string> = { favorites: 'Favorites', channels: 'Project channels', directs: 'Direct messages', archived: 'Archived' };

/**
 * The conversations (3b), as the website lists them: a search (names, and "Search messages"), then
 * favorites, every project channel, direct messages — most recent first, each with its last message,
 * when it came, who is online, Muted and its unread number — and the archive apart (closed at first).
 * A long press (or TalkBack's "More options") offers favorite, mute and archive; "New message"
 * starts a direct conversation.
 */
export function ChatScreen({ navigation }: TabScreenProps<'Chat'>) {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const projectsQ = useProjects();
  const inboxQ = useConversations();
  const dirQ = useDirectory();
  const session = useSession();
  const myId = session?.user?.id ?? '';
  const online = usePresence();
  const [query, setQuery] = useState('');
  const [messageSearch, setMessageSearch] = useState(false);
  const [open, setOpen] = useState<Record<SectionKey, boolean>>({ favorites: true, channels: true, directs: true, archived: false });
  const [dmOpen, setDmOpen] = useState(false);
  const [menuFor, setMenuFor] = useState<InboxRow | null>(null);

  const goToThread = useCallback(
    (conversationId: string, title: string, jumpTo?: string) => navigation.navigate('ChatThread', { conversationId, title, ...(jumpTo ? { jumpTo } : {}) }),
    [navigation],
  );
  // A channel the list knows opens at once (offline too); the thread marks it read as it opens.
  const channel = useOpenProjectChat(goToThread);
  const direct = useStartDirect((id, name) => {
    setDmOpen(false);
    goToThread(id, name);
  });
  const prefs = useConversationPrefs();

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable onPress={() => setDmOpen(true)} accessibilityRole="button" accessibilityLabel="New direct message" hitSlop={8} style={styles.headerBtn}>
          <Text style={styles.headerBtnText}>＋</Text>
        </Pressable>
      ),
    });
  }, [navigation, styles]);

  const people = useMemo(() => new Map((dirQ.data ?? []).map((u) => [u.id, u])), [dirQ.data]);
  const fullName = useCallback(
    (userId: string): string => {
      const u = people.get(userId);
      return u ? `${u.firstName} ${u.lastName}`.trim() || u.username : userId === myId ? 'You' : 'Someone';
    },
    [people, myId],
  );
  const inbox = useMemo(() => inboxQ.data ?? [], [inboxQ.data]);
  const projects = useMemo(() => projectsQ.data ?? [], [projectsQ.data]);
  const sections = useMemo(() => inboxSections({ inbox, projects, myId, nameOf: fullName, query }), [inbox, projects, myId, fullName, query]);
  const titleOf = useCallback(
    (conversationId: string) => {
      const s = inbox.find((x) => x.conversation.id === conversationId);
      if (!s) return 'Conversation';
      if (s.conversation.kind === 'PROJECT') return projects.find((p) => p.id === s.conversation.projectId)?.name ?? 'Project channel';
      const other = s.participants.find((p) => p.userId !== myId)?.userId;
      return other ? fullName(other) : 'Direct message';
    },
    [inbox, projects, myId, fullName],
  );

  const openRow = (row: InboxRow) => {
    if (row.kind === 'PROJECT' && row.projectId) void channel.open(row.projectId, row.title);
    else if (row.conversationId) goToThread(row.conversationId, row.title);
  };
  // The same function for every render, so the memoized rows stay as they are.
  const openRowRef = useRef(openRow);
  openRowRef.current = openRow;
  const onOpenRow = useCallback((r: InboxRow) => openRowRef.current(r), []);
  const openResult = (m: ApiChatMessage) => goToThread(m.conversationId, titleOf(m.conversationId), m.id);
  const changePrefs = (row: InboxRow, patch: Partial<ConversationPrefs>) =>
    void prefs.change({ conversationId: row.conversationId, kind: row.kind, projectId: row.projectId }, patch).then((ok) => {
      if (ok) setMenuFor(null);
    });

  if (projectsQ.isLoading && !projectsQ.data) return <Loader />;
  const refreshing = projectsQ.isRefetching || inboxQ.isRefetching;
  const searching = query.trim().length > 0;
  const nothingFound = searching && !messageSearch && sections.favorites.length + sections.channels.length + sections.directs.length + sections.archived.length === 0;

  // One row per conversation, memoized (3b review): a presence change redraws only the rows whose
  // person came or went, not the whole list.
  const rowFor = (r: InboxRow) => (
    <ConversationRow
      key={r.key}
      r={r}
      isOnline={r.kind === 'DIRECT' && !!r.partnerId && online.has(r.partnerId)}
      myId={myId}
      nameOf={fullName}
      opening={channel.opening}
      onOpen={onOpenRow}
      onMenu={setMenuFor}
      styles={styles}
      c={c}
    />
  );

  const section = (key: SectionKey, rows: InboxRow[], empty?: React.ReactNode) => {
    if (key === 'favorites' && rows.length === 0) return null;
    if (key === 'archived' && rows.length === 0) return null;
    if (searching && rows.length === 0) return null;
    const isOpen = searching || open[key];
    const unread = key === 'archived' ? sections.archivedUnread : rows.reduce((n, r) => n + r.unread, 0);
    return (
      <View key={key} style={styles.section}>
        <Pressable
          style={styles.sectionHead}
          onPress={() => setOpen((o) => ({ ...o, [key]: !o[key] }))}
          accessibilityRole="button"
          accessibilityState={{ expanded: isOpen }}
          accessibilityLabel={`${SECTION_TITLE[key]}, ${rows.length}${unread ? `, ${unread} unread` : ''}`}
        >
          <Text style={styles.chevron}>{isOpen ? '▾' : '▸'}</Text>
          <Text style={styles.sectionTitle}>{SECTION_TITLE[key].toUpperCase()}</Text>
          {unread ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{unread}</Text>
            </View>
          ) : (
            <Text style={styles.sectionCount}>{rows.length}</Text>
          )}
        </Pressable>
        {isOpen ? (rows.length ? rows.map(rowFor) : empty ?? null) : null}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={[]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              void projectsQ.refetch();
              void inboxQ.refetch();
            }}
          />
        }
      >
        <TextInput
          style={styles.search}
          value={query}
          onChangeText={(q) => {
            setQuery(q);
            if (q.trim().length < CHAT_SEARCH_MIN) setMessageSearch(false);
          }}
          placeholder="Search conversations"
          placeholderTextColor={c.ink3}
          accessibilityLabel="Search conversations"
          autoCorrect={false}
          // The server searches up to 200 characters.
          maxLength={200}
          returnKeyType="search"
          onSubmitEditing={() => query.trim().length >= CHAT_SEARCH_MIN && setMessageSearch(true)}
        />
        {(projectsQ.isError && !projectsQ.data) || (inboxQ.isError && !inboxQ.data) ? (
          <ErrorNote
            message="Couldn't load your chats."
            onRetry={() => {
              void projectsQ.refetch();
              void inboxQ.refetch();
            }}
            retrying={refreshing}
          />
        ) : null}
        {channel.error ? <ErrorNote message={channel.error} /> : null}

        {messageSearch ? (
          <View>
            <Pressable style={styles.back} onPress={() => setMessageSearch(false)} accessibilityRole="button">
              <Text style={styles.backText}>‹ Back to conversations</Text>
            </Pressable>
            <ChatSearchResults q={query} titleOf={titleOf} nameOf={fullName} onPick={openResult} />
          </View>
        ) : (
          <>
            {searching && query.trim().length >= CHAT_SEARCH_MIN ? (
              <Pressable style={styles.searchMessages} onPress={() => setMessageSearch(true)} accessibilityRole="button">
                <Text style={styles.searchMessagesText} numberOfLines={1}>
                  🔍 Search messages for “{query.trim()}”
                </Text>
              </Pressable>
            ) : null}
            {nothingFound ? <Text style={styles.empty}>No conversations match “{query.trim()}”.</Text> : null}
            {section('favorites', sections.favorites)}
            {section('channels', sections.channels, <Text style={styles.empty}>No project channels yet.</Text>)}
            {section(
              'directs',
              sections.directs,
              <Pressable onPress={() => setDmOpen(true)} accessibilityRole="button" style={styles.emptyRow}>
                <Text style={styles.empty}>
                  No direct messages yet. <Text style={styles.link}>Start one</Text>
                </Text>
              </Pressable>,
            )}
            {section('archived', sections.archived)}
          </>
        )}
      </ScrollView>

      <NewMessageSheet
        visible={dmOpen}
        directory={dirQ.data ?? []}
        myId={myId}
        opening={direct.opening}
        error={direct.error}
        onPick={(id, name) => void direct.open(id, name)}
        onClose={() => {
          setDmOpen(false);
          direct.clearError();
        }}
      />
      <PrefsSheet
        visible={menuFor !== null}
        title={menuFor ? `Options for ${menuFor.title}` : ''}
        prefs={menuFor ? inbox.find((s) => s.conversation.id === menuFor.conversationId)?.prefs ?? menuFor.prefs : { favorite: false, archived: false, muted: false }}
        busy={prefs.busy}
        error={prefs.error}
        onChange={(patch) => menuFor && changePrefs(menuFor, patch)}
        onClose={() => {
          setMenuFor(null);
          prefs.clearError();
        }}
      />
    </SafeAreaView>
  );
}

/**
 * One conversation in the list. Memoized (3b review): it is drawn again only when its own row,
 * whether its person is online, the names or the channel being opened change.
 */
const ConversationRow = memo(function ConversationRow({
  r,
  isOnline,
  myId,
  nameOf,
  opening,
  onOpen,
  onMenu,
  styles,
  c,
}: {
  r: InboxRow;
  isOnline: boolean;
  myId: string;
  nameOf: (userId: string) => string;
  opening: string | null;
  onOpen: (r: InboxRow) => void;
  onMenu: (r: InboxRow) => void;
  styles: ReturnType<typeof makeStyles>;
  c: Palette;
}) {
  const preview = previewOf(r.lastMessage, { myId, kind: r.kind, nameOf });
  const label = [
    r.kind === 'PROJECT' ? `${r.title} channel` : r.title,
    isOnline ? 'online' : null,
    r.prefs.favorite ? 'favorite' : null,
    r.prefs.muted ? 'muted' : null,
    r.unread ? `${r.unread} unread` : null,
    preview || null,
    r.lastMessage ? listTime(r.lastMessage.createdAt) : null,
  ]
    .filter(Boolean)
    .join(', ');
  const onAction = (e: AccessibilityActionEvent) => {
    if (e.nativeEvent.actionName === 'longpress') onMenu(r);
    else onOpen(r);
  };
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.8 }]}
      onPress={() => onOpen(r)}
      onLongPress={() => onMenu(r)}
      disabled={opening !== null}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Long press for favorite, mute and archive."
      accessibilityActions={[{ name: 'activate' }, { name: 'longpress', label: 'More options' }]}
      onAccessibilityAction={onAction}
      accessibilityState={{ busy: opening === r.projectId, disabled: opening !== null }}
    >
      {r.kind === 'PROJECT' ? (
        <View style={[styles.tile, { backgroundColor: c.brand }]}>
          <Text style={styles.tileText}>#</Text>
        </View>
      ) : (
        <View style={[styles.tile, styles.round, { backgroundColor: c.brandWash }]}>
          <Text style={[styles.tileText, { color: c.brand }]}>{r.title.slice(0, 1).toUpperCase()}</Text>
          <View style={[styles.dot, { backgroundColor: isOnline ? c.success : c.ink3, borderColor: c.surface }]} />
        </View>
      )}
      <View style={styles.grow}>
        <View style={styles.line}>
          <Text style={[styles.rowTitle, r.unread ? styles.bold : null]} numberOfLines={1}>
            {r.prefs.favorite ? '★ ' : ''}
            {r.title}
          </Text>
          {r.lastMessage ? <Text style={[styles.time, r.unread ? { color: c.brand, fontWeight: '700' } : null]}>{listTime(r.lastMessage.createdAt)}</Text> : null}
        </View>
        <View style={styles.line}>
          <Text style={[styles.preview, r.unread ? { color: c.ink } : null]} numberOfLines={1}>
            {preview || (r.kind === 'PROJECT' && !r.conversationId ? 'Project channel' : 'No messages yet')}
          </Text>
          {/* Muted: said, and its count in grey — it isn't in the Chat tab's number (as on the website). */}
          {r.prefs.muted ? <Text style={styles.muted}>🔕 Muted</Text> : null}
          {r.unread ? (
            <View style={[styles.badge, r.prefs.muted && styles.badgeMuted]}>
              <Text style={[styles.badgeText, r.prefs.muted && styles.badgeTextMuted]}>{r.unread > 99 ? '99+' : r.unread}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
});

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.ground },
    scroll: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.xxl },
    headerBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', marginRight: spacing.sm },
    headerBtnText: { color: c.onBrand, fontSize: fontSize.xl, fontWeight: '700' },
    search: {
      minHeight: 44,
      borderWidth: 1,
      borderColor: c.line,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      backgroundColor: c.surface,
      color: c.ink,
      fontSize: fontSize.md,
    },
    searchMessages: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.sm, borderRadius: radius.md, backgroundColor: c.brandWash },
    searchMessagesText: { color: c.brand, fontWeight: '600', fontSize: fontSize.sm },
    back: { minHeight: 44, justifyContent: 'center' },
    backText: { color: c.brand, fontWeight: '700', fontSize: fontSize.sm },
    section: { gap: spacing.xs, marginTop: spacing.sm },
    sectionHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 36 },
    chevron: { color: c.ink2, fontSize: fontSize.sm, width: 14 },
    sectionTitle: { flex: 1, fontSize: fontSize.xs, fontWeight: '700', color: c.ink2, letterSpacing: 0.6 },
    sectionCount: { fontSize: fontSize.xs, color: c.ink3, fontWeight: '600' },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: c.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.line,
      padding: spacing.md,
      minHeight: 56,
    },
    tile: { width: 36, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
    round: { borderRadius: 18 },
    tileText: { color: c.onBrand, fontWeight: '700', fontSize: fontSize.sm },
    dot: { position: 'absolute', right: -1, bottom: -1, width: 12, height: 12, borderRadius: 6, borderWidth: 2 },
    grow: { flex: 1, gap: 2 },
    line: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    rowTitle: { flex: 1, fontSize: fontSize.md, color: c.ink },
    bold: { fontWeight: '700' },
    time: { fontSize: fontSize.xs, color: c.ink2 },
    preview: { flex: 1, fontSize: fontSize.xs, color: c.ink2 },
    badge: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: c.brand, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
    badgeText: { color: c.onBrand, fontSize: fontSize.xs, fontWeight: '700' },
    badgeMuted: { backgroundColor: c.line },
    badgeTextMuted: { color: c.ink },
    muted: { fontSize: fontSize.xs, color: c.ink2 },
    empty: { fontSize: fontSize.sm, color: c.ink2 },
    emptyRow: { minHeight: 44, justifyContent: 'center' },
    link: { color: c.brand, fontWeight: '700' },
  });
