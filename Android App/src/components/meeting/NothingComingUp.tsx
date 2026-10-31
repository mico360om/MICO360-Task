import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useColors } from '../../core/theme';
import { Button } from '../ui';
import { Icon } from '../Icon';
import { radius, spacing, shadow, type Palette } from '../../lib/theme';
import { font, typeStyle } from '../../lib/typography';
import { NOTHING_TEXT } from '../../lib/meeting-list';

/**
 * In the "Up next" place when nothing is scheduled, as on the website (NothingComingUp.tsx): says so,
 * names the last meeting (tap it to open it) and offers to schedule the next one, so a quiet week
 * doesn't look like an empty or broken page.
 */
export function NothingComingUp({ last, onSchedule, onOpen }: { last: { title: string; when: string } | null; onSchedule: () => void; onOpen: () => void }) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  return (
    <View style={s.card}>
      <View style={s.top}>
        <View style={s.bubble} importantForAccessibility="no-hide-descendants">
          <Icon name="kit.calendar" size={20} color={c.ink3} />
        </View>
        <View style={s.body}>
          <Text style={s.eyebrow}>{NOTHING_TEXT.eyebrow}</Text>
          <Text style={s.title} accessibilityRole="header">
            {NOTHING_TEXT.title}
          </Text>
          {last ? (
            <Text style={s.line}>
              Last meeting:{' '}
              <Text style={s.link} onPress={onOpen} accessibilityRole="link" accessibilityHint="Opens the meeting" suppressHighlighting={false}>
                {last.title}
              </Text>
              , {last.when}.
            </Text>
          ) : (
            <Text style={s.line}>{NOTHING_TEXT.none}</Text>
          )}
        </View>
      </View>
      <Button title={NOTHING_TEXT.schedule} icon="kit.calendar" onPress={onSchedule} style={s.button} />
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    card: { backgroundColor: c.surface, borderRadius: radius.card, borderWidth: 1, borderColor: c.line, padding: spacing.md, gap: spacing.md, ...shadow.soft },
    top: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    bubble: { width: 40, height: 40, borderRadius: radius.button, backgroundColor: c.ground, alignItems: 'center', justifyContent: 'center' },
    body: { flex: 1, minWidth: 0 },
    eyebrow: { ...typeStyle('eyebrow'), ...font('700'), color: c.ink2 },
    title: { ...typeStyle('heading'), ...font('700', 'display'), color: c.ink },
    line: { ...typeStyle('body'), color: c.ink2, marginTop: 2 },
    link: { ...font('500'), color: c.ink, textDecorationLine: 'underline' },
    button: { minHeight: 44 },
  });
