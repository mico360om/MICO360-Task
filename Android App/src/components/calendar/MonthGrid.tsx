import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useColors } from '../../core/theme';
import { monthOf, monthWeeks, weekdayLabels, type WeekStart } from '../../lib/calendar';
import { dayCellLabel, type CalStatus } from '../../lib/calendar-model';
import { spacing, radius, fontSize, type Palette } from '../../lib/theme';

export interface DayMarks {
  /** The statuses of the day's tasks, most urgent first (up to three show as dots). */
  tasks: CalStatus[];
  meetings: number;
}

/** A status's dot colour — never the only sign: the day's label and the list say it in words. */
export function statusColor(c: Palette, s: CalStatus): string {
  switch (s) {
    case 'overdue':
      return c.danger;
    case 'blocked':
      return c.warning;
    case 'in-progress':
      return c.info;
    case 'done':
      return c.success;
    case 'projected':
      return c.ink2;
    default:
      return c.ink3;
  }
}

/**
 * A month as a grid of days (the website's phone month): small day buttons with dots for what is
 * on them, today marked and the chosen day filled in. Tapping a day picks it. The weekday names
 * are hidden from TalkBack — each day says its own weekday, what it holds and whether it is today.
 */
export function MonthGrid({
  cursor,
  weekStart,
  today,
  selected,
  onPick,
  marks,
  outlined,
  outlinedWord,
  label,
  hint,
}: {
  /** Any day of the month shown. */
  cursor: string;
  weekStart: WeekStart;
  today: string;
  selected: string | null;
  onPick: (day: string) => void;
  marks?: (day: string) => DayMarks;
  /** A day ringed for another reason (the task's day now, when moving it). */
  outlined?: string | null;
  outlinedWord?: string;
  /** What TalkBack calls the grid (the month). */
  label: string;
  hint?: string;
}) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const { year, month0 } = monthOf(cursor);
  const weeks = useMemo(() => monthWeeks(year, month0, weekStart), [year, month0, weekStart]);
  return (
    <View style={s.grid} accessibilityLabel={label}>
      <View style={s.row} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {weekdayLabels(weekStart).map((l) => (
          <Text key={l} style={s.weekday} maxFontSizeMultiplier={1.3}>
            {l.slice(0, 2)}
          </Text>
        ))}
      </View>
      {weeks.map((week) => (
        <View key={week[0]!.key} style={s.row}>
          {week.map((cell) => {
            const m = marks?.(cell.key) ?? { tasks: [], meetings: 0 };
            const isToday = cell.key === today;
            const isChosen = cell.key === selected;
            const ringed = cell.key === outlined;
            const dots = [...Array.from({ length: Math.min(3, m.meetings) }, () => 'meeting' as const), ...m.tasks].slice(0, 3);
            const words = dayCellLabel(cell.key, { tasks: m.tasks.length, meetings: m.meetings, today: isToday });
            return (
              <Pressable
                key={cell.key}
                onPress={() => onPick(cell.key)}
                accessibilityRole="button"
                accessibilityLabel={ringed && outlinedWord ? `${words}, ${outlinedWord}` : words}
                accessibilityHint={hint}
                accessibilityState={{ selected: isChosen }}
                style={({ pressed }) => [s.cell, isToday && s.todayCell, ringed && s.ringed, isChosen && s.chosen, pressed && s.pressed]}
              >
                <Text
                  style={[s.day, !cell.inMonth && s.outside, isToday && s.todayText, isChosen && s.chosenText]}
                  maxFontSizeMultiplier={1.4}
                  importantForAccessibility="no"
                >
                  {cell.day}
                </Text>
                <View style={s.dots} importantForAccessibility="no-hide-descendants">
                  {dots.map((d, i) =>
                    d === 'meeting' ? (
                      <View key={i} style={[s.dot, s.meetingDot, isChosen && s.dotOnChosen]} />
                    ) : (
                      <View
                        key={i}
                        style={[s.dot, d === 'projected' ? s.projectedDot : { backgroundColor: statusColor(c, d) }, isChosen && d !== 'projected' && s.dotOnChosen]}
                      />
                    ),
                  )}
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    grid: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: radius.md, padding: 2, gap: 2 },
    row: { flexDirection: 'row' },
    weekday: { flex: 1, textAlign: 'center', fontSize: fontSize.xs, fontWeight: '700', color: c.ink2, paddingVertical: spacing.xs },
    cell: { flex: 1, minHeight: 48, margin: 1, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', gap: 3, paddingVertical: 2 },
    todayCell: { backgroundColor: c.brandWash },
    ringed: { borderWidth: 1.5, borderColor: c.ink2, borderStyle: 'dashed' },
    chosen: { backgroundColor: c.brand },
    pressed: { opacity: 0.7 },
    day: { fontSize: fontSize.md, fontWeight: '600', color: c.ink },
    outside: { color: c.ink3 },
    todayText: { color: c.brand, fontWeight: '800' },
    chosenText: { color: c.onBrand },
    dots: { flexDirection: 'row', gap: 3, height: 6, alignItems: 'center' },
    dot: { width: 6, height: 6, borderRadius: 3 },
    meetingDot: { backgroundColor: c.brand, borderRadius: 1, transform: [{ rotate: '45deg' }] },
    projectedDot: { borderWidth: 1, borderColor: c.ink2, borderStyle: 'dashed', backgroundColor: 'transparent' },
    dotOnChosen: { backgroundColor: c.onBrand },
  });
