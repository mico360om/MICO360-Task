import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  ScrollView,
  TextInput,
  Pressable,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  type ListRenderItem,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { useConversationMembers, useConversationMessages, useConversations, useDirectory, useProjects } from '../core/queries';
import { useSession } from '../core/providers';
import { useColors } from '../core/theme';
import { useChatOutbox, useOnline, useReadWhileOpen } from '../core/chat';
import { Loader, ErrorNote, NoticeNote } from '../components/ui';
import { MentionSuggestions, MentionText, useMentionInput } from '../components/Mentions';
import type { MentionPerson } from '../lib/mentions';
import { chatMemberIds, conversationTitle, mentionPeopleFor, threadLoadError } from '../lib/chat';
import { CHAT_MAX_LENGTH, connectionNote, outboxLabel, type OutboxEntry } from '../lib/chat-outbox';
import { threadItems, threadMessages, type ThreadItem } from '../lib/chat-thread';
import { afterNewest, isFarFromNewest, isNearNewest, newMessagesLabel } from '../lib/chat-scroll';
import { spacing, radius, fontSize, type Palette } from '../lib/theme';
import type { ApiChatMessage, ApiDirectoryUser } from '../lib/types';
import type { AppScreenProps } from '../navigation/types';

function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

type Styles = ReturnType<typeof makeStyles>;

