import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent, type LayoutRectangle, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { Button, ErrorNote, IconButton, SkeletonList, TextField } from '../components/ui';
import { ChatsSheet } from '../components/mico-ai/ChatsSheet';
import { Composer, type ComposerHandle } from '../components/mico-ai/Composer';
import { MessageView, MicoAiMark, type MessageActions } from '../components/mico-ai/MessageView';
import { openWebsitePage } from '../adapters/website';
import { useServices, useSession, useUserId } from '../core/providers';
import { useColors } from '../core/theme';
import { useDirectory, useProjects } from '../core/queries';
import { useAnswerPoll, useEarlierMessages, useMicoAiActions, useMicoAiChat, useMicoAiChats, useMicoAiStatus } from '../core/mico-ai-queries';
import { chatTitle, suggestedQuestions } from '../lib/mico-ai';
import type { MicoAiMessage } from '../lib/mico-ai-api';
import { announce, CHAT_TITLE_MAX, errorText, isGoneError, pendingAnswer, scrollWant, withEarlier, type ScrollSeen, type ScrollWant } from '../lib/mico-ai-chat';
import { radius, spacing, type Palette } from '../lib/theme';
import { font, typeStyle } from '../lib/typography';
import type { AppScreenProps } from '../navigation/types';

/** What MICO AI reads, as the website's welcome lists it. */
const SCOPE = ['Tasks', 'Meetings', 'Reports', 'Chat'];
/** Within this many dp of the end, the conversation counts as "at the newest message". */
const NEAR_END = 48;
/** A wish to scroll lasts this long: the layout passes the change brings, not growth the person causes later. */
const WISH_MS = 1000;
/** Room above an answer scrolled to its start. */
const ABOVE_ANSWER = 16;
const NO_MESSAGES: MicoAiMessage[] = [];

/**
 * MICO AI (Stage 3 Task 13): the website's MicoAiPage on a phone — the chats in a sheet, the
 * conversation, and the box at the bottom. Asking returns a pending answer at once; the screen
 * follows it (dots and what MICO AI is doing, with Stop) until it is written. Everything is the
 * signed-in person's: the content is keyed by their id, so the next person on a shared phone starts
 * from nothing (Review Focus 2).
 */
export function MicoAiScreen(props: AppScreenProps<'MicoAi'>) {
  const userId = useUserId();
  const c = useColors();
  return (
    <View key={userId ?? 'signed-out'} style={[styles.page, { backgroundColor: c.surface }]}>
      <Conversation {...props} />
    </View>
  );
}

