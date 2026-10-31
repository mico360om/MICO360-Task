import { useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useColors } from '../../core/theme';
import { calendarTimeZone } from '../../lib/due-date';
import { chatGroups, chatTitle } from '../../lib/mico-ai';
import type { MicoAiChat } from '../../lib/mico-ai-api';
import { CHAT_TITLE_MAX } from '../../lib/mico-ai-chat';
import { radius, spacing, type Palette } from '../../lib/theme';
import { font, typeStyle } from '../../lib/typography';
import { Sheet, SheetMessage } from '../meeting/sheet-kit';
import { Button, IconButton, SectionTitle, SkeletonList, TextField } from '../ui';

export interface ChatsSheetProps {
  visible: boolean;
  onClose: () => void;
  chats: MicoAiChat[];
  activeId: string | null;
  query: string;
  onQuery: (q: string) => void;
  onOpen: (id: string) => void;
  onNew: () => void;
  /** Resolve null, or the words for what went wrong. */
  onRename: (id: string, title: string) => Promise<string | null>;
  onDelete: (id: string) => Promise<string | null>;
  loading: boolean;
  /** The list couldn't be loaded: Try again. */
  onRetry: (() => void) | null;
}

function ChatRow({ chat, active, onOpen, onRename, onAskDelete, s }: { chat: MicoAiChat; active: boolean; onOpen: () => void; onRename: (title: string) => void; onAskDelete: () => void; s: Styles }) {
  const c = useColors();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(chat.title);
  /** Enter and leaving the box both save: only the first counts. */
  const saved = useRef(false);
  const title = chatTitle(chat);
  const save = () => {
    if (saved.current) return;
    saved.current = true;
    setEditing(false);
    const clean = value.replace(/\s+/g, ' ').trim();
    if (clean && clean !== chat.title) onRename(clean);
  };
  if (editing) {
    return (
      <TextField
        autoFocus
        value={value}
        onChangeText={setValue}
        accessibilityLabel="Chat name"
        maxLength={CHAT_TITLE_MAX}
        returnKeyType="done"
        onSubmitEditing={save}
        onBlur={save}
      />
    );
  }
  return (
    <View style={[s.row, active ? s.rowActive : null]}>
      <Pressable onPress={onOpen} accessibilityRole="button" accessibilityState={{ selected: active }} accessibilityLabel={chat.match ? `${title}, ${chat.match}` : title} style={({ pressed }) => [s.rowMain, pressed ? s.pressed : null]}>
        <Text style={[s.rowTitle, active ? s.rowTitleActive : null]} numberOfLines={1}>
          {title}
        </Text>
        {chat.match ? (
          <Text style={s.match} numberOfLines={1}>
            {chat.match}
          </Text>
        ) : null}
      </Pressable>
      <IconButton
        icon="misc.dots"
        label={`More for ${title}`}
        color={c.ink2}
        onPress={() =>
          Alert.alert(title, undefined, [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Rename',
              onPress: () => {
                setValue(chat.title);
                saved.current = false;
                setEditing(true);
              },
            },
            { text: 'Delete…', style: 'destructive', onPress: onAskDelete },
          ])
        }
      />
    </View>
  );
}

/**
 * MICO AI's own list of chats, as the website's ChatList (a sheet from "Open chats" on the phone):
 * New chat, Search chats, and the chats by day in the person's time zone, each with Rename and
 * Delete (asked first).
 */
export function ChatsSheet({ visible, onClose, chats, activeId, query, onQuery, onOpen, onNew, onRename, onDelete, loading, onRetry }: ChatsSheetProps) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const [error, setError] = useState<string | null>(null);
  const groups = chatGroups(chats, new Date(), calendarTimeZone());
  const q = query;

  const askDelete = (chat: MicoAiChat) => {
    const title = chatTitle(chat);
    Alert.alert('Delete this chat?', `“${title}” and its messages will be deleted for good. This can’t be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete chat', style: 'destructive', onPress: () => void onDelete(chat.id).then(setError) },
    ]);
  };

  return (
    <Sheet visible={visible} title="Chats" subtitle="Answers from your MICO360 data" onClose={onClose} closeLabel="Close chats">
      <Button title="New chat" icon="ui.plus" onPress={onNew} />
      <TextField value={query} onChangeText={onQuery} placeholder="Search chats" accessibilityLabel="Search chats" autoCapitalize="none" returnKeyType="search" />
      <SheetMessage text={error} />
      {onRetry ? (
        <View style={s.state}>
          <Text style={s.errorText} accessibilityRole="alert">
            Your chats couldn’t be loaded.
          </Text>
          <Button title="Try again" variant="secondary" size="sm" onPress={onRetry} />
        </View>
      ) : loading && chats.length === 0 ? (
        <SkeletonList rows={4} />
      ) : groups.length === 0 ? (
        <Text style={s.empty}>{q.trim() ? `No chats match “${q.trim()}”.` : 'No chats yet. Ask a question to start one.'}</Text>
      ) : (
        groups.map((g) => (
          <View key={g.label} style={s.group}>
            <SectionTitle>{g.label}</SectionTitle>
            {g.chats.map((chat) => (
              <ChatRow
                key={chat.id}
                chat={chat}
                active={chat.id === activeId}
                onOpen={() => onOpen(chat.id)}
                onRename={(title) => void onRename(chat.id, title).then(setError)}
                onAskDelete={() => askDelete(chat)}
                s={s}
              />
            ))}
          </View>
        ))
      )}
      <Text style={s.footer}>MICO AI only uses what you can see in MICO360 Tasks. Your chats are private to you.</Text>
    </Sheet>
  );
}

type Styles = ReturnType<typeof makeStyles>;

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    state: { gap: spacing.sm, paddingVertical: spacing.sm },
    errorText: { ...typeStyle('body'), color: c.dangerText },
    empty: { ...typeStyle('body'), color: c.ink3, paddingVertical: spacing.sm },
    group: { paddingTop: spacing.xs },
    row: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.input, minHeight: 48 },
    rowActive: { backgroundColor: c.brandWash },
    rowMain: { flex: 1, minHeight: 48, justifyContent: 'center', paddingHorizontal: 10, paddingVertical: 6 },
    rowTitle: { ...typeStyle('body'), color: c.ink2 },
    rowTitleActive: { ...font('600'), color: c.ink },
    match: { ...typeStyle('caption'), color: c.ink3, marginTop: 2 },
    footer: { ...typeStyle('caption'), color: c.ink3, borderTopWidth: 1, borderTopColor: c.line, paddingTop: spacing.md, marginTop: spacing.sm },
    pressed: { opacity: 0.7 },
  });
