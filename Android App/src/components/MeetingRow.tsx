import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Linking } from 'react-native';
import { spacing, radius, fontSize, type Palette } from '../lib/theme';
import { useColors } from '../core/theme';
import { isRepeating, joinLink, meetingPlace, meetingTime } from '../lib/meetings';
import { recurrenceSummary } from '../lib/recurrence-summary';
import { Button } from './ui';
import type { ApiMeeting } from '../lib/types';

type RowMeeting = Pick<ApiMeeting, 'id' | 'title' | 'status' | 'startAt' | 'endAt' | 'location' | 'onlineLink' | 'recurrenceRule' | 'recurrenceParentId'> & {
  description?: string | null;
};

/**
 * A meeting in a list (read-only — meetings are run in the web portal): its time, title, place and
 * whether it repeats. Tapping it shows its notes and a button to join an online meeting.
 */
export function MeetingRow({ meeting, showDate }: { meeting: RowMeeting; showDate?: string }) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const [open, setOpen] = useState(false);
  const cancelled = meeting.status === 'CANCELLED';
  const time = meetingTime(meeting);
  const place = meetingPlace(meeting);
  const repeats = isRepeating(meeting);
  const link = joinLink(meeting);
  const description = meeting.description?.trim();
  const label = [
    'Meeting',
    showDate,
    time,
    meeting.title,
    place,
    repeats ? 'repeats' : null,
    cancelled ? 'cancelled' : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <View style={[s.row, cancelled && s.cancelledRow]}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: open }}
        accessibilityHint={open ? 'Hides the details' : 'Shows the details'}
        style={({ pressed }) => [s.head, pressed && s.pressed]}
      >
        <View style={s.when}>
          <Text style={s.icon} importantForAccessibility="no">📅</Text>
        </View>
        <View style={s.body}>
          <Text style={[s.title, cancelled && s.struck]} numberOfLines={2}>
            {meeting.title}
          </Text>
          <View style={s.meta}>
            <Text style={s.time}>
              {showDate ? `${showDate} · ` : ''}
              {time}
            </Text>
            {place ? <Text style={s.sub}>· {place}</Text> : null}
            {repeats ? <Text style={s.repeat}>· 🔁 Repeats</Text> : null}
            {cancelled ? <Text style={s.cancelled}>· Cancelled</Text> : null}
          </View>
        </View>
      </Pressable>
      {open ? (
        <View style={s.details}>
          {meeting.recurrenceRule ? (
            <Text style={s.detailText}>🔁 {recurrenceSummary(meeting.recurrenceRule)}</Text>
          ) : repeats ? (
            <Text style={s.detailText}>🔁 Part of a repeating series</Text>
          ) : null}
          {meeting.location?.trim() && meeting.onlineLink?.trim() ? <Text style={s.detailText}>Also online</Text> : null}
          {description ? <Text style={s.detailText}>{description}</Text> : null}
          {!description && !repeats ? <Text style={s.muted}>No notes for this meeting.</Text> : null}
          {link && !cancelled ? (
            <Button title="Join online meeting" variant="secondary" onPress={() => void Linking.openURL(link).catch(() => {})} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    row: { backgroundColor: c.surface, borderRadius: radius.md, borderWidth: 1, borderColor: c.line, overflow: 'hidden' },
    cancelledRow: { opacity: 0.75 },
    head: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, gap: spacing.md, minHeight: 56 },
    pressed: { opacity: 0.7 },
    when: { width: 28, alignItems: 'center' },
    icon: { fontSize: fontSize.lg },
    body: { flex: 1 },
    title: { fontSize: fontSize.md, fontWeight: '600', color: c.ink },
    struck: { textDecorationLine: 'line-through', color: c.ink2 },
    meta: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 2 },
    time: { fontSize: fontSize.xs, color: c.brand, fontWeight: '700' },
    sub: { fontSize: fontSize.xs, color: c.ink2, marginLeft: 4 },
    repeat: { fontSize: fontSize.xs, color: c.ink2, marginLeft: 4, fontWeight: '600' },
    cancelled: { fontSize: fontSize.xs, color: c.danger, marginLeft: 4, fontWeight: '700' },
    details: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.md, borderTopWidth: 1, borderTopColor: c.line, paddingTop: spacing.sm },
    detailText: { fontSize: fontSize.sm, color: c.ink, lineHeight: 20 },
    muted: { fontSize: fontSize.sm, color: c.ink3 },
  });
