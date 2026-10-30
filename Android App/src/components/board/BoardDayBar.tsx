import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useColors } from '../../core/theme';
import { DayPicker } from '../calendar/CalendarSheets';
import { Sheet } from '../meeting/sheet-kit';
import { Icon } from '../Icon';
import { IconButton } from '../ui';
import { shiftKey, formatKeyLabel, relativeKeyHint } from '../../lib/board-date';
import { spacing, radius, fontSize, type Palette } from '../../lib/theme';
import type { WeekStart } from '../../lib/calendar';
import { font } from '../../lib/typography';

/**
 * A board's day (4b; the All projects board's too, 4c), as the website's date box: the day before
 * or after, the day itself — tapped, a calendar to pick it from — and "Today" when another day is
 * shown. `onChange(null)` goes back to today (the company's).
 */
export function BoardDayBar({ boardDate, todayKey, weekStart, onChange }: { boardDate: string; todayKey: string; weekStart: WeekStart; onChange: (day: string | null) => void }) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const [picking, setPicking] = useState(false);
  const hint = relativeKeyHint(boardDate, todayKey);
  return (
    <>
      <View style={s.dateBar}>
        <IconButton icon="ui.back" label="Previous day" variant="outlined" onPress={() => onChange(shiftKey(boardDate, -1))} />
        {/* The board's day, from a calendar (the website's date box). */}
        <Pressable
          style={({ pressed }) => [s.dateLabelWrap, pressed && s.pressed]}
          onPress={() => setPicking(true)}
          accessibilityRole="button"
          accessibilityLabel={`Board date: ${formatKeyLabel(boardDate)}${hint ? `, ${hint}` : ''}`}
          accessibilityHint="Opens a calendar to pick the day"
        >
          <Icon name="kit.calendar" size={16} color={c.ink2} />
          <Text style={s.dateLabel}>{formatKeyLabel(boardDate)}</Text>
          {hint ? <Text style={s.dateHint}>{hint}</Text> : null}
        </Pressable>
        <IconButton icon="ui.back" rotate={180} label="Next day" variant="outlined" onPress={() => onChange(shiftKey(boardDate, 1))} />
        {boardDate !== todayKey ? (
          <Pressable style={s.todayBtn} onPress={() => onChange(null)} accessibilityRole="button" accessibilityLabel="Jump to today">
            <Text style={s.todayBtnText}>Today</Text>
          </Pressable>
        ) : null}
      </View>

      <Sheet visible={picking} title="Board date" subtitle="Pick the day to show" onClose={() => setPicking(false)}>
        <DayPicker
          value={boardDate}
          onChange={(day) => {
            onChange(day === todayKey ? null : day);
            setPicking(false);
          }}
          today={todayKey}
          weekStart={weekStart}
          quick={[
            { label: 'Yesterday', day: shiftKey(todayKey, -1) },
            { label: 'Today', day: todayKey },
            { label: 'Tomorrow', day: shiftKey(todayKey, 1) },
          ]}
          hint="Shows this day's board"
        />
      </Sheet>
    </>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    pressed: { opacity: 0.6 },
    dateBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.md, flexWrap: 'wrap' },
    dateLabelWrap: { flex: 1, minHeight: 44, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, borderRadius: radius.input, paddingHorizontal: spacing.xs },
    dateLabel: { fontSize: fontSize.md, ...font('700'), color: c.ink },
    dateHint: { fontSize: fontSize.xs, ...font('700'), color: c.brandText, backgroundColor: c.surface, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill, overflow: 'hidden' },
    todayBtn: { minHeight: 44, justifyContent: 'center', borderWidth: 1, borderColor: c.line, borderRadius: radius.input, paddingHorizontal: spacing.md, backgroundColor: c.surface },
    todayBtnText: { fontSize: fontSize.sm, ...font('600'), color: c.ink },
  });
