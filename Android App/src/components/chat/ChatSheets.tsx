import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useColors } from '../../core/theme';
import { useChatSearch, CHAT_SEARCH_MIN } from '../../core/queries';
import { TextField } from '../ui';
import { ActionRowButton, Sheet, SheetButtons, SheetMessage } from '../meeting/sheet-kit';
import { dayLabel, highlightParts, searchSnippet } from '../../lib/chat-model';
import { dmCandidates, prefsMenu, type MemberRow } from '../../lib/chat-ui';
import { spacing, radius, fontSize, type Palette } from '../../lib/theme';
import type { ApiChatMessage, ApiDirectoryUser, ConversationPrefs } from '../../lib/types';

/**
 * The chat's sheets (3b): a new direct message (the people picker), my settings for a conversation
 * (favorite, mute, archive), its members, and message search — each as on the website, each read by
 * TalkBack.
 */

function useStyles() {
  const c = useColors();
  return { c, s: useMemo(() => makeStyles(c), [c]) };
}

function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** "New direct message": active teammates, found by name or username; picking one opens the conversation. */
export function NewMessageSheet({
  visible,
  directory,
  myId,
  opening,
  error,
  onPick,
  onClose,
}: {
  visible: boolean;
  directory: ApiDirectoryUser[];
  myId: string;
  opening: string | null;
  error: string | null;
  onPick: (userId: string, name: string) => void;
  onClose: () => void;
}) {
  const { c, s } = useStyles();
  const [q, setQ] = useState('');
  const people = useMemo(() => dmCandidates(directory, myId, q), [directory, myId, q]);
  return (
    <Sheet visible={visible} title="New direct message" subtitle="Message a teammate." onClose={onClose} footer={<SheetButtons cancel="Close" onCancel={onClose} />}>
      <TextField accessibilityLabel="Find a teammate" value={q} onChangeText={setQ} placeholder="Message a teammate…" autoCapitalize="none" autoCorrect={false} />
      <SheetMessage text={error} />
      {people.length === 0 ? <Text style={s.empty}>{q.trim() ? `No one matches “${q.trim()}”.` : 'No one to message yet.'}</Text> : null}
      {people.map((p) => (
        <Pressable
          key={p.id}
          style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}
          onPress={() => onPick(p.id, p.label)}
          disabled={opening !== null}
          accessibilityRole="button"
          accessibilityLabel={`Message ${p.label}, ${p.hint}`}
          accessibilityState={{ busy: opening === p.id, disabled: opening !== null }}
        >
          <View style={[s.initial, { backgroundColor: c.brandWash }]}>
            <Text style={[s.initialText, { color: c.brand }]}>{p.label.slice(0, 1).toUpperCase()}</Text>
          </View>
          <View style={s.grow}>
            <Text style={s.name} numberOfLines={1}>
              {p.label}
            </Text>
            <Text style={s.hint}>{p.hint}</Text>
          </View>
          {opening === p.id ? <ActivityIndicator color={c.brand} /> : null}
        </Pressable>
      ))}
    </Sheet>
  );
}

/** My settings for a conversation: favorite, mute, archive (the website's row menu). Needs a connection. */
export function PrefsSheet({
  visible,
  title,
  prefs,
  busy,
  error,
  extra,
  onChange,
  onClose,
}: {
  visible: boolean;
  title: string;
  prefs: ConversationPrefs;
  busy?: boolean;
  error: string | null;
  /** Rows before the settings (the thread's own: search, members). */
  extra?: React.ReactNode;
  onChange: (patch: Partial<ConversationPrefs>) => void;
  onClose: () => void;
}) {
  return (
    <Sheet visible={visible} title={title} onClose={onClose} footer={<SheetButtons cancel="Close" onCancel={onClose} />}>
      {extra}
      {prefsMenu(prefs).map((item) => (
        <ActionRowButton key={item.key} label={item.label} onPress={() => onChange(item.patch)} disabled={busy} />
      ))}
      <SheetMessage text={error} />
    </Sheet>
  );
}

