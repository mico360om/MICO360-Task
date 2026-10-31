import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, type TextInput } from 'react-native';
import { useColors } from '../core/theme';
import { spacing, radius, fontSize, type Palette } from '../lib/theme';
import type { RecurrenceRule } from '../lib/types';
import { recurrenceSummary, upcomingDates, WEEK_OF_MONTH, WEEKDAY_NAMES } from '../lib/recurrence-summary';
import {
  FREQS, FREQ_LABEL, UNIT_LABEL, DAY_NAMES, pickFreq, withInterval, toggleWeekday, withMonthlyMode, withNth, withDayOfMonth,
  withEnds, endsMode, withCreateNext, togglePaused,
} from '../lib/recurrence-edit';
import { parseDueDateInput } from '../lib/form-input';
import { formatDueDay } from '../lib/due-date';
import { dueFieldValue } from '../lib/task-detail';
import { TextField } from './ui';
import { Icon } from './Icon';
import { font } from '../lib/typography';

/**
 * The repeat editor (daily / weekly / monthly / quarterly / yearly, "every N", weekdays, "the 2nd
 * Tuesday", how it ends, when copies are made, pause). Each change is reported at once; the rule
 * logic lives in lib/recurrence-edit.ts and the dates in lib/recurrence.ts (shared with the API).
 * For a meeting series (`kind="meeting"`) every meeting is created ahead, so there is no "next
 * copy" choice and no pause, and it ends after a number of meetings. A scheduled inspection
 * (`kind="check"`, Stage 4) is the same: every check is made on its date, done or not, and it ends
 * after a number of checks. `hideFrequency`: the schedule's preset chose the frequency;
 * `endsOnly`: only how it ends (Every day, Every working day).
 */