function Conversation({ navigation, route }: AppScreenProps<'MicoAi'>) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const { baseUrl } = useServices();
  const session = useSession();
  const isAdmin = (session?.user.roles ?? []).includes('ADMIN');
  const myId = session?.user.id;

  const [chatId, setChatId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sheet, setSheet] = useState(false);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const composer = useRef<ComposerHandle>(null);

  const statusQ = useMicoAiStatus();
  const listQ = useMicoAiChats(query);
  const chatQ = useMicoAiChat(chatId);
  const earlier = useEarlierMessages(chatId);
  const actions = useMicoAiActions(chatId);
  const dirQ = useDirectory();
  const projectsQ = useProjects();

  const ready = statusQ.data?.ready ?? true;
  const chats = Array.isArray(listQ.data) ? listQ.data : [];
  const latest = chatQ.data?.messages ?? NO_MESSAGES;
  const messages = useMemo(() => withEarlier(latest, earlier?.messages ?? []), [latest, earlier]);
  const hasMore = earlier ? earlier.hasMore : !!chatQ.data?.hasMore;
  // The list is read again after every question, so its entry has the name the first question gave the chat.
  const chat = chats.find((x) => x.id === chatId) ?? chatQ.data?.chat ?? null;
  const answering = pendingAnswer(messages);
  const { gone: pollGone } = useAnswerPoll(chatId, answering);
  // Deleted elsewhere: the poll or the chat's own read says so (a 404).
  const gone = pollGone || isGoneError(chatQ.error);
  // A chat that is gone follows no answer: the box is free again, and the next question starts a new chat.
  const pending = gone ? null : answering;
  const firstName = (Array.isArray(dirQ.data) ? dirQ.data : []).find((u) => u.id === myId)?.firstName?.trim();
  const projectName = useMemo(() => {
    const list = Array.isArray(projectsQ.data) ? projectsQ.data : [];
    return list.find((p) => p.status === 'ACTIVE')?.name ?? list[0]?.name ?? null;
  }, [projectsQ.data]);
  const canAsk = ready && !pending && !sending;
  const welcome = !chatId || (chatQ.isSuccess && messages.length === 0);
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  const live = useLiveWords(messages, pending);

  const openChat = (id: string | null) => {
    setSheet(false);
    setError(null);
    setRenaming(false);
    setChatId(id);
  };

  /**
   * Ask a question: in the open chat, or a new one (`newChat`, no chat open, or the open one was
   * deleted elsewhere). A question that couldn't be sent goes back in the box; one whose answer was
   * lost is read back in its chat, never asked again.
   */
  const send = useCallback(
    async (raw: string, o: { newChat?: boolean; retryOf?: string } = {}) => {
      const text = raw.trim();
      if (!text || sendingRef.current) return;
      sendingRef.current = true;
      setSending(true);
      setError(null);
      const fresh = !!o.newChat || gone || !chatId;
      if (fresh) setChatId(null);
      try {
        const r = await actions.ask(text, { newChat: !!o.newChat || gone, retryOf: o.retryOf });
        if (!r) return;
        if ('error' in r) {
          setError(r.error);
          if (r.restoreDraft) composer.current?.restore(text);
          if (fresh) setChatId(r.chatId);
        } else setChatId(r.chatId);
      } finally {
        sendingRef.current = false;
        setSending(false);
      }
    },
    [actions, chatId, gone],
  );

  // "Ask MICO AI" from Search arrives as the screen's params: a new chat with that question, asked once.
  // The params go first, so coming back to the screen asks nothing again (a link never carries them).
  const asked = useRef<string | null>(null);
  useEffect(() => {
    const ask = route.params?.ask;
    const askId = route.params?.askId;
    if (!ask?.trim() || !askId || asked.current === route.params?.askId) return;
    asked.current = askId;
    navigation.setParams({ ask: undefined, askId: undefined });
    void send(ask, { newChat: true });
  }, [route.params?.ask, route.params?.askId, navigation, send]);

  const stop = async () => {
    if (!pending) return;
    const e = await actions.stop(pending);
    if (e) setError(e);
  };

  const saveName = (v: string) => {
    setRenaming(false);
    if (!chatId || !chat) return;
    const clean = v.replace(/\s+/g, ' ').trim();
    if (clean && clean !== chat.title) void actions.rename(chatId, clean).then((e) => e && setError(e));
  };

  const loadEarlier = async () => {
    const first = messages[0];
    if (!first || loadingEarlier) return;
    setLoadingEarlier(true);
    const r = await actions.loadOlder(first.id);
    if ('error' in r) setError(r.error);
    setLoadingEarlier(false);
  };

  // One download of an answer at a time ("Preparing Excel…"): a second tap while it is made does nothing.
  const [downloads, setDownloads] = useState<Record<string, string>>({});
  const downloadsRef = useRef(new Set<string>());
  const download = useCallback((m: MicoAiMessage, what: string, run: () => Promise<string | null>) => {
    if (downloadsRef.current.has(m.id)) return;
    downloadsRef.current.add(m.id);
    setDownloads((d) => ({ ...d, [m.id]: what }));
    void run()
      .then((e) => e && setError(e))
      .finally(() => {
        downloadsRef.current.delete(m.id);
        setDownloads((d) => {
          const next = { ...d };
          delete next[m.id];
          return next;
        });
      });
  }, []);

  const messageActions = useMemo<MessageActions>(
    () => ({
      ask: (t) => void send(t),
      retry: (m) => {
        const i = messages.findIndex((x) => x.id === m.id);
        const question = [...messages.slice(0, Math.max(0, i))].reverse().find((x) => x.role === 'user')?.text ?? '';
        void send(question, { retryOf: m.id });
      },
      downloadTable: (m, n, title) => download(m, `table-${n}`, () => actions.downloadTable(m, n, title)),
      downloadReport: (m) => download(m, 'pdf', () => actions.downloadReport(m)),
    }),
    [send, messages, actions, download],
  );

  // Where the conversation scrolls, as the website decides it (lib/mico-ai-chat scrollWant): a wish is
  // set where the messages change and carried out once the content has its new size. Growth the person
  // caused (Edit, Show all rows, a section opened) moves nothing; a drag cancels any wish. Older
  // messages put in above keep your place (maintainVisibleContentPosition).
  const scroller = useRef<ScrollView>(null);
  const atEnd = useRef(true);
  const viewHeight = useRef(0);
  const boxes = useRef(new Map<string, LayoutRectangle>());
  const want = useRef<(NonNullable<ScrollWant> & { until: number }) | null>(null);
  const seen = useRef<ScrollSeen>({ chatId: undefined, first: null, last: null, pendingId: null, step: null });
  const firstId = messages[0]?.id ?? null;
  const lastId = messages[messages.length - 1]?.id ?? null;
  const applyWant = () => {
    const w = want.current;
    if (!w || Date.now() > w.until) {
      want.current = null;
      return;
    }
    const el = scroller.current;
    if (!el) return;
    if (w.kind === 'end') {
      el.scrollToEnd({ animated: false });
      atEnd.current = true;
    } else if (w.kind === 'top') {
      el.scrollTo({ y: 0, animated: false });
      atEnd.current = false;
    } else {
      // An answer that just finished: its start when it is taller than the view, else the end.
      const box = boxes.current.get(w.id);
      if (!box) return;
      want.current = null;
      if (box.height > viewHeight.current) {
        el.scrollTo({ y: Math.max(0, box.y - ABOVE_ANSWER), animated: false });
        atEnd.current = false;
      } else {
        el.scrollToEnd({ animated: false });
        atEnd.current = true;
      }
    }
  };
  useLayoutEffect(() => {
    const was = seen.current;
    const now: ScrollSeen = { chatId, first: firstId, last: lastId, pendingId: pending?.id ?? null, step: pending?.step ?? null };
    seen.current = now;
    const w = scrollWant(was, now, messages.length, atEnd.current);
    want.current = w ? { ...w, until: Date.now() + WISH_MS } : want.current;
    // applyWant reads refs only, so it isn't a dependency.
    applyWant();
  }, [chatId, firstId, lastId, pending?.id, pending?.step, messages.length]);
  const onMessageLayout = (id: string, box: LayoutRectangle) => {
    boxes.current.set(id, box);
    if (want.current?.kind === 'start' && want.current.id === id) applyWant();
  };
  const onViewLayout = (e: LayoutChangeEvent) => {
    viewHeight.current = e.nativeEvent.layout.height;
    // The view got shorter (the keyboard opened) while the newest message was in view: it stays in view.
    if (atEnd.current) scroller.current?.scrollToEnd({ animated: false });
  };
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    atEnd.current = contentSize.height - contentOffset.y - layoutMeasurement.height <= NEAR_END;
  };

  return (
    <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={s.header}>
        <IconButton icon="ui.message" label="Open chats" onPress={() => setSheet(true)} />
        {renaming && chatId && chat ? (
          <View style={s.flex}>
            <TextField autoFocus value={name} onChangeText={setName} accessibilityLabel="Chat name" maxLength={CHAT_TITLE_MAX} returnKeyType="done" onSubmitEditing={() => saveName(name)} onBlur={() => saveName(name)} style={s.nameBox} />
          </View>
        ) : (
          <View style={s.titleRow}>
            <Text style={s.title} numberOfLines={1} accessibilityRole="header">
              {chatId && chat ? chatTitle(chat) : 'New chat'}
            </Text>
            {chatId && chat ? (
              <IconButton
                icon="ui.edit"
                label="Rename this chat"
                size={17}
                onPress={() => {
                  setName(chat.title);
                  setRenaming(true);
                }}
              />
            ) : null}
          </View>
        )}
        <IconButton icon="ui.plus" label="New chat" onPress={() => openChat(null)} />
      </View>

      <ScrollView
        ref={scroller}
        style={s.flex}
        contentContainerStyle={[s.content, welcome ? s.contentCentred : null]}
        keyboardShouldPersistTaps="handled"
        onScroll={onScroll}
        scrollEventThrottle={64}
        onLayout={onViewLayout}
        onScrollBeginDrag={() => {
          want.current = null;
        }}
        onContentSizeChange={applyWant}
        maintainVisibleContentPosition={{ minIndexForVisible: 1 }}
      >
        <View style={s.top}>
          {!ready ? (
            <View style={s.warn}>
              <Text style={s.warnText}>{statusQ.data?.message ?? 'MICO AI isn’t set up yet. An administrator can add the AI service in AI Management.'}</Text>
              {isAdmin ? <Button title="Open AI Management" variant="secondary" size="sm" onPress={() => openWebsitePage(baseUrl, '/admin/ai')} style={s.warnButton} /> : null}
            </View>
          ) : null}
          {gone ? (
            <View style={s.warn} accessibilityRole="alert">
              <Text style={s.warnText}>This chat was deleted.</Text>
            </View>
          ) : null}
          {hasMore ? <Button title={loadingEarlier ? 'Loading…' : 'Load earlier messages'} variant="secondary" size="sm" disabled={loadingEarlier} onPress={() => void loadEarlier()} style={s.center} /> : null}
          {chatId && chatQ.isError && !gone ? <ErrorNote message={errorText(chatQ.error)} onRetry={() => void chatQ.refetch()} retrying={chatQ.isFetching} /> : null}
          {welcome ? (
            <View style={s.welcome}>
              <MicoAiMark size={48} />
              <Text style={s.hello} accessibilityRole="header">
                {firstName ? `How can I help, ${firstName}?` : 'How can I help?'}
              </Text>
              <Text style={s.helloSub}>I answer from your tasks, projects, meetings, reports and team chat.</Text>
              <View style={s.scope} accessibilityLabel="MICO AI reads">
                {SCOPE.map((w) => (
                  <Text key={w} style={s.scopeChip}>
                    {w}
                  </Text>
                ))}
              </View>
              <View style={s.suggestions} accessibilityLabel="Suggested questions">
                {suggestedQuestions(projectName).map((q) => (
                  <Pressable key={q} disabled={!canAsk} onPress={() => void send(q)} accessibilityRole="button" accessibilityState={{ disabled: !canAsk }} style={({ pressed }) => [s.suggestion, !canAsk ? s.dim : pressed ? s.pressed : null]}>
                    <Text style={s.suggestionText}>{q}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
          {chatId && chatQ.isLoading ? <SkeletonList rows={3} /> : null}
        </View>
        {messages.map((m) => (
          <View key={m.id} onLayout={(e) => onMessageLayout(m.id, e.nativeEvent.layout)}>
            <MessageView chatId={chatId} message={m} latest={m === lastAssistant} canAsk={canAsk} actions={messageActions} downloading={downloads[m.id]} />
          </View>
        ))}
      </ScrollView>

      <Composer ref={composer} ready={ready} canAsk={canAsk} pending={!!pending} sending={sending} error={error} onSend={(t) => void send(t)} onStop={() => void stop()} />

      {/* What a screen reader hears as an answer starts and arrives (the website's live region). */}
      <Text accessibilityLiveRegion="polite" style={s.live}>
        {live}
      </Text>

      <ChatsSheet
        visible={sheet}
        onClose={() => setSheet(false)}
        chats={chats}
        activeId={chatId}
        query={query}
        onQuery={setQuery}
        onOpen={(id) => openChat(id)}
        onNew={() => openChat(null)}
        onRename={(id, title) => actions.rename(id, title)}
        onDelete={async (id) => {
          const e = await actions.remove(id);
          if (!e && id === chatId) setChatId(null);
          return e;
        }}
        loading={listQ.isLoading}
        onRetry={listQ.isError ? () => void listQ.refetch() : null}
      />
    </KeyboardAvoidingView>
  );
}

/**
 * The words a screen reader hears, once each: that MICO AI is working on a question, then its
 * answer, a stop or a failure when the followed answer is no longer pending.
 */
function useLiveWords(messages: MicoAiMessage[], pending: MicoAiMessage | null): string {
  const [live, setLive] = useState('');
  const announced = useRef<string | null>(null);
  const followed = useRef<string | null>(null);
  useEffect(() => {
    if (pending && announced.current !== pending.id) {
      announced.current = pending.id;
      setLive(announce(pending) ?? '');
    }
    const was = followed.current;
    followed.current = pending?.id ?? null;
    if (!was || was === followed.current) return;
    const m = messages.find((x) => x.id === was);
    if (m && m.status !== 'pending') setLive(announce(m) ?? '');
  }, [messages, pending]);
  return live;
}

const styles = StyleSheet.create({
  page: { flex: 1 },
});

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    flex: { flex: 1 },
    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.xs, minHeight: 52, borderBottomWidth: 1, borderBottomColor: c.line, backgroundColor: c.surface },
    titleRow: { flex: 1, flexDirection: 'row', alignItems: 'center', minWidth: 0 },
    title: { ...font('600', 'display'), fontSize: 15, lineHeight: 20, color: c.ink, flexShrink: 1 },
    nameBox: { minHeight: 40 },
    content: { paddingHorizontal: spacing.lg, paddingVertical: spacing.lg, gap: spacing.xl },
    contentCentred: { flexGrow: 1, justifyContent: 'center' },
    top: { gap: spacing.md },
    center: { alignSelf: 'center' },
    warn: { borderWidth: 1, borderColor: c.warning, backgroundColor: c.warningSoft, borderRadius: radius.card, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.sm },
    warnText: { ...typeStyle('body'), color: c.ink },
    warnButton: { alignSelf: 'flex-start' },
    welcome: { alignItems: 'center', gap: spacing.sm },
    hello: { ...font('600', 'display'), fontSize: 22, lineHeight: 28, color: c.ink, textAlign: 'center', marginTop: spacing.sm },
    helloSub: { ...typeStyle('body'), color: c.ink2, textAlign: 'center', maxWidth: 360 },
    scope: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6 },
    scopeChip: { ...typeStyle('caption'), ...font('500'), color: c.ink2, borderWidth: 1, borderColor: c.line, backgroundColor: c.ground, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 2, overflow: 'hidden' },
    suggestions: { alignSelf: 'stretch', gap: 10, marginTop: spacing.md },
    suggestion: { borderWidth: 1, borderColor: c.line, backgroundColor: c.surface, borderRadius: radius.card, padding: 14, minHeight: 48, justifyContent: 'center' },
    suggestionText: { ...typeStyle('body'), color: c.ink },
    pressed: { opacity: 0.8 },
    dim: { opacity: 0.6 },
    live: { position: 'absolute', left: 0, bottom: 0, width: 1, height: 1, overflow: 'hidden', color: c.surface },
  });