/** One message the server has. Memoized: a new message doesn't redraw the whole thread. */
const MessageRow = memo(function MessageRow({
  m,
  author,
  people,
  styles,
}: {
  m: ApiChatMessage;
  author: string;
  people: MentionPerson[];
  styles: Styles;
}) {
  const time = clockTime(m.createdAt);
  const edited = !!m.editedAt && !m.deletedAt;
  const said = m.deletedAt ? 'This message was deleted.' : m.body;
  return (
    <View style={styles.msg}>
      <View accessible accessibilityLabel={`${author}, ${time}${edited ? ', edited' : ''}: ${said}`}>
        <View style={styles.msgHead}>
          <Text style={styles.author}>{author}</Text>
          <Text style={styles.time}>{time}</Text>
          {edited ? <Text style={styles.edited}>(edited)</Text> : null}
        </View>
        {m.deletedAt ? <Text style={styles.deleted}>{said}</Text> : <MentionText style={styles.body} body={m.body} people={people} />}
      </View>
      {!m.deletedAt && (m.attachments ?? []).length > 0 ? (
        <View style={styles.attachments}>
          {(m.attachments ?? []).map((a) => (
            <View key={a.id} style={styles.attachChip}>
              <Text style={styles.attachText}>📎 {a.fileName}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {!m.deletedAt && (m.reactions ?? []).length > 0 ? (
        <View style={styles.reactions}>
          {(m.reactions ?? []).map((r) => (
            <View key={r.emoji} style={styles.chip}>
              <Text style={styles.chipText}>
                {r.emoji} {r.userIds.length}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
});

/** One of my messages still on this phone: Sending… / Waiting for connection / Not sent — Retry, Discard. */
const OutboxRow = memo(function OutboxRow({
  entry,
  people,
  styles,
  onRetry,
  onDiscard,
}: {
  entry: OutboxEntry;
  people: MentionPerson[];
  styles: Styles;
  onRetry: (queueId: string) => void;
  onDiscard: (queueId: string) => void;
}) {
  const failed = entry.state === 'failed';
  const snippet = entry.body.length > 40 ? `${entry.body.slice(0, 40)}…` : entry.body;
  return (
    <View style={[styles.msg, failed ? styles.failedMsg : styles.pendingMsg]}>
      <View accessible accessibilityLabel={outboxLabel(entry)}>
        <View style={styles.msgHead}>
          <Text style={styles.author}>You</Text>
          <Text style={[styles.time, failed && styles.notSent]} accessibilityLiveRegion="polite">
            {entry.state === 'sending'
              ? 'Sending…'
              : entry.state === 'waiting'
                ? 'Waiting for connection'
                : entry.state === 'unanswered'
                  ? 'Not answered yet — trying again'
                  : `Not sent — ${entry.reason ?? ''}`}
          </Text>
        </View>
        <MentionText style={styles.body} body={entry.body} people={people} />
      </View>
      {!failed && entry.canDiscard ? (
        // Stuck waiting: it can be discarded, as in the sync list (it may still arrive if the server got it).
        <View style={styles.outboxActions}>
          <Pressable style={styles.outboxBtn} onPress={() => onDiscard(entry.queueId)} accessibilityRole="button" accessibilityLabel={`Discard “${snippet}”`}>
            <Text style={styles.discardText}>Discard</Text>
          </Pressable>
        </View>
      ) : null}
      {failed ? (
        <View style={styles.outboxActions}>
          <Pressable
            style={styles.outboxBtn}
            onPress={() => onRetry(entry.queueId)}
            accessibilityRole="button"
            accessibilityLabel={`Retry sending “${snippet}”`}
          >
            <Text style={styles.outboxBtnText}>Retry</Text>
          </Pressable>
          <Pressable
            style={styles.outboxBtn}
            onPress={() => onDiscard(entry.queueId)}
            accessibilityRole="button"
            accessibilityLabel={`Discard “${snippet}”`}
          >
            <Text style={styles.discardText}>Discard</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
});

/**
 * One conversation (3a). An inverted list: the newest message at the bottom, older pages loading as
 * you scroll up (what you are reading stays put). New messages are followed only when you are at the
 * newest; otherwise a pill counts them. Every message is kept on the phone until the server has it
 * and shows where it stands (chat-outbox). The conversation is read while it is open.
 */
export function ChatThreadScreen({ route, navigation }: AppScreenProps<'ChatThread'>) {
  const { conversationId, title: titleHint } = route.params;
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const focused = useIsFocused();
  const online = useOnline();
  const messagesQ = useConversationMessages(conversationId);
  const inboxQ = useConversations();
  const projectsQ = useProjects();
  const dirQ = useDirectory();
  const session = useSession();
  const myId = session?.user?.id ?? '';
  const [draft, setDraft] = useState('');
  const [sendErr, setSendErr] = useState<string | null>(null);

  const people = useMemo(() => new Map<string, ApiDirectoryUser>((dirQ.data ?? []).map((u) => [u.id, u])), [dirQ.data]);
  const nameOf = useCallback(
    (userId: string): string => {
      if (userId === myId) return 'You';
      const u = people.get(userId);
      return u ? `${u.firstName} ${u.lastName}`.trim() || u.username : 'Someone';
    },
    [people, myId],
  );
  // Everyone's @names are marked in messages; only the conversation's members can be mentioned
  // (the server tells only them): a direct conversation's two people, a channel's project people.
  const mentionPeople = useMemo<MentionPerson[]>(
    () => (dirQ.data ?? []).map((u) => ({ id: u.id, username: u.username, name: `${u.firstName} ${u.lastName}`.trim() })),
    [dirQ.data],
  );
  const summary = useMemo(() => (inboxQ.data ?? []).find((s) => s.conversation.id === conversationId), [inboxQ.data, conversationId]);
  const membersQ = useConversationMembers(conversationId, summary?.conversation.kind !== 'DIRECT');
  const memberIds = useMemo(() => chatMemberIds({ summary, members: membersQ.data }), [summary, membersQ.data]);
  const canMention = useMemo(() => mentionPeopleFor(memberIds, dirQ.data ?? [], myId), [memberIds, dirQ.data, myId]);
  const draftMention = useMentionInput(draft, setDraft, canMention);

  const title = conversationTitle({ summary, projects: projectsQ.data ?? [], nameOf, myId, fallback: titleHint });
  useLayoutEffect(() => {
    navigation.setOptions({ title });
  }, [navigation, title]);

  const loaded = useMemo(() => threadMessages(messagesQ.data), [messagesQ.data]);
  const confirmed = useMemo(() => new Set(loaded.map((m) => m.clientId).filter((id): id is string => !!id)), [loaded]);
  const outbox = useChatOutbox(conversationId, confirmed);
  const items = useMemo(() => threadItems(messagesQ.data, outbox.entries, myId), [messagesQ.data, outbox.entries, myId]);
  const newestId = items[0]?.key;

  useReadWhileOpen({ conversationId, unread: summary?.unread ?? 0, newestId: loaded[0]?.id, focused });

  // ── Scrolling: follow the newest only when at the newest, else count on a pill ──
  const listRef = useRef<FlatList<ThreadItem>>(null);
  const nearNewest = useRef(true);
  const prevNewest = useRef<string | undefined>(undefined);
  const [unseen, setUnseen] = useState(0);
  const [far, setFar] = useState(false);
  const toNewest = useCallback(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
    nearNewest.current = true;
    setUnseen(0);
    setFar(false);
  }, []);
  useEffect(() => {
    const step = afterNewest({ prevNewestId: prevNewest.current, items: items.map((i) => ({ id: i.key, userId: i.userId })), nearNewest: nearNewest.current, myId });
    prevNewest.current = newestId;
    if (step.follow) {
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
      setUnseen(0);
    } else if (step.unseen > 0) {
      setUnseen((n) => n + step.unseen);
    }
    // Only a change of the newest row runs this.
  }, [newestId]);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    nearNewest.current = isNearNewest(y);
    if (nearNewest.current) setUnseen((n) => (n === 0 ? n : 0));
    const isFar = isFarFromNewest(y);
    setFar((f) => (f === isFar ? f : isFar));
  }, []);

  const loadOlder = useCallback(() => {
    if (messagesQ.hasNextPage && !messagesQ.isFetchingNextPage) void messagesQ.fetchNextPage();
  }, [messagesQ]);
  const onEndReached = useCallback(() => {
    // Scrolled up to the oldest loaded: the page before it (not again after it failed — tap Retry).
    if (!messagesQ.isFetchNextPageError) loadOlder();
  }, [messagesQ.isFetchNextPageError, loadOlder]);

  // A message still waiting (not refused) may yet reach the server: discarding it asks first.
  const entriesRef = useRef(outbox.entries);
  entriesRef.current = outbox.entries;
  const discardEntry = useCallback(
    (queueId: string) => {
      const entry = entriesRef.current.find((e) => e.queueId === queueId);
      if (!entry || entry.state === 'failed') return outbox.discard(queueId);
      Alert.alert('Discard this message?', 'It won’t be sent from this phone. If the server got it already, it may still appear.', [
        { text: 'Keep', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => outbox.discard(queueId) },
      ]);
    },
    [outbox.discard],
  );

  const renderItem = useCallback<ListRenderItem<ThreadItem>>(
    ({ item }) =>
      item.kind === 'outbox' ? (
        <OutboxRow entry={item.entry} people={mentionPeople} styles={styles} onRetry={outbox.retry} onDiscard={discardEntry} />
      ) : (
        <MessageRow m={item.message} author={nameOf(item.message.userId)} people={mentionPeople} styles={styles} />
      ),
    [mentionPeople, styles, outbox.retry, discardEntry, nameOf],
  );

  async function send() {
    if (!draft.trim()) return;
    setSendErr(null);
    const text = draft;
    // The message is kept on the phone and shown in the thread at once; the box is free again.
    setDraft('');
    const result = await outbox.send(text).catch(() => ({ ok: false as const, error: 'Your message wasn’t sent. Please try again.' }));
    if (!result.ok) {
      setDraft(text);
      setSendErr(result.error);
    }
  }

  if (messagesQ.isLoading) return <Loader />;

  const remaining = CHAT_MAX_LENGTH - draft.length;
  const note = connectionNote({ online, waiting: outbox.waiting });
  const loadFailed = messagesQ.isError && !messagesQ.data;

  // At the top of the inverted list: older history, or its beginning.
  const olderHeader = messagesQ.isFetchingNextPage ? (
    <View style={styles.older} accessibilityLiveRegion="polite">
      <ActivityIndicator color={c.brand} />
      <Text style={styles.olderText}>Loading older messages…</Text>
    </View>
  ) : messagesQ.isFetchNextPageError ? (
    <View style={styles.older}>
      <Text style={styles.olderError} accessibilityRole="alert">
        Couldn’t load older messages.
      </Text>
      <Pressable style={styles.olderBtn} onPress={loadOlder} accessibilityRole="button" accessibilityLabel="Retry loading older messages">
        <Text style={styles.olderBtnText}>Retry</Text>
      </Pressable>
    </View>
  ) : messagesQ.hasNextPage ? (
    <View style={styles.older}>
      <Pressable style={styles.olderBtn} onPress={loadOlder} accessibilityRole="button">
        <Text style={styles.olderBtnText}>Load older messages</Text>
      </Pressable>
    </View>
  ) : items.length > 0 ? (
    <Text style={styles.beginning}>This is the beginning of the conversation.</Text>
  ) : null;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {note ? (
          <View style={styles.noteWrap}>
            <NoticeNote message={note} />
          </View>
        ) : null}
        {loadFailed ? (
          // A failed load is not "No messages yet" (MOB-08); messages waiting to be sent still show.
          <View style={styles.noteWrap}>
            <ErrorNote
              message={threadLoadError(messagesQ.error)}
              onRetry={() => void messagesQ.refetch()}
              retrying={messagesQ.isRefetching}
            />
          </View>
        ) : null}
        {items.length === 0 ? (
          <View style={styles.flex}>{loadFailed ? null : <Text style={styles.empty}>No messages yet. Say hello 👋</Text>}</View>
        ) : (
          <View style={styles.flex}>
            <FlatList
              ref={listRef}
              inverted
              data={items}
              keyExtractor={(i) => i.key}
              renderItem={renderItem}
              contentContainerStyle={styles.scroll}
              onScroll={onScroll}
              scrollEventThrottle={32}
              onEndReached={onEndReached}
              onEndReachedThreshold={0.3}
              ListFooterComponent={olderHeader}
              keyboardShouldPersistTaps="handled"
              initialNumToRender={20}
              maxToRenderPerBatch={20}
              windowSize={11}
            />
            {unseen > 0 ? (
              <Pressable
                style={styles.pill}
                onPress={toNewest}
                accessibilityRole="button"
                accessibilityLabel={`${newMessagesLabel(unseen)}. Show the newest messages.`}
                accessibilityLiveRegion="polite"
              >
                <Text style={styles.pillText}>↓ {newMessagesLabel(unseen)}</Text>
              </Pressable>
            ) : far ? (
              <Pressable style={styles.jump} onPress={toNewest} accessibilityRole="button" accessibilityLabel="Jump to latest" hitSlop={8}>
                <Text style={styles.jumpText}>↓</Text>
              </Pressable>
            ) : null}
          </View>
        )}

        {sendErr ? (
          <View style={styles.errWrap}>
            <ErrorNote message={sendErr} />
          </View>
        ) : null}
        {/* Kept short, so the box and Send stay above the keyboard on a small phone. */}
        {draftMention.menu.kind !== 'closed' ? (
          <ScrollView style={styles.mentionWrap} contentContainerStyle={styles.mentionInner} keyboardShouldPersistTaps="handled">
            <MentionSuggestions menu={draftMention.menu} onPick={draftMention.pick} />
          </ScrollView>
        ) : null}
        <View style={styles.composer}>
          <View style={styles.inputWrap}>
            <TextInput
              ref={draftMention.inputRef}
              onSelectionChange={draftMention.onSelectionChange}
              style={styles.input}
              value={draft}
              onChangeText={(v) => {
                setDraft(v);
                if (sendErr) setSendErr(null);
              }}
              placeholder="Message…  (@ to mention)"
              placeholderTextColor={c.ink3}
              accessibilityLabel={`Message ${title}`}
              accessibilityHint="Type @ to mention someone in this conversation."
              maxLength={CHAT_MAX_LENGTH}
              multiline
            />
            {remaining <= 200 ? (
              <Text style={[styles.counter, remaining <= 0 && styles.counterMax]} accessibilityLiveRegion="polite">
                {remaining} characters left
              </Text>
            ) : null}
          </View>
          <Pressable
            style={[styles.sendBtn, !draft.trim() && styles.sendBtnDisabled]}
            onPress={() => void send()}
            disabled={!draft.trim()}
            accessibilityRole="button"
            accessibilityLabel="Send message"
            accessibilityHint={online ? undefined : 'You’re offline. It will be sent when you’re back online.'}
            accessibilityState={{ disabled: !draft.trim() }}
          >
            <Text style={styles.sendText}>Send</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.ground },
    flex: { flex: 1 },
    scroll: { padding: spacing.lg, gap: spacing.md },
    noteWrap: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
    empty: { textAlign: 'center', color: c.ink2, marginTop: spacing.xl, fontSize: fontSize.sm },
    msg: { gap: 2 },
    pendingMsg: { opacity: 0.7 },
    failedMsg: { borderLeftWidth: 3, borderLeftColor: c.danger, paddingLeft: spacing.sm },
    msgHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
    author: { fontSize: fontSize.sm, fontWeight: '700', color: c.ink },
    time: { fontSize: fontSize.xs, color: c.ink3 },
    notSent: { color: c.danger, fontWeight: '700', flexShrink: 1 },
    edited: { fontSize: fontSize.xs, color: c.ink3 },
    body: { fontSize: fontSize.md, color: c.ink },
    deleted: { fontSize: fontSize.md, fontStyle: 'italic', color: c.ink3 },
    attachments: { flexDirection: 'row', gap: spacing.xs, marginTop: 4, flexWrap: 'wrap' },
    attachChip: { borderWidth: 1, borderColor: c.line, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: c.surface },
    attachText: { fontSize: fontSize.xs, color: c.ink },
    reactions: { flexDirection: 'row', gap: spacing.xs, marginTop: 4, flexWrap: 'wrap' },
    chip: { borderWidth: 1, borderColor: c.line, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
    chipText: { fontSize: fontSize.xs, color: c.ink2 },
    outboxActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
    outboxBtn: {
      minHeight: 44, minWidth: 64, justifyContent: 'center', alignItems: 'center',
      borderWidth: 1, borderColor: c.line, borderRadius: radius.md, paddingHorizontal: spacing.md, backgroundColor: c.surface,
    },
    outboxBtnText: { color: c.brand, fontWeight: '700', fontSize: fontSize.sm },
    discardText: { color: c.ink2, fontWeight: '600', fontSize: fontSize.sm },
    older: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.sm },
    olderText: { fontSize: fontSize.xs, color: c.ink2 },
    olderError: { fontSize: fontSize.xs, color: c.danger },
    olderBtn: {
      minHeight: 44, justifyContent: 'center', borderWidth: 1, borderColor: c.line, borderRadius: radius.md,
      paddingHorizontal: spacing.md, backgroundColor: c.surface,
    },
    olderBtnText: { color: c.brand, fontWeight: '700', fontSize: fontSize.sm },
    beginning: { textAlign: 'center', fontSize: fontSize.xs, color: c.ink2, paddingVertical: spacing.sm },
    pill: {
      position: 'absolute', bottom: spacing.md, alignSelf: 'center', minHeight: 44, justifyContent: 'center',
      backgroundColor: c.brand, borderRadius: radius.pill, paddingHorizontal: spacing.lg,
    },
    pillText: { color: c.onBrand, fontWeight: '700', fontSize: fontSize.sm },
    jump: {
      position: 'absolute', bottom: spacing.md, right: spacing.lg, width: 44, height: 44, borderRadius: 22,
      alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface, borderWidth: 1, borderColor: c.line,
    },
    jumpText: { color: c.ink2, fontSize: fontSize.lg, fontWeight: '700' },
    errWrap: { paddingHorizontal: spacing.md },
    mentionWrap: { flexGrow: 0, flexShrink: 1, maxHeight: 200, paddingHorizontal: spacing.md },
    mentionInner: { paddingBottom: spacing.xs },
    composer: {
      flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm,
      padding: spacing.md, borderTopWidth: 1, borderTopColor: c.line, backgroundColor: c.surface,
    },
    inputWrap: { flex: 1 },
    input: {
      maxHeight: 120, minHeight: 44,
      borderWidth: 1, borderColor: c.line, borderRadius: radius.md,
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: c.ink, fontSize: fontSize.md,
    },
    counter: { fontSize: fontSize.xs, color: c.ink3, marginTop: 2 },
    counterMax: { color: c.danger, fontWeight: '700' },
    sendBtn: { backgroundColor: c.brand, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, minHeight: 44, justifyContent: 'center' },
    sendBtnDisabled: { opacity: 0.5 },
    sendText: { color: c.onBrand, fontWeight: '700', fontSize: fontSize.sm },
  });
