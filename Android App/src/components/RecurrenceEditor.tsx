import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useColors } from '../core/theme';
import { spacing, radius, fontSize, type Palette } from '../lib/theme';
import type { RecurrenceRule } from '../lib/types';
import { recurrenceSummary, upcomingDates, WEEK_OF_MONTH, WEEKDAY_NAMES } from '../lib/recurrence-summary';
import {
  FREQS, FREQ_LABEL, UNIT_LABEL, DAY_NAMES, withFreq, withInterval, toggleWeekday, withMonthlyMode, withNth, withDayOfMonth,
  withEnds, endsMode, withCreateNext, togglePaused,
} from '../lib/recurrence-edit';
import { parseDueDateInput } from '../lib/form-input';
import { formatDueDay } from '../lib/due-date';
import { TextField } from './ui';

/**
 * The repeat editor (daily / weekly / monthly / quarterly / yearly, "every N", weekdays, "the 2nd
 * Tuesday", how it ends, when copies are made, pause). Each change is reported at once; the rule
 * logic lives in lib/recurrence-edit.ts and the dates in lib/recurrence.ts (shared with the API).
 */
export function RecurrenceEditor({
  value,
  onChange,
  dueDate,
  disabled = false,
}: {
  value: RecurrenceRule | null;
  onChange: (rule: RecurrenceRule | null) => void;
  /** The task's due date ('YYYY-MM-DD' or ISO): previews the next dates and suggests "the 2nd Tuesday". */
  dueDate?: string | null;
  disabled?: boolean;
}) {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const rule = value;
  const dueKey = dueDate ? dueDate.slice(0, 10) : '';
  const [untilText, setUntilText] = useState(rule?.until ? String(rule.until).slice(0, 10) : '');
  const [untilErr, setUntilErr] = useState<string | null>(null);

  const set = (next: RecurrenceRule | null) => {
    if (!disabled) onChange(next);
  };

  function chip(key: string, label: string, active: boolean, onPress: () => void, a11y?: string) {
    return (
      <Pressable
        key={key}
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="radio"
        accessibilityLabel={a11y ?? label}
        accessibilityState={{ selected: active, checked: active, disabled }}
        style={[styles.chip, active && styles.chipActive]}
      >
        <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
      </Pressable>
    );
  }

  function stepper(label: string, shown: string, onLess: () => void, onMore: () => void) {
    return (
      <View style={styles.stepper}>
        <Pressable onPress={onLess} disabled={disabled} accessibilityRole="button" accessibilityLabel={`${label}: fewer`} style={styles.stepBtn} hitSlop={6}>
          <Text style={styles.stepText}>−</Text>
        </Pressable>
        <Text style={styles.stepValue} accessibilityLabel={`${label}: ${shown}`}>{shown}</Text>
        <Pressable onPress={onMore} disabled={disabled} accessibilityRole="button" accessibilityLabel={`${label}: more`} style={styles.stepBtn} hitSlop={6}>
          <Text style={styles.stepText}>+</Text>
        </Pressable>
      </View>
    );
  }

  const preview = rule && !rule.paused && dueKey ? upcomingDates(dueKey, rule) : [];
  const monthBased = rule?.freq === 'MONTHLY' || rule?.freq === 'QUARTERLY';

  return (
    <View style={styles.wrap}>
      <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Repeat">
        {chip('NONE', 'No repeat', !rule, () => set(null), 'Does not repeat')}
        {FREQS.map((f) => chip(f, FREQ_LABEL[f], rule?.freq === f, () => set(withFreq(rule, f)), `Repeat ${FREQ_LABEL[f].toLowerCase()}`))}
      </View>

      {rule ? (
        <>
          <Text style={styles.summary}>🔁 {recurrenceSummary(rule)}</Text>

          <View style={styles.row}>
            <Text style={styles.label}>Every</Text>
            {stepper('Repeat every', `${rule.interval} ${UNIT_LABEL[rule.freq]}`, () => set(withInterval(rule, rule.interval - 1)), () => set(withInterval(rule, rule.interval + 1)))}
          </View>

          {rule.freq === 'WEEKLY' ? (
            <View style={styles.chips} accessibilityLabel="On these days">
              {DAY_NAMES.map((name, day) => {
                const on = (rule.weekdays ?? []).includes(day);
                return (
                  <Pressable
                    key={name}
                    onPress={() => set(toggleWeekday(rule, day))}
                    disabled={disabled}
                    accessibilityRole="checkbox"
                    accessibilityLabel={WEEKDAY_NAMES[day]}
                    accessibilityState={{ checked: on, disabled }}
                    style={[styles.chip, on && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, on && styles.chipTextActive]}>{name}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          {monthBased ? (
            <>
              <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Repeat on">
                {chip('DATE', 'A day of the month', !rule.nthWeekday, () => set(withMonthlyMode(rule, 'DATE', dueKey)))}
                {chip('WEEKDAY', 'A weekday of the month', !!rule.nthWeekday, () => set(withMonthlyMode(rule, 'WEEKDAY', dueKey)))}
              </View>
              {rule.nthWeekday ? (
                <>
                  <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Week of the month">
                    {WEEK_OF_MONTH.map((w) => chip(`w${w.week}`, w.label, rule.nthWeekday?.week === w.week, () => set(withNth(rule, { week: w.week })), `The ${w.label}`))}
                  </View>
                  <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Weekday">
                    {DAY_NAMES.map((name, day) => chip(`d${day}`, name, rule.nthWeekday?.day === day, () => set(withNth(rule, { day })), WEEKDAY_NAMES[day]))}
                  </View>
                </>
              ) : (
                <View style={styles.row}>
                  <Text style={styles.label}>Day</Text>
                  {stepper(
                    'Day of month',
                    rule.dayOfMonth ? (rule.dayOfMonth === 31 ? 'last day' : String(rule.dayOfMonth)) : 'due day',
                    () => set(withDayOfMonth(rule, (rule.dayOfMonth ?? 2) - 1)),
                    () => set(withDayOfMonth(rule, Math.min(31, (rule.dayOfMonth ?? 0) + 1))),
                  )}
                </View>
              )}
            </>
          ) : null}

          <Text style={styles.label}>Ends</Text>
          <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Ends">
            {chip('NEVER', 'Never', endsMode(rule) === 'NEVER', () => set(withEnds(rule, 'NEVER')), 'Never ends')}
            {chip('COUNT', 'After…', endsMode(rule) === 'COUNT', () => set(withEnds(rule, 'COUNT')), 'Ends after a number of copies')}
            {chip('UNTIL', 'On a date', endsMode(rule) === 'UNTIL', () => {
              setUntilText(dueKey);
              set(withEnds(rule, 'UNTIL', dueKey || null));
            }, 'Ends on a date')}
          </View>
          {endsMode(rule) === 'COUNT' ? (
            <View style={styles.row}>
              {stepper('Number of copies', `${rule.count} copies`, () => set({ ...rule, count: Math.max(1, (rule.count ?? 1) - 1), until: null }), () => set({ ...rule, count: (rule.count ?? 0) + 1, until: null }))}
            </View>
          ) : null}
          {endsMode(rule) === 'UNTIL' ? (
            <TextField
              label="Last date"
              value={untilText}
              onChangeText={(v) => {
                setUntilText(v);
                if (untilErr) setUntilErr(null);
              }}
              onBlur={() => {
                const r = parseDueDateInput(untilText);
                if (!r.ok || !r.value) {
                  setUntilErr(r.ok ? 'Enter the last date, YYYY-MM-DD.' : r.error);
                  return;
                }
                if (r.value !== rule.until) set({ ...rule, until: r.value, count: null });
              }}
              placeholder="YYYY-MM-DD"
              autoCapitalize="none"
              keyboardType="numbers-and-punctuation"
              maxLength={10}
              error={untilErr}
            />
          ) : null}

          <Text style={styles.label}>Create the next copy</Text>
          <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Create the next copy">
            {chip('ON_COMPLETE', 'When this one is done', rule.createNext !== 'ON_SCHEDULE', () => set(withCreateNext(rule, 'ON_COMPLETE')))}
            {chip('ON_SCHEDULE', 'On each date', rule.createNext === 'ON_SCHEDULE', () => set(withCreateNext(rule, 'ON_SCHEDULE')), 'On each date, even if not done')}
          </View>

          {preview.length > 0 ? <Text style={styles.preview}>Next: {preview.map((d) => formatDueDay(d) ?? d).join(' · ')}</Text> : null}

          <Pressable onPress={() => set(togglePaused(rule))} disabled={disabled} accessibilityRole="button" style={[styles.chip, styles.pause]}>
            <Text style={styles.chipText}>{rule.paused ? '▶ Resume series' : '⏸ Pause series'}</Text>
          </Pressable>
        </>
      ) : null}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    wrap: { gap: spacing.sm },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    chip: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs + 2,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: c.line,
      backgroundColor: c.surface,
      minHeight: 36,
      justifyContent: 'center',
    },
    chipActive: { borderColor: c.brand, backgroundColor: c.brandWash },
    chipText: { fontSize: fontSize.sm, color: c.ink2, fontWeight: '600' },
    chipTextActive: { color: c.brand },
    summary: { fontSize: fontSize.sm, color: c.brand, fontWeight: '600' },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    label: { fontSize: fontSize.sm, color: c.ink2 },
    stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    stepBtn: { width: 36, height: 36, borderRadius: radius.pill, borderWidth: 1, borderColor: c.line, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface },
    stepText: { fontSize: fontSize.lg, color: c.ink, fontWeight: '700' },
    stepValue: { minWidth: 90, textAlign: 'center', fontSize: fontSize.sm, color: c.ink, fontWeight: '600' },
    preview: { fontSize: fontSize.xs, color: c.ink3 },
    pause: { alignSelf: 'flex-start' },
  });
