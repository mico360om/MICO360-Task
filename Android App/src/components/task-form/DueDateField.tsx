import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useColors } from '../../core/theme';
import { DayPicker } from '../calendar/CalendarSheets';
import { FieldLabel } from '../meeting/sheet-kit';
import { fullDayLabel, shiftDayKey, type WeekStart } from '../../lib/calendar';
import { spacing, radius, fontSize } from '../../lib/theme';

/**
 * The due date (4a): the day shown in words, and — once tapped — a month to pick it from, with
 * Today, Tomorrow and In a week one tap away (the calendar's day picker; no date-picker package).
 * "No due date" clears it. Company calendar days, as the website's date box.
 */
export function DueDateField({
  value,
  onChange,
  today,
  weekStart,
  disabled,
  label = 'Due date (optional)',
}: {
  /** The field's label; null when the screen labels it itself (the task's details). */
  label?: string | null;
  /** 'YYYY-MM-DD', or '' for none. */
  value: string;
  onChange: (day: string) => void;
  today: string;
  weekStart: WeekStart;
  disabled?: boolean;
}) {
  const c = useColors();
  const [open, setOpen] = useState(false);
  const shown = value ? fullDayLabel(value) : 'No due date';
  return (
    <View style={styles.wrap}>
      {label ? <FieldLabel>{label}</FieldLabel> : null}
      <View style={styles.row}>
        <Pressable
          onPress={() => setOpen((v) => !v)}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={`Due date: ${shown}`}
          accessibilityHint={open ? 'Closes the calendar' : 'Opens a calendar to pick the day'}
          accessibilityState={{ expanded: open, disabled: !!disabled }}
          style={({ pressed }) => [styles.field, { borderColor: c.line, backgroundColor: c.surface }, pressed && styles.pressed, disabled && styles.disabled]}
        >
          <Text style={[styles.value, { color: value ? c.ink : c.ink3 }]}>📅 {shown}</Text>
          <Text style={{ color: c.ink3 }} importantForAccessibility="no">
            {open ? '▴' : '▾'}
          </Text>
        </Pressable>
        {value ? (
          <Pressable
            onPress={() => {
              onChange('');
              setOpen(false);
            }}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel="Clear the due date"
            style={({ pressed }) => [styles.clear, { borderColor: c.line }, pressed && styles.pressed]}
          >
            <Text style={[styles.clearText, { color: c.ink2 }]}>Clear</Text>
          </Pressable>
        ) : null}
      </View>
      {open && !disabled ? (
        <DayPicker
          value={value || null}
          onChange={(day) => {
            onChange(day);
            setOpen(false);
          }}
          today={today}
          weekStart={weekStart}
          quick={[
            { label: 'Today', day: today },
            { label: 'Tomorrow', day: shiftDayKey(today, 1) },
            { label: 'In a week', day: shiftDayKey(today, 7) },
          ]}
          hint="Sets the due date"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs, marginBottom: spacing.md },
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  field: { flex: 1, flexDirection: 'row', alignItems: 'center', minHeight: 48, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md },
  value: { flex: 1, fontSize: fontSize.md },
  clear: { minHeight: 48, minWidth: 64, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md },
  clearText: { fontSize: fontSize.sm, fontWeight: '700' },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },
});
