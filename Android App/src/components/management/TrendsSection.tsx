import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useColors } from '../../core/theme';
import { LineChart } from '../charts';
import { TREND_COLUMNS, trendCharts, trendNote, trendRowLabel, trendTableRows, trendToggleText } from '../../lib/management';
import type { TrendRow } from '../../lib/management-api';
import { radius, spacing, type Palette } from '../../lib/theme';
import { typeStyle } from '../../lib/typography';
import { Section } from './parts';

/**
 * Weekly trends over the chosen period (the website's TrendsSection.tsx): company weeks, the current
 * one last and still going — tasks created against completed, tasks late at each week's end and the
 * inspection pass rate (a gap where a week had no inspection), then the same figures in a table,
 * newest first. A quiet chart says so in words instead of drawing a flat line.
 */
export function TrendsSection({ weeks }: { weeks: TrendRow[] }) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const [all, setAll] = useState(false);
  const labels = useMemo(() => weeks.map((w) => w.label), [weeks]);
  const charts = useMemo(() => trendCharts(weeks), [weeks]);
  // The lines in this theme's colours (the chart keeps its drawing while they stay the same).
  const lines = useMemo(() => charts.map((chart) => chart.lines.map((l) => ({ ...l, color: c[l.color] }))), [charts, c]);

  return (
    <Section title="Trends" note={trendNote(weeks)}>
      {charts.map((chart, k) => (
        <View key={chart.title} style={s.chart}>
          <Text style={s.caption} accessibilityRole="header">
            {chart.title}
          </Text>
          {chart.empty ? <Text style={s.quiet}>{chart.empty}</Text> : <LineChart title={chart.title} label={chart.label} unit={chart.unit} numbers={false} labels={labels} lines={lines[k]!} />}
        </View>
      ))}

      <View style={s.table} accessibilityLabel="Weekly figures">
        <View style={[s.tr, s.thead]} importantForAccessibility="no-hide-descendants">
          {TREND_COLUMNS.map((col, i) => (
            <Text key={col.title} style={[s.th, i === 0 ? s.week : s.num, { flex: col.flex }]}>
              {col.title}
            </Text>
          ))}
        </View>
        {trendTableRows(weeks, all).map((w) => {
          return (
            <View key={w.start} style={[s.tr, s.row]} accessible accessibilityLabel={trendRowLabel(w)}>
              <Text style={[s.td, s.week, s.weekText, { flex: TREND_COLUMNS[0]!.flex }]}>{w.week}</Text>
              <Text style={[s.td, s.num, { flex: TREND_COLUMNS[1]!.flex }]}>{w.created}</Text>
              <Text style={[s.td, s.num, { flex: TREND_COLUMNS[2]!.flex }]}>{w.completed}</Text>
              <Text style={[s.td, s.num, { flex: TREND_COLUMNS[3]!.flex }, w.late ? s.late : null]}>{w.late}</Text>
              <Text style={[s.td, s.num, { flex: TREND_COLUMNS[4]!.flex }]}>{w.passRate === null ? '—' : `${w.passRate}%`}</Text>
            </View>
          );
        })}
      </View>
      {weeks.length > 6 ? (
        <Pressable onPress={() => setAll((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: all }} style={({ pressed }) => [s.toggle, pressed && s.pressed]}>
          <Text style={s.toggleText}>{trendToggleText(weeks.length, all)}</Text>
        </Pressable>
      ) : null}
    </Section>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    chart: { gap: spacing.xs },
    caption: { ...typeStyle('bodyStrong'), color: c.ink },
    quiet: { ...typeStyle('body'), color: c.ink2, textAlign: 'center', backgroundColor: c.ground, borderRadius: radius.input, paddingVertical: spacing.xl, paddingHorizontal: spacing.md },
    table: { borderWidth: 1, borderColor: c.line, borderRadius: radius.button, overflow: 'hidden' },
    tr: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, gap: spacing.xs },
    thead: { backgroundColor: c.surface2, paddingVertical: spacing.sm },
    row: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line, paddingVertical: spacing.xs + 2 },
    th: { ...typeStyle('eyebrow'), color: c.ink3 },
    td: { ...typeStyle('number'), fontSize: 13, color: c.ink },
    // Each column's share of the row is TREND_COLUMNS' (measured so no header breaks in a word at 360 dp).
    week: { minWidth: 0 },
    weekText: { ...typeStyle('label'), fontSize: 13 },
    num: { minWidth: 0, textAlign: 'right' },
    late: { color: c.dangerText },
    toggle: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
    toggleText: { ...typeStyle('button'), color: c.brandText },
    pressed: { opacity: 0.7 },
  });