/** A conversation's members: me first, then who is online; message anyone else directly. */
export function MembersSheet({
  visible,
  rows,
  loading,
  failed,
  onRetry,
  onMessage,
  opening = null,
  error = null,
  onClose,
}: {
  visible: boolean;
  rows: MemberRow[];
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  onMessage: (userId: string, name: string) => void;
  /** Whose direct conversation is being opened (a new one needs a connection). */
  opening?: string | null;
  /** Why it couldn't be opened. */
  error?: string | null;
  onClose: () => void;
}) {
  const { c, s } = useStyles();
  const online = rows.filter((m) => m.online).length;
  return (
    <Sheet
      visible={visible}
      title="Members"
      subtitle={loading ? 'Loading…' : `${rows.length} ${rows.length === 1 ? 'person' : 'people'} · ${online} online`}
      onClose={onClose}
      footer={<SheetButtons cancel="Close" onCancel={onClose} />}
    >
      {failed ? (
        <>
          <SheetMessage text="Couldn’t load the members." />
          <ActionRowButton label="Retry" onPress={onRetry} />
        </>
      ) : null}
      {rows.map((m) => (
        <View key={m.id} style={s.row} accessible={m.me} accessibilityLabel={m.me ? `${m.name} (you), ${m.presence}` : undefined}>
          <View style={[s.initial, { backgroundColor: c.brandWash }]}>
            <Text style={[s.initialText, { color: c.brand }]}>{m.name.slice(0, 1).toUpperCase()}</Text>
            <View style={[s.dot, { backgroundColor: m.online ? c.success : c.ink3, borderColor: c.surface }]} />
          </View>
          <View style={s.grow} accessible={!m.me} accessibilityLabel={!m.me ? `${m.name}, ${m.presence}` : undefined}>
            <Text style={s.name} numberOfLines={1}>
              {m.name}
              {m.me ? ' (you)' : ''}
            </Text>
            <Text style={[s.hint, m.online && { color: c.success }]}>{m.presence}</Text>
          </View>
          {m.me ? null : opening === m.id ? (
            <ActivityIndicator color={c.brand} style={s.iconBtn} />
          ) : (
            <Pressable
              style={s.iconBtn}
              onPress={() => onMessage(m.id, m.name)}
              disabled={opening !== null}
              accessibilityRole="button"
              accessibilityLabel={`Message ${m.name}`}
              accessibilityState={{ disabled: opening !== null }}
              hitSlop={4}
            >
              <Text style={[s.iconText, { color: c.brand }]}>✉</Text>
            </Pressable>
          )}
        </View>
      ))}
      <SheetMessage text={error} />
    </Sheet>
  );
}

/** One search result: where, who and when, and the words found, marked. */
function ResultRow({ m, q, where, nameOf, onPick }: { m: ApiChatMessage; q: string; where?: string; nameOf: (id: string) => string; onPick: (m: ApiChatMessage) => void }) {
  const { c, s } = useStyles();
  const snippet = searchSnippet(m.body, q);
  const when = `${dayLabel(m.createdAt)} ${clockTime(m.createdAt)}`;
  return (
    <Pressable
      style={({ pressed }) => [s.result, pressed && { opacity: 0.7 }]}
      onPress={() => onPick(m)}
      accessibilityRole="button"
      accessibilityLabel={`${where ? `${where}, ` : ''}${nameOf(m.userId)}, ${when}: ${snippet}. Show this message.`}
    >
      <View style={s.resultHead}>
        {where ? (
          <Text style={s.where} numberOfLines={1}>
            {where}
          </Text>
        ) : null}
        <Text style={s.hint} numberOfLines={1}>
          {nameOf(m.userId)}
        </Text>
        <Text style={[s.hint, s.right]}>{when}</Text>
      </View>
      <Text style={s.snippet}>
        {highlightParts(snippet, q).map((part, i) =>
          part.match ? (
            <Text key={i} style={[s.mark, { backgroundColor: c.warningSoft }]}>
              {part.text}
            </Text>
          ) : (
            <Text key={i}>{part.text}</Text>
          ),
        )}
      </Text>
    </Pressable>
  );
}

