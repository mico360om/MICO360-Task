import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Linking, type TextStyle } from 'react-native';
import { useColors } from '../../core/theme';
import { spacing, fontSize, type Palette } from '../../lib/theme';
import { listMarkers, parseRichNote, safeNoteHref, type RichRun } from '../../lib/rich-note';
import type { ApiMeetingNote } from '../../lib/types';

/**
 * A note's words: a plain note as written, a formatted one with its bold, italic, underline,
 * highlight, heading, lists and links — drawn as Text from the server's fixed form (lib/rich-note),
 * never as HTML. A link opens only when it is a web or mail address.
 */
export function NoteBody({ note }: { note: Pick<ApiMeetingNote, 'body' | 'bodyFormat'> }) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const blocks = useMemo(() => (note.bodyFormat === 'RICH' ? parseRichNote(note.body) : null), [note.body, note.bodyFormat]);
  if (!blocks) return <Text style={s.text}>{note.body}</Text>;
  const markers = listMarkers(blocks);
  const run = (r: RichRun, i: number) => {
    const style: TextStyle[] = [];
    if (r.marks.includes('bold')) style.push(s.bold);
    if (r.marks.includes('italic')) style.push(s.italic);
    if (r.marks.includes('underline')) style.push(s.underline);
    if (r.marks.includes('highlight')) style.push(s.highlight);
    const href = safeNoteHref(r.href);
    if (href) {
      return (
        <Text key={i} style={[...style, s.link]} accessibilityRole="link" onPress={() => void Linking.openURL(href).catch(() => {})}>
          {r.text}
        </Text>
      );
    }
    return (
      <Text key={i} style={style}>
        {r.text}
      </Text>
    );
  };
  return (
    <View style={s.blocks}>
      {blocks.map((b, i) =>
        b.kind === 'item' ? (
          <View key={i} style={[s.item, { paddingLeft: b.level * spacing.lg }]}>
            <Text style={[s.text, s.marker]}>{markers[i]}</Text>
            <Text style={[s.text, s.itemText]}>{b.runs.map(run)}</Text>
          </View>
        ) : (
          <Text key={i} style={[s.text, b.kind === 'heading' && s.heading]} accessibilityRole={b.kind === 'heading' ? 'header' : undefined}>
            {b.runs.map(run)}
          </Text>
        ),
      )}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    blocks: { gap: spacing.xs },
    // Arabic notes read right to left (Android picks the direction from the text).
    text: { fontSize: fontSize.sm, color: c.ink, lineHeight: 20, textAlign: 'auto' },
    heading: { fontSize: fontSize.md, fontWeight: '800' },
    bold: { fontWeight: '700' },
    italic: { fontStyle: 'italic' },
    underline: { textDecorationLine: 'underline' },
    highlight: { backgroundColor: c.warningSoft },
    link: { color: c.brand, textDecorationLine: 'underline' },
    item: { flexDirection: 'row', gap: spacing.xs },
    marker: { minWidth: 18, color: c.ink2 },
    itemText: { flex: 1 },
  });
