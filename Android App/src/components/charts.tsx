import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, type LayoutChangeEvent } from 'react-native';
import { useColors } from '../core/theme';
import {
  barPct,
  barsSummary,
  chartRows,
  chartSummary,
  dashedLine,
  gridValues,
  lineSegments,
  niceCeil,
  sampleWithPeaks,
  type Segment,
} from '../lib/chart';
import { spacing, radius, fontSize, type Palette } from '../lib/theme';

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
  values: number[];
  color: string;
  /** Shade the area under the line. */
  area?: boolean;
  /** A dashed reference line. */
  dashed?: boolean;
}

const PLOT_HEIGHT = 160;
/** At most this many points of a line are drawn (the numbers list every day). */
const MAX_POINTS = 60;

/**
 * A line chart: the scale's values beside the plot, grid lines, the lines, the first and last day, a
 * key. The plot is drawn left to right on any phone (an Arabic phone mirrors layouts, not charts);
 * the values sit in their own column — never under the lines, never above the plot at a large font
 * (5c review #13). Kept as it is while the screen re-renders with the same lines (typing a date).
 */
export const LineChart = React.memo(function LineChart({ title, labels, lines, days }: { title: string; labels: string[]; lines: Line[]; days?: string[] }) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const [width, setWidth] = useState(0);
  const [showNumbers, setShowNumbers] = useState(false);
  const series = useMemo(() => lines.map((l) => ({ name: l.name, values: l.values })), [lines]);
  const summary = chartSummary(title, labels, series);

  const n = Math.max(labels.length, ...lines.map((l) => l.values.length), 0);
  // The points drawn, each line's highest and lowest kept (a spike the summary names stays in sight).
  const idx = useMemo(() => sampleWithPeaks(n, MAX_POINTS, lines.map((l) => l.values)), [n, lines]);
  if (n === 0 || !lines.some((l) => l.values.length > 0)) {
    return (
      <Text style={s.noData} accessibilityLabel={summary}>
        No data to chart yet.
      </Text>
    );
  }
  const top = niceCeil(Math.max(1, ...lines.flatMap((l) => l.values)));
  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));
  const y = (v: number) => (1 - v / top) * PLOT_HEIGHT;

  return (
    <View style={s.lineWrap}>
      <View accessible accessibilityRole="image" accessibilityLabel={summary}>
        <View style={s.plotRow} importantForAccessibility="no-hide-descendants">
          <View style={s.gutter}>
            {[...gridValues(top)].reverse().map((v, i) => (
              <Text key={`v${i}`} style={s.gridLabel} numberOfLines={1}>
                {v}
              </Text>
            ))}
          </View>
          <View style={s.flex}>
            <View style={s.plot} onLayout={onLayout}>
              {gridValues(top).map((v, i) => (
                <View key={`g${i}`} style={[s.grid, { top: y(v) }]} />
              ))}
              {width > 0
                ? lines.map((l) => (
                    <React.Fragment key={l.name}>
                      {l.area ? <Area values={l.values} idx={idx} width={width} top={top} color={l.color} /> : null}
                      {pieces(l, idx, width, top).map((seg, i) => (
                        <View key={i} style={[s.seg, place(seg), { backgroundColor: l.color }]} />
                      ))}
                      {!l.dashed && l.values.length > 0 ? (
                        <View
                          style={[
                            s.end,
                            { backgroundColor: l.color, left: (n <= 1 ? width / 2 : width) - 4, top: y(l.values[l.values.length - 1] ?? 0) - 4 },
                          ]}
                        />
                      ) : null}
                    </React.Fragment>
                  ))
                : null}
            </View>
            <View style={s.axis}>
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
      <Pressable
        onPress={() => setShowNumbers((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: showNumbers }}
        accessibilityLabel={`${showNumbers ? 'Hide' : 'Show'} the numbers for ${title}`}
        style={({ pressed }) => [s.numbersButton, pressed && s.pressed]}
      >
        <Text style={s.numbersButtonText}>{showNumbers ? 'Hide the numbers' : 'Show the numbers'}</Text>
      </Pressable>
      {showNumbers ? (
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

/** A line's pieces: straight, or cut into one run of dashes that carries on across the pieces. */
function pieces(l: Line, idx: number[], width: number, top: number): Segment[] {
  const segs = lineSegments(l.values, idx, { width, height: PLOT_HEIGHT, top, thickness: 2 });
  return l.dashed ? dashedLine(segs) : segs;
}

/** Where a piece goes: placed by its corner, then turned about its centre. */
const place = (seg: Segment) => ({ left: seg.left, top: seg.top, width: seg.width, height: seg.height, transform: [{ rotate: `${seg.angle}rad` }] });

/** The shaded area under a line: a faint column under each drawn point. */
function Area({ values, idx, width, top, color }: { values: number[]; idx: number[]; width: number; top: number; color: string }) {
  const n = values.length;
  const col = idx.length > 1 ? width / (idx.length - 1) : width;
  return (
    <>
      {idx.map((i) => {
        const v = Math.max(0, values[i] ?? 0);
        const h = (v / top) * PLOT_HEIGHT;
        const x = n <= 1 ? width / 2 : (i / (n - 1)) * width;
        const left = Math.max(0, x - col / 2);
        const right = Math.min(width, x + col / 2);
        return <View key={i} style={{ position: 'absolute', left, width: Math.max(0, right - left), top: PLOT_HEIGHT - h, height: h, backgroundColor: color, opacity: 0.1 }} />;
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
    barLabel: { flex: 1, fontSize: fontSize.sm, fontWeight: '600', color: c.ink2, textAlign: 'auto' },
    barValue: { fontSize: fontSize.sm, fontWeight: '700', color: c.ink },
    track: { height: 10, borderRadius: radius.pill, backgroundColor: c.ground, overflow: 'hidden' },
    fill: { height: '100%', borderRadius: radius.pill },
    lineWrap: { gap: spacing.sm },
    flex: { flex: 1 },
    // Charts read left to right on every phone (5c review #13).
    plotRow: { flexDirection: 'row', direction: 'ltr', gap: spacing.xs, marginTop: spacing.md },
    gutter: { height: PLOT_HEIGHT, justifyContent: 'space-between', alignItems: 'flex-end', minWidth: 24 },
    plot: { height: PLOT_HEIGHT, borderBottomWidth: 1, borderBottomColor: c.line },
    grid: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: c.line },
    gridLabel: { fontSize: fontSize.xs, color: c.ink2, textAlign: 'right' },
    seg: { position: 'absolute', borderRadius: 1 },
    end: { position: 'absolute', width: 8, height: 8, borderRadius: 4 },
    axis: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm, marginTop: 4 },
    axisLabel: { fontSize: fontSize.xs, color: c.ink2 },
    legend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.xs },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    swatch: { width: 14, height: 4, borderRadius: 2 },
    swatchDashed: { width: 6 },
    legendText: { fontSize: fontSize.xs, color: c.ink2 },
    numbersButton: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
    numbersButtonText: { fontSize: fontSize.sm, fontWeight: '700', color: c.brand },
    table: { gap: 2, backgroundColor: c.ground, borderRadius: radius.md, padding: spacing.sm },
    tableRow: { fontSize: fontSize.xs, color: c.ink },
    tableDay: { fontWeight: '700' },
  });