/**
 * Messages containing the words, newest first (the website's SearchResults) — in all of my
 * conversations, or in one — from two letters. Picking one shows it where it was written.
 */
export function ChatSearchResults({
  q,
  conversationId,
  titleOf,
  nameOf,
  onPick,
}: {
  q: string;
  conversationId?: string;
  titleOf?: (conversationId: string) => string;
  nameOf: (userId: string) => string;
  onPick: (m: ApiChatMessage) => void;
}) {
  const { s } = useStyles();
  const { query, term, waiting } = useChatSearch(q, conversationId);
  if (q.trim().length < CHAT_SEARCH_MIN) return <Text style={s.empty}>Type at least {CHAT_SEARCH_MIN} letters to search messages.</Text>;
  if (waiting || query.isLoading) {
    return (
      <Text style={s.empty} accessibilityLiveRegion="polite">
        Searching…
      </Text>
    );
  }
  if (query.isError) {
    return (
      <View style={s.resultsError}>
        <SheetMessage text="Couldn’t search messages. Searching needs a connection." />
        <ActionRowButton label="Retry" onPress={() => void query.refetch()} />
      </View>
    );
  }
  const list = Array.isArray(query.data) ? query.data : [];
  if (list.length === 0) {
    return (
      <Text style={s.empty} accessibilityLiveRegion="polite">
        No messages match “{term}”.
      </Text>
    );
  }
  return (
    <View>
      <Text style={s.count} accessibilityLiveRegion="polite">
        {list.length} {list.length === 1 ? 'MESSAGE' : 'MESSAGES'}
      </Text>
      {list.map((m) => (
        <ResultRow key={m.id} m={m} q={term} where={titleOf?.(m.conversationId)} nameOf={nameOf} onPick={onPick} />
      ))}
    </View>
  );
}

/** Search in one conversation (from its menu). */
export function ThreadSearchSheet({
  visible,
  title,
  conversationId,
  nameOf,
  onPick,
  onClose,
}: {
  visible: boolean;
  title: string;
  conversationId: string;
  nameOf: (userId: string) => string;
  onPick: (m: ApiChatMessage) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  return (
    <Sheet visible={visible} title="Search in conversation" subtitle={title} onClose={onClose} footer={<SheetButtons cancel="Close" onCancel={onClose} />}>
      <TextField accessibilityLabel="Search this conversation" value={q} onChangeText={setQ} placeholder={`Search in ${title}`} autoCapitalize="none" autoCorrect={false} autoFocus maxLength={200} />
      {q.trim() ? <ChatSearchResults q={q} conversationId={conversationId} nameOf={nameOf} onPick={onPick} /> : null}
    </Sheet>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48, paddingVertical: spacing.xs },
    grow: { flex: 1 },
    initial: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
    initialText: { fontWeight: '700', fontSize: fontSize.sm },
    dot: { position: 'absolute', right: -1, bottom: -1, width: 12, height: 12, borderRadius: 6, borderWidth: 2 },
    name: { fontSize: fontSize.md, color: c.ink, fontWeight: '600' },
    hint: { fontSize: fontSize.xs, color: c.ink2 },
    right: { marginLeft: 'auto' },
    empty: { fontSize: fontSize.sm, color: c.ink2, paddingVertical: spacing.sm },
    iconBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
    iconText: { fontSize: fontSize.lg, fontWeight: '700' },
    result: { paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: c.line, gap: 2, minHeight: 48 },
    resultHead: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
    where: { fontSize: fontSize.xs, fontWeight: '700', color: c.ink, maxWidth: '45%' },
    snippet: { fontSize: fontSize.sm, color: c.ink },
    mark: { fontWeight: '700', color: c.ink },
    count: { fontSize: fontSize.xs, fontWeight: '700', color: c.ink2, paddingVertical: spacing.xs },
    resultsError: { gap: spacing.xs },
  });