export function RecurrenceEditor({
  value,
  onChange,
  dueDate,
  disabled = false,
  kind = 'task',
  untilRef,
  hideFrequency = false,
  endsOnly = false,
  allowNone = false,
}: {
  value: RecurrenceRule | null;
  onChange: (rule: RecurrenceRule | null) => void;
  /** The "Last date" field, so a form can put the cursor there for a problem with it (4a review). */
  untilRef?: React.RefObject<TextInput>;
  /** The task's due date ('YYYY-MM-DD' or ISO): previews the next dates and suggests "the 2nd Tuesday". */
  dueDate?: string | null;
  disabled?: boolean;
  kind?: 'task' | 'meeting' | 'check';
  /** The frequency was chosen elsewhere (a schedule's preset): no frequency chips. */
  hideFrequency?: boolean;
  /** Only how the repeat ends (a preset chose the rest). */
  endsOnly?: boolean;
  /** A check that may also not repeat (a task with an inspection form — Stage 4): "No repeat" stays offered. */
  allowNone?: boolean;
}) {
  const meeting = kind === 'meeting';
  const check = kind === 'check';
  /** No "next copy" choice and no pause: a meeting series and a scheduled check. */
  const fixedCopies = kind !== 'task';
  const counted = (n: number | null | undefined) => (meeting ? (n === 1 ? 'meeting' : 'meetings') : check ? (n === 1 ? 'check' : 'checks') : 'copies');
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const rule = value;
  const dueKey = dueFieldValue(dueDate);
  const savedUntil = rule?.until ? String(rule.until).slice(0, 10) : '';
  const [untilText, setUntilText] = useState(savedUntil);
  const [untilErr, setUntilErr] = useState<string | null>(null);
  // The last date follows the rule shown — a reload, a refused save, a change made elsewhere.
  useEffect(() => setUntilText(savedUntil), [savedUntil]);

  const set = (next: RecurrenceRule | null) => {
    if (!disabled) onChange(next);
  };
  /** A frequency chip: the one already chosen changes nothing (its days stay, nothing is saved). */
  const pick = (next: RecurrenceRule | null | undefined) => {
    if (next !== undefined) set(next);
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
      {hideFrequency || endsOnly ? null : (
        <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Repeat">
          {check && !allowNone ? null : chip('NONE', 'No repeat', !rule, () => pick(pickFreq(rule, 'NONE')), 'Does not repeat')}
          {FREQS.map((f) => chip(f, FREQ_LABEL[f], rule?.freq === f, () => pick(pickFreq(rule, f)), `Repeat ${FREQ_LABEL[f].toLowerCase()}`))}
        </View>
      )}

      {rule ? (
        <>
          {/* A meeting's form says how its series repeats, from its first meeting's day and time. */}
          {meeting || check ? null : (
            <View style={styles.row}>
              <Icon name="kit.repeat" size={14} color={c.brandText} />
              <Text style={[styles.summary, styles.shrink]}>{recurrenceSummary(rule)}</Text>
            </View>
          )}

          {endsOnly ? null : (
          <View style={styles.row}>
            <Text style={styles.label}>Every</Text>
            {stepper('Repeat every', `${rule.interval} ${UNIT_LABEL[rule.freq]}`, () => set(withInterval(rule, rule.interval - 1)), () => set(withInterval(rule, rule.interval + 1)))}
          </View>
          )}

          {rule.freq === 'WEEKLY' && !endsOnly ? (
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

          {monthBased && !endsOnly ? (
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
                    rule.dayOfMonth ? (rule.dayOfMonth === 31 ? 'last day' : String(rule.dayOfMonth)) : meeting ? 'its day' : 'due day',
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
            {chip('COUNT', 'After…', endsMode(rule) === 'COUNT', () => set(withEnds(rule, 'COUNT')), `Ends after a number of ${counted(2)}`)}
            {chip('UNTIL', 'On a date', endsMode(rule) === 'UNTIL', () => {
              setUntilText(dueKey);
              set(withEnds(rule, 'UNTIL', dueKey || null));
            }, 'Ends on a date')}
          </View>
          {endsMode(rule) === 'COUNT' ? (
            <View style={styles.row}>
              {stepper(`Number of ${counted(2)}`, `${rule.count} ${counted(rule.count)}`, () => set({ ...rule, count: Math.max(1, (rule.count ?? 1) - 1), until: null }), () => set({ ...rule, count: (rule.count ?? 0) + 1, until: null }))}
            </View>
          ) : null}
          {endsMode(rule) === 'UNTIL' ? (
            <TextField
              label="Last date"
              inputRef={untilRef}
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

          {fixedCopies ? null : (
            <>
              <Text style={styles.label}>Create the next copy</Text>
              <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Create the next copy">
                {chip('ON_COMPLETE', 'When this one is done', rule.createNext !== 'ON_SCHEDULE', () => set(withCreateNext(rule, 'ON_COMPLETE')))}
                {chip('ON_SCHEDULE', 'On each date', rule.createNext === 'ON_SCHEDULE', () => set(withCreateNext(rule, 'ON_SCHEDULE')), 'On each date, even if not done')}
              </View>
            </>
          )}

          {preview.length > 0 ? <Text style={styles.preview}>Next: {preview.map((d) => formatDueDay(d, 'UTC', { weekday: 'short', year: false }) ?? d).join(' · ')}</Text> : null}

          {check ? <Text style={styles.label}>Each check is made on its date, done or not.</Text> : null}

          {fixedCopies ? null : (
            <Pressable onPress={() => set(togglePaused(rule))} disabled={disabled} accessibilityRole="button" style={[styles.chip, styles.pause]}>
              <Icon name={rule.paused ? 'kit.play' : 'kit.pause'} size={12} color={c.ink2} />
              <Text style={styles.chipText}>{rule.paused ? 'Resume series' : 'Pause series'}</Text>
            </Pressable>
          )}
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
    chipText: { fontSize: fontSize.sm, color: c.ink2, ...font('600') },
    chipTextActive: { color: c.brandText },
    summary: { fontSize: fontSize.sm, color: c.brandText, ...font('600') },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    label: { fontSize: fontSize.sm, color: c.ink2 },
    stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    stepBtn: { width: 36, height: 36, borderRadius: radius.pill, borderWidth: 1, borderColor: c.line, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface },
    stepText: { fontSize: fontSize.lg, color: c.ink, ...font('700') },
    stepValue: { minWidth: 90, textAlign: 'center', fontSize: fontSize.sm, color: c.ink, ...font('600') },
    preview: { fontSize: fontSize.xs, color: c.ink3 },
    pause: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6 },
    shrink: { flexShrink: 1 },
  });
