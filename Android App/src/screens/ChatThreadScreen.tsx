import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  ToastAndroid,
  type ListRenderItem,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import { useConversationMembers, useConversationMessages, useConversations, useDirectory, useProjects } from '../core/queries';
import { useMyQueuedChanges, useServices, useSession } from '../core/providers';
import { useColors } from '../core/theme';
import { useChatOutbox, useOnline, useReadWhileOpen } from '../core/chat';
import { useChatDraft, useChatMessageActions, useChatUploads, useConversationPrefs, usePresence, useStartDirect } from '../core/chat-features';
import { Loader, ErrorNote, NoticeNote } from '../components/ui';
import { MentionSuggestions, useMentionInput } from '../components/Mentions';
import { ActionRowButton } from '../components/meeting/sheet-kit';
import { MembersSheet, PrefsSheet, ThreadSearchSheet } from '../components/chat/ChatSheets';
import { DayLine, EditMessageSheet, ImageViewer, MessageActionsSheet, MessageBubble, UnreadLine, type BubbleHandlers } from '../components/chat/MessageParts';
import { copyText } from '../adapters/clipboard';
import type { MentionPerson } from '../lib/mentions';
import { isNetworkError, ApiError } from '../lib/api-client';
import { chatMemberIds, conversationTitle, mentionPeopleFor, threadLoadError, threadRefusal } from '../lib/chat';
import { deleteDialog, editProblem, messageActions, replyQuoteOf } from '../lib/chat-actions';
import { NO_PREFS, receiptState } from '../lib/chat-model';
import { CHAT_MAX_LENGTH, connectionNote } from '../lib/chat-outbox';
import { newestPageOnly, threadMessages, type ThreadPages } from '../lib/chat-thread';
import { rowIndexOf, threadRows, unreadAfterOf, type ThreadMessage, type ThreadRow } from '../lib/chat-timeline';
import { conversationSubtitle, memberRows, pickedFile, receiptText } from '../lib/chat-ui';
import { threadKey } from '../lib/chat-cache';
import { isSafeId } from '../lib/ids';
import { keptOnPhoneText } from '../lib/write-order';
import { afterNewest, isFarFromNewest, isNearNewest, KEEP_READING_POSITION, newMessagesLabel } from '../lib/chat-scroll';
import { spacing, radius, fontSize, type Palette } from '../lib/theme';
import type { ApiChatAttachment, ApiDirectoryUser, ConversationPrefs, ReactionGroup, ReplyQuote } from '../lib/types';
import type { AppScreenProps } from '../navigation/types';

/** Older pages a jump to a message (a search result, a reply's quote) may load before giving up. */
const MAX_JUMP_PAGES = 10;
/** How long a message jumped to stays marked. */
const HIGHLIGHT_MS = 2500;

/** A short notice at the bottom of the screen (Android), e.g. "Copied". */
function notice(text: string) {
  if (Platform.OS === 'android') ToastAndroid.show(text, ToastAndroid.SHORT);
  else Alert.alert(text);
}

/** Why a message action didn't happen: kept on the phone (it says so), or the server's reason. */
function actionFailure(e: unknown, fallback: string): string {
  if (isNetworkError(e)) return keptOnPhoneText(e);
  if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.message && !/^Request failed/.test(e.message)) return `${fallback} ${e.message}`;
  return fallback;
}

/**
 * One conversation (3a, 3b). An inverted list: the newest message at the bottom, older pages loading
 * as you scroll up; a line for each day and where the unread messages start. New messages are
 * followed only when you are at the newest; otherwise a pill counts them. Every message is kept on
 * the phone until the server has it (chat-outbox). The website's features: replies (tap a quote to
 * show the message), edit and delete your own, copy, reactions, pictures and files, receipts and who
 * is online, mute / favorite / archive, search, members, and the unsent message kept per
 * conversation. The conversation is read while it is open.
 */
