import React, { useMemo, useState, useEffect, useLayoutEffect } from 'react';
import { View, Text, ScrollView, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { keyed, useConversationMessages, useSendMessage, useDirectory } from '../core/queries';
import { useSession, useMyQueuedChanges } from '../core/providers';
import { useColors } from '../core/theme';
import { Loader, ErrorNote } from '../components/ui';
import { ApiError, isNetworkError } from '../lib/api-client';
import { spacing, radius, fontSize, type Palette } from '../lib/theme';
import type { ApiChatMessage } from '../lib/types';
import type { AppScreenProps } from '../navigation/types';

/** The server rejects chat messages longer than this (MOB-07). */
export const CHAT_MAX_LENGTH = 4000;

function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function ChatThreadScreen({ route, navigation }: AppScreenProps<'ChatThread'>) {
  const { conversationId, title } = route.params;
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const messagesQ = useConversationMessages(conversationId);
  const sendM = useSendMessage(conversationId);
  const dirQ = useDirectory();
  const session = useSession();
  const queued = useMyQueuedChanges();
  const myId = session?.user?.id;
  const [draft, setDraft] = useState('');
  const [sendErr, setSendErr] = useState<string | null>(null);
  const scrollRef = React.useRef<ScrollView>(null);

  useLayoutEffect(() => {
    navigation.setOptions({ title });
  }, [navigation, title]);

  const nameOf = (userId: string): string => {
    if (userId === myId) return 'You';
    const u = (dirQ.data ?? []).find((d) => d.id === userId);
    return u ? `${u.firstName} ${u.lastName}`.trim() || u.username : 'Someone';
  };

  const messages = messagesQ.data ?? [];
  // Messages written offline for this conversation, waiting to sync (MOB-07).
  const pending = queued.pending.filter(
    (m) => m.kind === 'chat.send' && (m.payload as { conversationId?: string } | null)?.conversationId === conversationId,
  );
  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: false });
  }, [messages.length, pending.length]);

  async function send() {
    const body = draft.trim();
    if (!body || sendM.isPending) return;
    setSendErr(null);
    // Keep the text in the composer until the server has it (or it is safely queued).
    try {
      await sendM.mutateAsync(keyed({ body }));
      setDraft('');
    } catch (e) {
      if (isNetworkError(e)) {
        setDraft(''); // queued — shown below as "Sending…", sent automatically when back online
      } else {
        setSendErr(e instanceof ApiError && e.message ? e.message : 'Your message was not sent. Please try again.');
      }
    }
  }

  if (messagesQ.isLoading) return <Loader />;

  const remaining = CHAT_MAX_LENGTH - draft.length;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView ref={scrollRef} contentContainerStyle={styles.scroll}>
          {messagesQ.isError && !messagesQ.data ? (
            // A failed load is not "No messages yet" (MOB-08).
            <ErrorNote
              message="Couldn't load this conversation. Check your connection and try again."
              onRetry={() => void messagesQ.refetch()}
              retrying={messagesQ.isRefetching}
            />
          ) : messages.length === 0 && pending.length === 0 ? (
            <Text style={styles.empty}>No messages yet. Say hello 👋</Text>
          ) : (
            messages.map((m: ApiChatMessage) => (
              <View key={m.id} style={styles.msg}>
                <View style={styles.msgHead}>
                  <Text style={styles.author}>{nameOf(m.userId)}</Text>
                  <Text style={styles.time}>{clockTime(m.createdAt)}</Text>
                  {m.editedAt && !m.deletedAt ? <Text style={styles.edited}>(edited)</Text> : null}
                </View>
                {m.deletedAt ? (
                  <Text style={styles.deleted}>This message was deleted.</Text>
                ) : (
                  <Text style={styles.body}>{m.body}</Text>
                )}
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
                        <Text style={styles.chipText}>{r.emoji} {r.userIds.length}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            ))
          )}
          {pending.map((m) => (
            <View key={m.id} style={[styles.msg, styles.pendingMsg]}>
              <View style={styles.msgHead}>
                <Text style={styles.author}>You</Text>
                <Text style={styles.time}>Sending when you’re back online…</Text>
              </View>
              <Text style={styles.body}>{(m.payload as { body?: string }).body}</Text>
            </View>
          ))}
        </ScrollView>

        {sendErr ? (
          <View style={styles.errWrap}>
            <ErrorNote message={sendErr} />
          </View>
        ) : null}
        <View style={styles.composer}>
          <View style={styles.inputWrap}>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={(v) => {
                setDraft(v);
                if (sendErr) setSendErr(null);
              }}
              placeholder="Message…  (@ to mention)"
              placeholderTextColor={c.ink3}
              accessibilityLabel="Message"
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
            style={[styles.sendBtn, (!draft.trim() || sendM.isPending) && styles.sendBtnDisabled]}
            onPress={() => void send()}
            disabled={!draft.trim() || sendM.isPending}
            accessibilityRole="button"
            accessibilityLabel="Send message"
            accessibilityState={{ disabled: !draft.trim() || sendM.isPending, busy: sendM.isPending }}
          >
            <Text style={styles.sendText}>{sendM.isPending ? 'Sending…' : 'Send'}</Text>
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
    empty: { textAlign: 'center', color: c.ink2, marginTop: spacing.xl, fontSize: fontSize.sm },
    msg: { gap: 2 },
    pendingMsg: { opacity: 0.6 },
    msgHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    author: { fontSize: fontSize.sm, fontWeight: '700', color: c.ink },
    time: { fontSize: fontSize.xs, color: c.ink3 },
    edited: { fontSize: fontSize.xs, color: c.ink3 },
    body: { fontSize: fontSize.md, color: c.ink },
    deleted: { fontSize: fontSize.md, fontStyle: 'italic', color: c.ink3 },
    attachments: { flexDirection: 'row', gap: spacing.xs, marginTop: 4, flexWrap: 'wrap' },
    attachChip: { borderWidth: 1, borderColor: c.line, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: c.surface },
    attachText: { fontSize: fontSize.xs, color: c.ink },
    reactions: { flexDirection: 'row', gap: spacing.xs, marginTop: 4, flexWrap: 'wrap' },
    chip: { borderWidth: 1, borderColor: c.line, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
    chipText: { fontSize: fontSize.xs, color: c.ink2 },
    errWrap: { paddingHorizontal: spacing.md },
    composer: {
      flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm,
      padding: spacing.md, borderTopWidth: 1, borderTopColor: c.line, backgroundColor: c.surface,
    },
    inputWrap: { flex: 1 },
    input: {
      maxHeight: 120, minHeight: 40,
      borderWidth: 1, borderColor: c.line, borderRadius: radius.md,
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: c.ink, fontSize: fontSize.md,
    },
    counter: { fontSize: fontSize.xs, color: c.ink3, marginTop: 2 },
    counterMax: { color: c.danger, fontWeight: '700' },
    sendBtn: { backgroundColor: c.brand, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, minHeight: 40, justifyContent: 'center' },
    sendBtnDisabled: { opacity: 0.5 },
    sendText: { color: c.onBrand, fontWeight: '700', fontSize: fontSize.sm },
  });
