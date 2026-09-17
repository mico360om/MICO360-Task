import React, { useMemo, useState, useEffect, useLayoutEffect } from 'react';
import { View, Text, ScrollView, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useConversationMessages, useSendMessage, useDirectory } from '../core/queries';
import { useSession } from '../core/providers';
import { useColors } from '../core/theme';
import { Loader } from '../components/ui';
import { spacing, radius, fontSize, type Palette } from '../lib/theme';
import type { ApiChatMessage } from '../lib/types';
import type { AppScreenProps } from '../navigation/types';

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
  const myId = session?.user?.id;
  const [draft, setDraft] = useState('');
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
  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: false });
  }, [messages.length]);

  function send() {
    const body = draft.trim();
    if (!body) return;
    setDraft('');
    sendM.mutate(body);
  }

  if (messagesQ.isLoading) return <Loader />;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView ref={scrollRef} contentContainerStyle={styles.scroll}>
          {messages.length === 0 ? (
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
                {!m.deletedAt && m.attachments.length > 0 ? (
                  <View style={styles.attachments}>
                    {m.attachments.map((a) => (
                      <View key={a.id} style={styles.attachChip}>
                        <Text style={styles.attachText}>📎 {a.fileName}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
                {!m.deletedAt && m.reactions.length > 0 ? (
                  <View style={styles.reactions}>
                    {m.reactions.map((r) => (
                      <View key={r.emoji} style={styles.chip}>
                        <Text style={styles.chipText}>{r.emoji} {r.userIds.length}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            ))
          )}
        </ScrollView>

        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="Message…  (@ to mention)"
            placeholderTextColor={c.ink3}
            accessibilityLabel="Message"
            multiline
          />
          <Pressable
            style={[styles.sendBtn, !draft.trim() && styles.sendBtnDisabled]}
            onPress={send}
            disabled={!draft.trim()}
            accessibilityRole="button"
            accessibilityLabel="Send message"
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
    empty: { textAlign: 'center', color: c.ink2, marginTop: spacing.xl, fontSize: fontSize.sm },
    msg: { gap: 2 },
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
    composer: {
      flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm,
      padding: spacing.md, borderTopWidth: 1, borderTopColor: c.line, backgroundColor: c.surface,
    },
    input: {
      flex: 1, maxHeight: 120, minHeight: 40,
      borderWidth: 1, borderColor: c.line, borderRadius: radius.md,
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: c.ink, fontSize: fontSize.md,
    },
    sendBtn: { backgroundColor: c.brand, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
    sendBtnDisabled: { opacity: 0.5 },
    sendText: { color: c.onBrand, fontWeight: '700', fontSize: fontSize.sm },
  });
