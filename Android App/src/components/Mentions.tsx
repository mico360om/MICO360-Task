import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  type TextInput,
  type StyleProp,
  type TextStyle,
  type NativeSyntheticEvent,
  type TextInputSelectionChangeEventData,
} from 'react-native';
import { useColors } from '../core/theme';
import { applyMention, mentionMenu, tokenizeMentions, type MentionMenu, type MentionPerson } from '../lib/mentions';
import { spacing, radius, fontSize, type Palette } from '../lib/theme';

/**
 * @mention suggestions for a text box: follows the caret, works out who to suggest for what has been
 * typed after an '@', and puts the picked @username in with the caret just after it.
 * Give the text box `ref={inputRef}` and `onSelectionChange`.
 */
export function useMentionInput(value: string, onChange: (text: string) => void, people: MentionPerson[]) {
  const inputRef = useRef<TextInput>(null);
  const [caret, setCaret] = useState<number | null>(null);
  const pendingCaret = useRef<number | null>(null);
  const menu = mentionMenu(value, caret ?? value.length, people);

  // Once the new text is on screen (setting it moves the caret to the end), put the caret back
  // just after the inserted name.
  useEffect(() => {
    const at = pendingCaret.current;
    if (at === null) return;
    pendingCaret.current = null;
    inputRef.current?.setSelection(at, at);
  });

  function pick(person: MentionPerson) {
    if (menu.kind !== 'people') return;
    const { text, caret: next } = applyMention(value, menu.start, person.username, menu.start + 1 + menu.query.length);
    pendingCaret.current = next;
    setCaret(next);
    onChange(text);
  }

  return {
    inputRef,
    menu,
    pick,
    onSelectionChange: (e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => setCaret(e.nativeEvent.selection.end),
  };
}

/** The people to pick for an @mention being typed, or a note when nobody matches. */
export function MentionSuggestions({
  menu,
  onPick,
  noMatchText = (query) => `No one matches “@${query}”.`,
}: {
  menu: MentionMenu;
  onPick: (person: MentionPerson) => void;
  noMatchText?: (query: string) => string;
}) {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  if (menu.kind === 'closed') return null;
  if (menu.kind === 'no-match') {
    return (
      <Text style={styles.note} accessibilityLiveRegion="polite">
        {noMatchText(menu.query)}
      </Text>
    );
  }
  return (
    <View style={styles.list}>
      <Text style={styles.head} accessibilityRole="header">
        Mention someone
      </Text>
      {menu.people.map((p) => (
        <Pressable
          key={p.id}
          onPress={() => onPick(p)}
          accessibilityRole="button"
          accessibilityLabel={`Mention ${p.name || p.username}, @${p.username}`}
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        >
          <Text style={styles.name} numberOfLines={1}>
            {p.name || p.username}
          </Text>
          <Text style={styles.username} numberOfLines={1}>
            @{p.username}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/**
 * Text with @mentions of real people marked in the brand colour — or, on a brand-coloured bubble
 * (my own chat message, `onBrand`), in the bubble's text colour, bold, on a darker shade, as the
 * website does.
 */
export function MentionText({ body, people, style, onBrand }: { body: string; people: MentionPerson[]; style?: StyleProp<TextStyle>; onBrand?: boolean }) {
  const c = useColors();
  const tokens = useMemo(() => tokenizeMentions(body, people.map((p) => p.username)), [body, people]);
  const mark: TextStyle = onBrand ? { color: c.onBrand, fontWeight: '700', backgroundColor: 'rgba(0,0,0,0.2)' } : { color: c.brand, fontWeight: '600' };
  return (
    <Text style={style}>
      {tokens.map((t, i) =>
        t.type === 'mention' ? (
          <Text key={i} style={mark}>
            {t.value}
          </Text>
        ) : (
          t.value
        ),
      )}
    </Text>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    list: {
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.line,
      borderRadius: radius.md,
      marginTop: spacing.xs,
      overflow: 'hidden',
    },
    head: {
      fontSize: fontSize.xs,
      fontWeight: '700',
      color: c.ink2,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderBottomWidth: 1,
      borderBottomColor: c.line,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      minHeight: 48,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    rowPressed: { backgroundColor: c.brandWash },
    name: { flex: 1, fontSize: fontSize.md, color: c.ink },
    username: { fontSize: fontSize.sm, color: c.ink2, maxWidth: '45%' },
    note: { fontSize: fontSize.sm, color: c.ink2, marginTop: spacing.xs },
  });
