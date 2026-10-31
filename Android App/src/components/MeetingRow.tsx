import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { spacing, radius, fontSize, type Palette } from '../lib/theme';
import { useColors } from '../core/theme';
import { isRepeating, meetingPlace, meetingRowLabel, meetingTime } from '../lib/meetings';
import type { ApiMeeting } from '../lib/types';
import { font } from '../lib/typography';
import { Icon } from './Icon';
import { capLines } from './ui/text-lines';

type RowMeeting = Pick<ApiMeeting, 'id' | 'title' | 'status' | 'startAt' | 'endAt' | 'location' | 'onlineLink' | 'recurrenceRule' | 'recurrenceParentId'>;

/**
 * A meeting in a list (the calendar, a project): its time, title, place and whether it repeats.
 * Tapping it opens the meeting — its agenda, people, notes and minutes, and Join for an online one.
 * Its time is in the company's zone unless `timeZone` says otherwise (the calendar shows your own).
 */
export function MeetingRow({ meeting, showDate, timeZone, onPress }: { meeting: RowMeeting; showDate?: string; timeZone?: string; onPress: () => void }) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const cancelled = meeting.status === 'CANCELLED';
  const place = meetingPlace(meeting);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={meetingRowLabel(meeting, { showDate, timeZone })}
      accessibilityHint="Opens the meeting"
      style={({ pressed }) => [s.row, cancelled && s.cancelledRow, pressed && s.pressed]}
    >
      <View style={s.when}>
        <Icon name="kit.calendar" size={20} color={c.meeting} />
      </View>
      <View style={s.body}>
        <Text style={[s.title, cancelled && s.struck]} numberOfLines={capLines(2)}>
          {meeting.title}
        </Text>
        <View style={s.meta}>
          <Text style={s.time}>
            {showDate ? `${showDate} · ` : ''}
            {meetingTime(meeting, timeZone)}
          </Text>
          {place ? <Text style={s.sub}>· {place}</Text> : null}
          {isRepeating(meeting) ? (
            <View style={s.repeatRow}>
              <Text style={s.repeat}>·</Text>
              <Icon name="kit.repeat" size={12} color={c.ink2} />
              <Text style={s.repeat}>Repeats</Text>
            </View>
          ) : null}
          {cancelled ? <Text style={s.cancelled}>· Cancelled</Text> : null}
        </View>
      </View>
      <Icon name="ui.chevron" size={18} color={c.ink3} rotate={270} />
    </Pressable>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: spacing.md,
      gap: spacing.md,
      minHeight: 56,
      backgroundColor: c.surface,
      borderRadius: radius.input,
      borderWidth: 1,
      borderColor: c.line,
    },
    cancelledRow: { opacity: 0.75 },
    pressed: { opacity: 0.7 },
    when: { width: 28, alignItems: 'center' },
    body: { flex: 1 },
    // An Arabic title reads right to left on its own line (Android picks the direction from the text).
    title: { fontSize: fontSize.md, ...font('600'), color: c.ink, textAlign: 'auto' },
    struck: { textDecorationLine: 'line-through', color: c.ink2 },
    meta: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 2 },
    time: { fontSize: fontSize.xs, color: c.brandText, ...font('700') },
    sub: { fontSize: fontSize.xs, color: c.ink2, marginLeft: 4 },
    repeatRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: 4 },
    repeat: { fontSize: fontSize.xs, color: c.ink2, ...font('600') },
    cancelled: { fontSize: fontSize.xs, color: c.dangerText, marginLeft: 4, ...font('700') },
  });
