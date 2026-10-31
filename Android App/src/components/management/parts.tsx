import React, { useMemo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useColors } from '../../core/theme';
import { Badge, Card } from '../ui';
import { RAG_WORD, ragTone } from '../../lib/management';
import type { ItemQuery, Rag } from '../../lib/management-api';
import { spacing, type Palette } from '../../lib/theme';
import { typeStyle } from '../../lib/typography';

/** Opens the list behind a number: the query, and the list's name while it loads ("4 late tasks in Rig"). */
export type OpenList = (query: ItemQuery, label: string) => void;

export type NumberTone = 'neutral' | 'warning' | 'danger';

/** A number's TEXT colour in its tone (never a status fill as text). */
export const numberColor = (c: Palette, tone: NumberTone) => (tone === 'danger' ? c.dangerText : tone === 'warning' ? c.warningText : c.ink);

/** A project's mark (components/management/parts.tsx RagMark): the word with a dot, never colour alone. */
export function RagMark({ rag }: { rag: Rag }) {
  return <Badge label={RAG_WORD[rag]} tone={ragTone(rag)} dot />;
}

/**
 * A number that opens the list behind it (the website's NumberButton). With nothing behind it (a
 * zero, or a figure that is not a list) it is plain text. TalkBack hears "<label>: show the list".
 */
export function NumberButton({
  value,
  label,
  query,
  onOpen,
  tone = 'neutral',
  suffix,
  big = false,
}: {
  /** What is shown: the server's figure as sent ("4", "3 overdue", "88%"). */
  value: string;
  label: string;
  query: ItemQuery | null;
  onOpen: OpenList;
  tone?: NumberTone;
  /** Words after the number in a lighter tone ("×"). */
  suffix?: string;
  /** The figure size of the Inspections cards. */
  big?: boolean;
}) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const text = big ? s.big : s.number;
  if (!query) {
    return (
      <View style={s.box} accessible accessibilityLabel={label || value}>
        <Text style={[text, s.zero]}>
          {value}
          {suffix ? <Text style={s.suffix}>{suffix}</Text> : null}
        </Text>
      </View>
    );
  }
  return (
    <Pressable onPress={() => onOpen(query, label)} accessibilityRole="button" accessibilityLabel={`${label}: show the list`} hitSlop={4} style={({ pressed }) => [s.box, s.button, pressed && s.pressed]}>
      <Text style={[text, s.link, { color: numberColor(c, tone) }]}>
        {value}
        {suffix ? <Text style={s.suffix}>{suffix}</Text> : null}
      </Text>
    </Pressable>
  );
}

/** Words that open the list behind them (a reason, "3 days late"): underlined like the numbers. */
export function ListButton({ label, query, onOpen, color, children }: { label: string; query: ItemQuery; onOpen: OpenList; color: string; children: string }) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  return (
    <Pressable onPress={() => onOpen(query, label)} accessibilityRole="button" accessibilityLabel={`${label}: show the list`} style={({ pressed }) => [s.words, pressed && s.pressed]}>
      <Text style={[s.wordsText, { color }]}>{children}</Text>
    </Pressable>
  );
}

/** A section card whose heading TalkBack reads as one, with its note under it and an optional action. */
export function Section({ title, note, action, children }: { title: string; note?: string; action?: ReactNode; children: ReactNode }) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  return (
    <Card style={s.section}>
      <View style={s.sectionHead}>
        <Text style={s.title} accessibilityRole="header">
          {title}
        </Text>
        {note ? <Text style={s.note}>{note}</Text> : null}
        {action ? <View style={s.action}>{action}</View> : null}
      </View>
      {children}
    </Card>
  );
}

/** A small label over a value (the website's <dt>). */
export function Term({ children }: { children: string }) {
  const c = useColors();
  return <Text style={[typeStyle('caption'), { color: c.ink3 }]}>{children}</Text>;
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    box: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignSelf: 'flex-start' },
    button: { paddingHorizontal: spacing.xs },
    pressed: { opacity: 0.7 },
    number: { ...typeStyle('number'), fontSize: 15 },
    big: { ...typeStyle('heading'), fontVariant: ['tabular-nums'] },
    zero: { color: c.ink3 },
    link: { textDecorationLine: 'underline', textDecorationStyle: 'dotted' },
    suffix: { ...typeStyle('caption'), color: c.ink2, textDecorationLine: 'none' },
    words: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
    wordsText: { ...typeStyle('caption'), textDecorationLine: 'underline', textDecorationStyle: 'dotted' },
    section: { gap: spacing.md },
    sectionHead: { gap: spacing.xs },
    title: { ...typeStyle('heading'), color: c.ink },
    note: { ...typeStyle('caption'), color: c.ink2 },
    action: { marginTop: spacing.xs },
  });
