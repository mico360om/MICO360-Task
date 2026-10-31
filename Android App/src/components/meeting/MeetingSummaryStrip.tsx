import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useColors } from '../../core/theme';
import { chipLook } from '../../lib/ui-kit';
import { radius, spacing, shadow, type Palette } from '../../lib/theme';
import { font, typeStyle } from '../../lib/typography';
import { FOCUSES, FOCUS_LABELS, type MeetingFocus, type MeetingSummary } from '../../lib/meeting-list';

/**
 * The website's four numbers over the meetings list (MeetingSummaryStrip.tsx) — still to come in the
 * next 7 days, open action items, minutes to finish, held this month — two a row, as on its phone
 * layout: "2 Minutes to finish" on one line each. Tapping one shows just those meetings (tapping it
 * again, everything); a 0 is plain text, as there is nothing to show.
 */
export function MeetingSummaryStrip({ summary, focus, onFocus }: { summary: MeetingSummary; focus?: MeetingFocus; onFocus(next: MeetingFocus | undefined): void }) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return (
    <View accessibilityRole="summary" accessibilityLabel="Meetings at a glance" style={s.grid}>
      {FOCUSES.map((key) => {
        const value = summary[key];
        const pressed = focus === key;
        const look = chipLook(c, pressed);
        const said = `${value} ${FOCUS_LABELS[key]}${key === 'actions' && summary.actions ? `, in ${plural(summary.actionMeetings, 'meeting', 'meetings')}` : ''}`;
        const body = (
          <Text style={s.line} numberOfLines={2}>
            <Text style={[s.value, { color: pressed ? look.fg : c.ink }]}>{value}</Text>
            <Text style={[s.label, { color: pressed ? look.fg : c.ink2 }]}> {FOCUS_LABELS[key]}</Text>
          </Text>
        );
        if (!value) {
          return (
            <View key={key} accessible accessibilityRole="text" accessibilityLabel={said} style={[s.tile, s.plain]}>
              {body}
            </View>
          );
        }
        return (
          <Pressable
            key={key}
            onPress={() => onFocus(pressed ? undefined : key)}
            accessibilityRole="button"
            accessibilityLabel={said}
            accessibilityHint={pressed ? 'Shows all meetings' : key === 'actions' ? 'Shows the meetings with open action items' : 'Shows these meetings'}
            accessibilityState={{ selected: pressed }}
            style={({ pressed: down }) => [s.tile, s.button, { backgroundColor: look.bg, borderColor: look.border }, down && s.down]}
          >
            {body}
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    // Two a row: each takes just under half (the gap between them is spacing.sm).
    tile: { flexBasis: '47%', flexGrow: 1, minHeight: 44, justifyContent: 'center', borderRadius: radius.button, borderWidth: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
    plain: { backgroundColor: c.surface, borderColor: c.line },
    button: { ...shadow.soft },
    down: { opacity: 0.85 },
    line: { minWidth: 0 },
    value: { ...typeStyle('heading'), ...font('700', 'display'), fontVariant: ['tabular-nums'] },
    label: { ...typeStyle('caption'), ...font('500') },
  });
