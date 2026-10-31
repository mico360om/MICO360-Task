import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, I18nManager, type LayoutChangeEvent } from 'react-native';
import { useColors } from '../core/theme';
import {
  alignRight,
  barPct,
  barsSummary,
  chartRow,
  chartRows,
  chartSummary,
  dashedLine,
  gridValues,
  lineRuns,
  lineSegments,
  niceCeil,
  placeSegment,
  plotLeft,
  sampleWithPeaks,
  type ChartDirection,
  type Segment,
} from '../lib/chart';
import { spacing, radius, fontSize, type Palette } from '../lib/theme';
import { font } from '../lib/typography';

/**
 * The Reports charts (5c), drawn with plain views (no chart or SVG package in the app; the rules
 * are in lib/chart). A bar chart is a list — TalkBack reads each bar as "label: value". A line
 * chart is read as a summary of each line, and "Show the numbers" lists every day under it.
 */

export interface Bar {
  label: string;
  value: number;
  color?: string;
}

/** Horizontal bars, each a share of the largest; the label and number above the bar, so any font size fits. */
export function BarChart({ title, data, unit = '' }: { title: string; data: Bar[]; unit?: string }) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  if (data.length === 0) {
    return (
      <Text style={s.noData} accessibilityLabel={barsSummary(title, data)}>
        No data to chart yet.
      </Text>
    );
  }
  const values = data.map((d) => d.value);
  return (
    <View style={s.bars}>
      {data.map((d, i) => (
        <View key={`${d.label}-${i}`} style={s.barRow} accessible accessibilityLabel={`${d.label}: ${d.value}${unit}`}>
          <View style={s.barHead}>
            <Text style={s.barLabel}>{d.label}</Text>
            <Text style={s.barValue}>
              {d.value}
              {unit}
            </Text>
          </View>
          <View style={s.track}>
            <View style={[s.fill, { width: `${barPct(d.value, values)}%`, backgroundColor: d.color ?? c.brand }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

export interface Line {
  name: string;
  /** One value per day or week; null: no figure there — a gap, never drawn across (Management's pass rate). */
  values: readonly (number | null)[];
  color: string;
  /** Shade the area under the line. */
  area?: boolean;
  /** A dashed reference line. */
  dashed?: boolean;
  /** A dot on each point (a line with gaps always has them, as on the website). */
  dots?: boolean;
}

const PLOT_HEIGHT = 160;
/** At most this many points of a line are drawn (the numbers list every day). */
const MAX_POINTS = 60;

/** The phone's layout direction (lib/chart ChartDirection): it changes only with a restart of the app. */
const dir: ChartDirection = { rtl: I18nManager.isRTL, swapsLeft: I18nManager.isRTL && I18nManager.doLeftAndRightSwapInRTL !== false };

/**
 * A line chart: the scale's values beside the plot, grid lines, the lines, the first and last day, a
 * key. The plot is drawn left to right on any phone (an Arabic phone mirrors layouts, not charts:
 * lib/chart's chartRow and plotLeft undo Android's mirroring, 6b review); the values sit in their own
 * column — never under the lines, never above the plot at a large font (5c review #13). Kept as it
 * is while the screen re-renders with the same lines (typing a date).
 *
 * Stage 3 (Management's trends): a null value is a gap — each unbroken run is drawn on its own (a
 * lone value as a dot) and gaps are left out of the scale; `unit` follows the scale's numbers
 * ("50%"); `label` says the chart in the page's own words instead of the summary made here, and
 * `numbers={false}` leaves out "Show the numbers" where a table of them is right below.
 */
export const LineChart = React.memo(function LineChart({
  title,
  labels,
  lines,
  days,
  unit = '',
  label,
  numbers = true,
}: {
  title: string;
  labels: string[];
  lines: Line[];
  days?: string[];
  unit?: string;
  label?: string;
  numbers?: boolean;
}) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const [width, setWidth] = useState(0);
  const [showNumbers, setShowNumbers] = useState(false);
  const series = useMemo(() => lines.map((l) => ({ name: l.name, values: l.values })), [lines]);
  const summary = label ?? chartSummary(title, labels, series);

  const n = Math.max(labels.length, ...lines.map((l) => l.values.length), 0);
  // The points drawn, each line's highest and lowest kept (a spike the summary names stays in sight).
  const idx = useMemo(() => sampleWithPeaks(n, MAX_POINTS, lines.map((l) => l.values)), [n, lines]);
  if (n === 0 || !lines.some((l) => l.values.some((v) => v !== null))) {
    return (
      <Text style={s.noData} accessibilityLabel={summary}>
        No data to chart yet.
      </Text>
    );
  }
  // Gaps are not zeros: they stay out of the scale.
  const top = niceCeil(Math.max(1, ...lines.flatMap((l) => l.values.filter((v): v is number => v !== null))));
  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));
  const y = (v: number) => (1 - v / top) * PLOT_HEIGHT;
  const x = (i: number) => (n <= 1 ? width / 2 : (i / (n - 1)) * width);
  const kept = new Set(idx);
  const col = idx.length > 1 ? width / (idx.length - 1) : width;

  return (
    <View style={s.lineWrap}>
      <View accessible accessibilityRole="image" accessibilityLabel={summary}>
        <View style={[s.plotRow, { flexDirection: chartRow(dir) }]} importantForAccessibility="no-hide-descendants">
          <View style={[s.gutter, { alignItems: alignRight(dir) }]}>
            {[...gridValues(top)].reverse().map((v, i) => (
              <Text key={`v${i}`} style={s.gridLabel} numberOfLines={1}>
                {v}
                {unit}
              </Text>
            ))}
          </View>
          <View style={s.flex}>
            <View style={s.plot} onLayout={onLayout}>
              {gridValues(top).map((v, i) => (
                <View key={`g${i}`} style={[s.grid, { top: y(v) }]} />
              ))}
              {width > 0
                ? lines.map((l) => {
                    const runs = lineRuns(l.values);
                    // Each run's own points: the sampled ones, and always its first and last.
                    const drawn = runs.map((run) => run.filter((i) => kept.has(i) || i === run[0] || i === run[run.length - 1]));
                    const last = runs.length ? runs[runs.length - 1]![runs[runs.length - 1]!.length - 1]! : null;
                    const gaps = l.values.some((v) => v === null);
                    const dotted = l.dots || gaps;
                    // Without gaps every point is drawn as before (a one-day range keeps its dot and shading).
                    const lined = gaps ? drawn.filter((r) => r.length > 1) : drawn;
                    return (
                      <React.Fragment key={l.name}>
                        {l.area ? <Area values={l.values} cols={lined.flat()} col={col} n={n} width={width} top={top} color={l.color} /> : null}
                        {pieces(l, lined, width, top).map((seg, i) => (
                          <View key={i} style={[s.seg, placeSegment(seg, width, dir), { backgroundColor: l.color }]} />
                        ))}
                        {dotted
                          ? drawn.flat().map((i) => (
                              <View key={`d${i}`} style={[s.dot, { backgroundColor: l.color, left: plotLeft(x(i) - DOT / 2, DOT, width, dir), top: y(l.values[i] ?? 0) - DOT / 2 }]} />
                            ))
                          : !l.dashed && last !== null ? (
                              <View
                                style={[
                                  s.end,
                                  {
                                    backgroundColor: l.color,
                                    left: plotLeft(x(last) - END_DOT / 2, END_DOT, width, dir),
                                    top: y(l.values[last] ?? 0) - END_DOT / 2,
                                  },
                                ]}
                              />
                            ) : null}
                      </React.Fragment>
                    );
                  })
                : null}
            </View>
            <View style={[s.axis, { flexDirection: chartRow(dir) }]}>
              <Text style={s.axisLabel}>{labels[0]}</Text>
              {labels.length > 1 ? <Text style={s.axisLabel}>{labels[labels.length - 1]}</Text> : null}
            </View>
          </View>
        </View>
        <View style={s.legend} importantForAccessibility="no-hide-descendants">
          {lines.map((l) => (
            <View key={l.name} style={s.legendItem}>
              <View style={[s.swatch, { backgroundColor: l.color }, l.dashed && s.swatchDashed]} />
              <Text style={s.legendText}>
                {l.name}
                {l.dashed ? ' (dashed)' : ''}
              </Text>
            </View>
          ))}
        </View>
      </View>
      {numbers ? (
        <Pressable
          onPress={() => setShowNumbers((v) => !v)}
          accessibilityRole="button"
          accessibilityState={{ expanded: showNumbers }}
          accessibilityLabel={`${showNumbers ? 'Hide' : 'Show'} the numbers for ${title}`}
          style={({ pressed }) => [s.numbersButton, pressed && s.pressed]}
        >
          <Text style={s.numbersButtonText}>{showNumbers ? 'Hide the numbers' : 'Show the numbers'}</Text>
        </Pressable>
      ) : null}
      {numbers && showNumbers ? (
        <View style={s.table}>
          {chartRows(labels, series, days).map((r) => (
            <Text key={r.key} style={s.tableRow}>
              <Text style={s.tableDay}>{r.label}: </Text>
              {r.text}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
});

/**
 * A line's pieces: each run between gaps on its own (in a line with gaps a lone value has none —
 * its dot shows it), straight or cut into one run of dashes that carries on across the pieces.
 */
function pieces(l: Line, runs: number[][], width: number, top: number): Segment[] {
  const segs = runs.flatMap((run) => lineSegments(l.values, run, { width, height: PLOT_HEIGHT, top, thickness: 2 }));
  return l.dashed ? dashedLine(segs) : segs;
}

/** The dot at a line's last point. */
const END_DOT = 8;
/** The dots on every point of a line with gaps (or `dots`). */
const DOT = 6;

/** The shaded area under a line: a faint column under each drawn point of a run (`col` wide). */
function Area({ values, cols, col, n, width, top, color }: { values: readonly (number | null)[]; cols: number[]; col: number; n: number; width: number; top: number; color: string }) {
  return (
    <>
      {cols.map((i) => {
        const v = Math.max(0, values[i] ?? 0);
        const h = (v / top) * PLOT_HEIGHT;
        const x = n <= 1 ? width / 2 : (i / (n - 1)) * width;
        const left = Math.max(0, x - col / 2);
        const w = Math.max(0, Math.min(width, x + col / 2) - left);
        return <View key={i} style={{ position: 'absolute', left: plotLeft(left, w, width, dir), width: w, top: PLOT_HEIGHT - h, height: h, backgroundColor: color, opacity: 0.1 }} />;
      })}
    </>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    noData: { fontSize: fontSize.sm, color: c.ink2, textAlign: 'center', paddingVertical: spacing.lg },
    pressed: { opacity: 0.7 },
    bars: { gap: spacing.sm },
    barRow: { gap: 4 },
    barHead: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
    // Names in Arabic read right to left (Android picks the direction from the text).
    barLabel: { flex: 1, fontSize: fontSize.sm, ...font('600'), color: c.ink2, textAlign: 'auto' },
    barValue: { fontSize: fontSize.sm, ...font('700'), color: c.ink },
    track: { height: 10, borderRadius: radius.pill, backgroundColor: c.ground, overflow: 'hidden' },
    fill: { height: '100%', borderRadius: radius.pill },
    lineWrap: { gap: spacing.sm },
    flex: { flex: 1 },
    // Charts read left to right on every phone (5c review #13): the row's direction and the gutter's
    // alignment are set with the phone's direction (chartRow, alignRight).
    plotRow: { gap: spacing.xs, marginTop: spacing.md },
    gutter: { height: PLOT_HEIGHT, justifyContent: 'space-between', minWidth: 24 },
    plot: { height: PLOT_HEIGHT, borderBottomWidth: 1, borderBottomColor: c.line },
    grid: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: c.line },
    gridLabel: { fontSize: fontSize.xs, color: c.ink2, textAlign: 'right' },
    seg: { position: 'absolute', borderRadius: 1 },
    end: { position: 'absolute', width: 8, height: 8, borderRadius: 4 },
    dot: { position: 'absolute', width: 6, height: 6, borderRadius: 3 },
    axis: { justifyContent: 'space-between', gap: spacing.sm, marginTop: 4 },
    axisLabel: { fontSize: fontSize.xs, color: c.ink2 },
    legend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.xs },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    swatch: { width: 14, height: 4, borderRadius: 2 },
    swatchDashed: { width: 6 },
    legendText: { fontSize: fontSize.xs, color: c.ink2 },
    numbersButton: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
    numbersButtonText: { fontSize: fontSize.sm, ...font('700'), color: c.brandText },
    table: { gap: 2, backgroundColor: c.ground, borderRadius: radius.input, padding: spacing.sm },
    tableRow: { fontSize: fontSize.xs, color: c.ink },
    tableDay: { ...font('700') },
  });