export function ChatThreadScreen({ route, navigation }: AppScreenProps<'ChatThread'>) {
  const { conversationId: asked, title: titleHint, jumpTo } = route.params;
  // An id that isn't an id (a link) is never asked for (3a review): the screen says it can't be opened.
  const conversationId = isSafeId(asked) ? asked : '';
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const isFocused = useIsFocused();
  const online = useOnline();
  const qc = useQueryClient();
  const { baseUrl } = useServices();
  const messagesQ = useConversationMessages(conversationId);
  // Refused (removed from the project) or gone: no message box, as on the website (3a review).
  const refusal = threadRefusal(messagesQ.isError && !messagesQ.data ? messagesQ.error : null, asked);
  const focused = isFocused && !refusal;
  const inboxQ = useConversations();
  const projectsQ = useProjects();
  const dirQ = useDirectory();
  const session = useSession();
  const myId = session?.user?.id ?? '';
  const isAdmin = (session?.user?.roles ?? []).includes('ADMIN');
  const presence = usePresence();
  const queued = useMyQueuedChanges();
  const [draft, setDraft] = useChatDraft(conversationId);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [reply, setReply] = useState<ReplyQuote | null>(null);
  const inputRef = useRef<TextInput | null>(null);

  const people = useMemo(() => new Map<string, ApiDirectoryUser>((dirQ.data ?? []).map((u) => [u.id, u])), [dirQ.data]);
  const fullName = useCallback(
    (userId: string): string => {
      const u = people.get(userId);
      return u ? `${u.firstName} ${u.lastName}`.trim() || u.username : userId === myId ? 'You' : 'Someone';
    },
    [people, myId],
  );
  /** As shown on messages: "You" for your own. */
  const nameOf = useCallback((userId: string): string => (userId === myId ? 'You' : fullName(userId)), [fullName, myId]);
  // Everyone's @names are marked in messages; only the conversation's members can be mentioned
  // (the server tells only them): a direct conversation's two people, a channel's project people.
  const mentionPeople = useMemo<MentionPerson[]>(
    () => (dirQ.data ?? []).map((u) => ({ id: u.id, username: u.username, name: `${u.firstName} ${u.lastName}`.trim() })),
    [dirQ.data],
  );
  const summary = useMemo(() => (inboxQ.data ?? []).find((s) => s.conversation.id === conversationId), [inboxQ.data, conversationId]);
  const kind = summary?.conversation.kind ?? 'PROJECT';
  const membersQ = useConversationMembers(conversationId, summary?.conversation.kind !== 'DIRECT');
  const memberIds = useMemo(() => chatMemberIds({ summary, members: membersQ.data }), [summary, membersQ.data]);
  const canMention = useMemo(() => mentionPeopleFor(memberIds, dirQ.data ?? [], myId), [memberIds, dirQ.data, myId]);
  const draftMention = useMentionInput(draft, setDraft, canMention);
  const isOnline = useCallback((id: string) => presence.has(id), [presence]);
  const members = useMemo(() => memberRows(memberIds ?? [], dirQ.data ?? [], myId, isOnline), [memberIds, dirQ.data, myId, isOnline]);
  const partnerId = kind === 'DIRECT' ? summary?.participants.find((p) => p.userId !== myId)?.userId : undefined;
  const prefs: ConversationPrefs = summary?.prefs ?? NO_PREFS;

  const title = conversationTitle({ summary, projects: projectsQ.data ?? [], nameOf: fullName, myId, fallback: titleHint });
  const subtitle = summary
    ? `${conversationSubtitle({ kind, partner: partnerId ? people.get(partnerId) : null, online: !!partnerId && presence.has(partnerId), members })}${prefs.muted ? ' · Muted' : ''}`
    : '';
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  useLayoutEffect(() => {
    navigation.setOptions({
      title,
      headerTitle: () => (
        <View accessible accessibilityRole="header" accessibilityLabel={`${title}${subtitle ? `, ${subtitle}` : ''}`} style={styles.headerTitle}>
          <Text style={styles.headerName} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.headerSub} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      ),
      headerRight: refusal
        ? undefined
        : () => (
            <Pressable onPress={() => setMenuOpen(true)} accessibilityRole="button" accessibilityLabel="Conversation options: search, members, mute, favorite, archive" hitSlop={8} style={styles.headerBtn}>
              <Text style={styles.headerBtnText}>⋯</Text>
            </Pressable>
          ),
    });
  }, [navigation, title, subtitle, refusal, styles]);

  // Where the "unread" line goes: taken once, as the thread opens (reading it doesn't move it).
  const [unreadAfter, setUnreadAfter] = useState<string | null>(null);
  const unreadTaken = useRef(false);
  useEffect(() => {
    if (unreadTaken.current || !summary) return;
    unreadTaken.current = true;
    setUnreadAfter(unreadAfterOf(summary, myId));
  }, [summary, myId]);

  const loaded = useMemo(() => threadMessages(messagesQ.data), [messagesQ.data]);
  const confirmed = useMemo(() => new Set(loaded.map((m) => m.clientId).filter((id): id is string => !!id)), [loaded]);
  const outbox = useChatOutbox(conversationId, confirmed);
  const uploads = useChatUploads(conversationId);
  const msgActions = useChatMessageActions(conversationId);
  const rows = useMemo(
    () => threadRows({ data: messagesQ.data, outbox: outbox.entries, uploads: uploads.uploads, pending: queued.pending, myId, unreadAfter }),
    [messagesQ.data, outbox.entries, uploads.uploads, queued.pending, myId, unreadAfter],
  );
  const messageRows = useMemo(() => rows.filter((r): r is Extract<ThreadRow, { type: 'message' }> => r.type === 'message'), [rows]);
  const newestId = messageRows[0]?.message.id;

  useReadWhileOpen({ conversationId, unread: summary?.unread ?? 0, newestId: loaded[0]?.id, focused });

  // Left (another screen on top, or closed): only the newest page is kept, so a refetch doesn't
  // read every page scrolled back through (3a review).
  useEffect(() => {
    if (isFocused || !conversationId) return;
    qc.setQueryData<ThreadPages>(threadKey(conversationId), (d) => newestPageOnly(d));
  }, [isFocused, conversationId, qc]);
  useEffect(
    () => () => {
      if (conversationId) qc.setQueryData<ThreadPages>(threadKey(conversationId), (d) => newestPageOnly(d));
    },
    [conversationId, qc],
  );

  // ── Scrolling: follow the newest only when at the newest, else count on a pill ──
  const listRef = useRef<FlatList<ThreadRow>>(null);
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
    const step = afterNewest({ prevNewestId: prevNewest.current, items: messageRows.map((r) => ({ id: r.message.id, userId: r.message.userId })), nearNewest: nearNewest.current, myId });
    prevNewest.current = newestId;
    if (step.follow) {
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
      setUnseen(0);
    } else if (step.unseen > 0) {
      setUnseen((n) => n + step.unseen);
    }
    // Only a change of the newest message runs this.
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

  // ── Jumping to a message (a search result, a reply's quote): older pages load to find it ──
  const [jump, setJump] = useState<string | null>(jumpTo && isSafeId(jumpTo) ? jumpTo : null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const jumpPages = useRef(0);
  useEffect(() => {
    jumpPages.current = 0;
  }, [jump]);
  useEffect(() => {
    if (!jump || messagesQ.isLoading || messagesQ.isFetchingNextPage) return;
    const at = rowIndexOf(rows, jump);
    if (at >= 0) {
      listRef.current?.scrollToIndex({ index: at, viewPosition: 0.5, animated: true });
      setHighlight(jump);
      setJump(null);
      return;
    }
    if (messagesQ.hasNextPage && jumpPages.current < MAX_JUMP_PAGES) {
      jumpPages.current += 1;
      void messagesQ.fetchNextPage();
      return;
    }
    setJump(null);
    notice('That message isn’t in this conversation any more.');
  }, [jump, rows, messagesQ]);
  useEffect(() => {
    if (!highlight) return;
    const t = setTimeout(() => setHighlight(null), HIGHLIGHT_MS);
    return () => clearTimeout(t);
  }, [highlight]);
  const onScrollToIndexFailed = useCallback((info: { index: number; averageItemLength: number }) => {
    // Not measured yet: go near it, then try again.
    listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
    setTimeout(() => listRef.current?.scrollToIndex({ index: info.index, viewPosition: 0.5, animated: true }), 150);
  }, []);

  // ── Message actions ──
  const [acting, setActing] = useState<ThreadMessage | null>(null);
  const [editing, setEditing] = useState<ThreadMessage | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<ApiChatAttachment | null>(null);
  const prefsM = useConversationPrefs();
  const direct = useStartDirect((id, name) => {
    setMembersOpen(false);
    navigation.push('ChatThread', { conversationId: id, title: name });
  });

  const entriesRef = useRef(outbox.entries);
  entriesRef.current = outbox.entries;
  const react = useCallback(
    (m: ThreadMessage, emoji: string) => {
      setActing(null);
      msgActions.react(m, emoji).catch((e: unknown) => notice(actionFailure(e, 'Couldn’t update the reaction.')));
    },
    [msgActions],
  );
  const startReply = useCallback((m: ThreadMessage) => {
    setReply(replyQuoteOf(m));
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);
  const doAction = useCallback(
    (m: ThreadMessage, action: 'react' | 'reply' | 'copy' | 'edit' | 'delete') => {
      setActing(null);
      if (action === 'react') return setActing(m);
      if (action === 'reply') return startReply(m);
      if (action === 'copy') return notice(copyText(m.body) ? 'Copied' : 'Couldn’t copy the message.');
      if (action === 'edit') {
        setEditError(null);
        return setEditing(m);
      }
      const d = deleteDialog(m, myId, fullName);
      Alert.alert(d.title, d.message, [
        { text: d.keep, style: 'cancel' },
        {
          text: d.confirm,
          style: 'destructive',
          onPress: () =>
            msgActions.remove(m.id).catch((e: unknown) => {
              if (isNetworkError(e)) notice(keptOnPhoneText(e));
              else Alert.alert('Couldn’t delete the message', actionFailure(e, 'Please try again.'));
            }),
        },
      ]);
    },
    [startReply, myId, fullName, msgActions],
  );
  const saveEdit = async (body: string) => {
    if (!editing) return;
    const problem = editProblem(body);
    if (problem) return setEditError(problem);
    setEditBusy(true);
    setEditError(null);
    try {
      await msgActions.edit(editing.id, body);
      setEditing(null);
    } catch (e) {
      // Kept on the phone: it is sent later (and shown meanwhile). Refused: the editor stays open.
      if (isNetworkError(e)) {
        setEditing(null);
        notice(keptOnPhoneText(e));
      } else setEditError(actionFailure(e, 'Your edit wasn’t saved — it’s still open so you can try again.'));
    } finally {
      setEditBusy(false);
    }
  };
  const discardEntry = useCallback(
    (queueId: string) => {
      const entry = entriesRef.current.find((e) => e.queueId === queueId);
      if (!entry || entry.state === 'failed') return outbox.discard(queueId);
      Alert.alert('Discard this message?', 'It won’t be sent from this phone. If the server got it already, it may still appear.', [
        { text: 'Keep', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => outbox.discard(queueId) },
      ]);
    },
    [outbox],
  );
  const whoReacted = useCallback(
    (r: ReactionGroup) => {
      const who = r.userIds.map((id) => (id === myId ? 'You' : fullName(id)));
      Alert.alert(`${r.emoji} ${r.userIds.length}`, who.join('\n'));
    },
    [myId, fullName],
  );

  const handlersRef = useRef<BubbleHandlers | null>(null);
  handlersRef.current = {
    onActions: (m) => setActing(m),
    onAction: doAction,
    onReact: react,
    onWhoReacted: whoReacted,
    onJump: (id) => setJump(id),
    onOpenImage: (a) => setViewing(a),
    onRetry: outbox.retry,
    onDiscard: discardEntry,
    onEditUnsent: (queueId, body) => {
      outbox.discard(queueId);
      setDraft(body);
      setTimeout(() => inputRef.current?.focus(), 50);
    },
    onRetryUpload: uploads.retry,
    onDiscardUpload: uploads.discard,
  };
  // One object for every row, so typing doesn't redraw the thread.
  const handlers = useMemo<BubbleHandlers>(
    () => ({
      onActions: (m) => handlersRef.current!.onActions(m),
      onAction: (m, a) => handlersRef.current!.onAction(m, a),
      onReact: (m, e) => handlersRef.current!.onReact(m, e),
      onWhoReacted: (r) => handlersRef.current!.onWhoReacted(r),
      onJump: (id) => handlersRef.current!.onJump(id),
      onOpenImage: (a) => handlersRef.current!.onOpenImage(a),
      onRetry: (id) => handlersRef.current!.onRetry(id),
      onDiscard: (id) => handlersRef.current!.onDiscard(id),
      onEditUnsent: (id, body) => handlersRef.current!.onEditUnsent(id, body),
      onRetryUpload: (k) => handlersRef.current!.onRetryUpload(k),
      onDiscardUpload: (k) => handlersRef.current!.onDiscardUpload(k),
    }),
    [],
  );

  const participants = summary?.participants ?? [];
  const renderItem = useCallback<ListRenderItem<ThreadRow>>(
    ({ item }) => {
      if (item.type === 'day') return <DayLine label={item.label} />;
      if (item.type === 'unread') return <UnreadLine />;
      const m = item.message;
      const mine = m.userId === myId;
      const receipt = mine && !m.deletedAt && !m.pending ? receiptText(receiptState(m, { myId, kind, participants, isOnline })) : undefined;
      return (
        <MessageBubble
          m={m}
          mine={mine}
          groupStart={item.groupStart}
          authorName={nameOf(m.userId)}
          people={mentionPeople}
          myId={myId}
          isAdmin={isAdmin}
          nameOf={nameOf}
          receiptLabel={receipt?.label}
          receiptTicks={receipt?.ticks}
          highlighted={highlight === m.id}
          baseUrl={baseUrl}
          handlers={handlers}
        />
      );
    },
    [myId, kind, participants, isOnline, nameOf, mentionPeople, isAdmin, highlight, baseUrl, handlers],
  );

  async function send() {
    if (!draft.trim()) return;
    setSendErr(null);
    const text = draft;
    const answering = reply;
    // The message is kept on the phone and shown in the thread at once; the box is free again.
    setDraft('');
    setReply(null);
    const result = await outbox.send(text, answering).catch(() => ({ ok: false as const, error: 'Your message wasn’t sent. Please try again.' }));
    if (!result.ok) {
      setDraft(text);
      setReply(answering);
      setSendErr(result.error);
    }
  }

  /** Pick pictures or files and send them (the first with the typed words). Needs a connection. */
  async function attach() {
    setSendErr(null);
    if (!online) return setSendErr('You’re offline — files can be sent when you’re connected.');
    if (draft.trim().length > CHAT_MAX_LENGTH) return setSendErr(`Captions can be up to ${CHAT_MAX_LENGTH.toLocaleString()} characters.`);
    let picked: DocumentPicker.DocumentPickerResult;
    try {
      picked = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: true, copyToCacheDirectory: true });
    } catch {
      return setSendErr('Couldn’t open the file picker.');
    }
    if (picked.canceled) return;
    const files = (picked.assets ?? []).map((a) => pickedFile({ uri: a.uri, name: a.name, size: a.size, mimeType: a.mimeType }));
    const result = uploads.send(files, draft, reply);
    if (result.sent > 0) {
      setDraft('');
      setReply(null);
    }
    if (result.problems.length) setSendErr(result.problems.join(' '));
  }

  const changePrefs = (patch: Partial<ConversationPrefs>) =>
    void prefsM.change({ conversationId: conversationId || null, kind, projectId: summary?.conversation.projectId ?? undefined }, patch).then((ok) => {
      if (ok) setMenuOpen(false);
    });

  if (messagesQ.isLoading) return <Loader />;

  // Can't be opened at all: what the website says, and no message box (3a review).
  if (refusal) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.refused}>
          <Text style={styles.refusedTitle} accessibilityRole="header">
            {refusal.title}
          </Text>
          <Text style={styles.refusedText} accessibilityRole="alert">
            {refusal.message}
          </Text>
          <Pressable style={styles.olderBtn} onPress={() => navigation.goBack()} accessibilityRole="button">
            <Text style={styles.olderBtnText}>Back to conversations</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

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
  ) : rows.length > 0 && !loadFailed ? (
    <Text style={styles.beginning}>This is the beginning of the conversation.</Text>
  ) : null;

  const actingActions = acting ? messageActions(acting, { myId, isAdmin }) : null;

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
            <ErrorNote message={threadLoadError(messagesQ.error)} onRetry={() => void messagesQ.refetch()} retrying={messagesQ.isRefetching} />
          </View>
        ) : null}
        {rows.length === 0 ? (
          <View style={[styles.flex, styles.emptyWrap]}>
            {loadFailed ? null : (
              <>
                <Text style={styles.emptyWave}>👋</Text>
                <Text style={styles.emptyTitle}>No messages yet</Text>
                <Text style={styles.empty}>Say hello to get the conversation started.</Text>
              </>
            )}
          </View>
        ) : (
          <View style={styles.flex}>
            <FlatList
              ref={listRef}
              inverted
              // Scrolled up reading, a new message doesn't move the text (3a review; check on a device).
              maintainVisibleContentPosition={KEEP_READING_POSITION}
              data={rows}
              keyExtractor={(r) => r.key}
              renderItem={renderItem}
              contentContainerStyle={styles.scroll}
              onScroll={onScroll}
              scrollEventThrottle={32}
              onEndReached={onEndReached}
              onEndReachedThreshold={0.3}
              onScrollToIndexFailed={onScrollToIndexFailed}
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
        {reply ? (
          <View style={styles.replyBar}>
            <View style={styles.grow} accessible accessibilityLabel={`Replying to ${nameOf(reply.userId)}: ${reply.body || 'A file'}`}>
              <Text style={styles.replyWho} numberOfLines={1}>
                Replying to {nameOf(reply.userId)}
              </Text>
              <Text style={styles.replyText} numberOfLines={1}>
                {reply.body.replace(/\s+/g, ' ') || 'A file'}
              </Text>
            </View>
            <Pressable style={styles.replyClose} onPress={() => setReply(null)} accessibilityRole="button" accessibilityLabel="Cancel reply" hitSlop={6}>
              <Text style={styles.replyCloseText}>✕</Text>
            </Pressable>
          </View>
        ) : null}
        <View style={styles.composer}>
          <Pressable
            style={styles.attachBtn}
            onPress={() => void attach()}
            accessibilityRole="button"
            accessibilityLabel="Attach pictures or files"
            accessibilityHint={online ? 'Up to 10 MB each.' : 'You’re offline — files can be sent when you’re connected.'}
          >
            <Text style={styles.attachText}>📎</Text>
          </Pressable>
          <View style={styles.inputWrap}>
            <TextInput
              ref={(r) => {
                inputRef.current = r;
                (draftMention.inputRef as React.MutableRefObject<TextInput | null>).current = r;
              }}
              onSelectionChange={draftMention.onSelectionChange}
              style={styles.input}
              value={draft}
              onChangeText={(v) => {
                setDraft(v);
                if (sendErr) setSendErr(null);
              }}
              placeholder={kind === 'PROJECT' ? `Message #${title.length > 22 ? `${title.slice(0, 20).trim()}…` : title}` : `Message ${title.length > 22 ? `${title.slice(0, 20).trim()}…` : title}`}
              placeholderTextColor={c.ink3}
              accessibilityLabel={`Message ${title}`}
              accessibilityHint="Type @ to mention someone in this conversation. What you type is kept if you leave."
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
            accessibilityLabel={reply ? 'Send reply' : 'Send message'}
            accessibilityHint={online ? undefined : 'You’re offline. It will be sent when you’re back online.'}
            accessibilityState={{ disabled: !draft.trim() }}
          >
            <Text style={styles.sendText}>Send</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <MessageActionsSheet
        visible={acting !== null}
        actions={actingActions}
        onReact={(emoji) => acting && react(acting, emoji)}
        onAction={(a) => acting && doAction(acting, a)}
        onClose={() => setActing(null)}
      />
      <EditMessageSheet
        visible={editing !== null}
        initial={editing?.body ?? ''}
        busy={editBusy}
        error={editError}
        note={online ? null : 'You’re offline — the edit is kept on this phone and sent when you’re back online.'}
        onSave={(body) => void saveEdit(body)}
        onClose={() => setEditing(null)}
      />
      <PrefsSheet
        visible={menuOpen}
        title={title}
        prefs={prefs}
        error={prefsM.error}
        extra={
          <>
            <ActionRowButton
              label="Search in conversation"
              onPress={() => {
                setMenuOpen(false);
                setSearchOpen(true);
              }}
            />
            <ActionRowButton
              label="Members"
              hint={kind === 'PROJECT' ? `${members.length} people` : undefined}
              onPress={() => {
                setMenuOpen(false);
                setMembersOpen(true);
              }}
            />
          </>
        }
        onChange={changePrefs}
        onClose={() => {
          setMenuOpen(false);
          prefsM.clearError();
        }}
      />
      <ThreadSearchSheet
        visible={searchOpen}
        title={title}
        conversationId={conversationId}
        nameOf={nameOf}
        onPick={(m) => {
          setSearchOpen(false);
          setJump(m.id);
        }}
        onClose={() => setSearchOpen(false)}
      />
      <MembersSheet
        visible={membersOpen}
        rows={members}
        loading={kind === 'PROJECT' && membersQ.isLoading}
        failed={membersQ.isError && !membersQ.data}
        onRetry={() => void membersQ.refetch()}
        onMessage={(id, name) => void direct.open(id, name)}
        onClose={() => {
          setMembersOpen(false);
          direct.clearError();
        }}
      />
      <ImageViewer attachment={viewing} baseUrl={baseUrl} onClose={() => setViewing(null)} />
    </SafeAreaView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.ground },
    flex: { flex: 1 },
    grow: { flex: 1 },
    scroll: { padding: spacing.lg, gap: spacing.xs },
    noteWrap: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
    headerTitle: { maxWidth: 240 },
    headerName: { color: c.onBrand, fontSize: fontSize.md, fontWeight: '700' },
    headerSub: { color: c.onBrand, fontSize: fontSize.xs, opacity: 0.85 },
    headerBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', marginRight: spacing.xs },
    headerBtnText: { color: c.onBrand, fontSize: fontSize.xl, fontWeight: '700' },
    emptyWrap: { alignItems: 'center', justifyContent: 'center', gap: spacing.xs, padding: spacing.xl },
    emptyWave: { fontSize: 36 },
    emptyTitle: { fontSize: fontSize.md, fontWeight: '700', color: c.ink },
    empty: { textAlign: 'center', color: c.ink2, fontSize: fontSize.sm },
    older: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.sm },
    olderText: { fontSize: fontSize.xs, color: c.ink2 },
    olderError: { fontSize: fontSize.xs, color: c.danger },
    olderBtn: {
      minHeight: 44,
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: c.line,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      backgroundColor: c.surface,
    },
    olderBtnText: { color: c.brand, fontWeight: '700', fontSize: fontSize.sm },
    beginning: { textAlign: 'center', fontSize: fontSize.xs, color: c.ink2, paddingVertical: spacing.sm },
    refused: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
    refusedTitle: { fontSize: fontSize.md, fontWeight: '700', color: c.ink, textAlign: 'center' },
    refusedText: { fontSize: fontSize.sm, color: c.danger, textAlign: 'center' },
    pill: {
      position: 'absolute',
      bottom: spacing.md,
      alignSelf: 'center',
      minHeight: 44,
      justifyContent: 'center',
      backgroundColor: c.brand,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.lg,
    },
    pillText: { color: c.onBrand, fontWeight: '700', fontSize: fontSize.sm },
    jump: {
      position: 'absolute',
      bottom: spacing.md,
      right: spacing.lg,
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.line,
    },
    jumpText: { color: c.ink2, fontSize: fontSize.lg, fontWeight: '700' },
    errWrap: { paddingHorizontal: spacing.md },
    mentionWrap: { flexGrow: 0, flexShrink: 1, maxHeight: 200, paddingHorizontal: spacing.md },
    mentionInner: { paddingBottom: spacing.xs },
    replyBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginHorizontal: spacing.md,
      marginTop: spacing.xs,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderLeftWidth: 3,
      borderLeftColor: c.brand,
      borderRadius: radius.md,
      backgroundColor: c.surface,
    },
    replyWho: { fontSize: fontSize.xs, fontWeight: '700', color: c.ink },
    replyText: { fontSize: fontSize.xs, color: c.ink2 },
    replyClose: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    replyCloseText: { color: c.ink2, fontSize: fontSize.md, fontWeight: '700' },
    composer: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: spacing.sm,
      padding: spacing.md,
      borderTopWidth: 1,
      borderTopColor: c.line,
      backgroundColor: c.surface,
    },
    attachBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
    attachText: { fontSize: fontSize.lg },
    inputWrap: { flex: 1 },
    input: {
      maxHeight: 120,
      minHeight: 44,
      borderWidth: 1,
      borderColor: c.line,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      color: c.ink,
      fontSize: fontSize.md,
    },
    counter: { fontSize: fontSize.xs, color: c.ink3, marginTop: 2 },
    counterMax: { color: c.danger, fontWeight: '700' },
    sendBtn: { backgroundColor: c.brand, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, minHeight: 44, justifyContent: 'center' },
    sendBtnDisabled: { opacity: 0.5 },
    sendText: { color: c.onBrand, fontWeight: '700', fontSize: fontSize.sm },
  });
