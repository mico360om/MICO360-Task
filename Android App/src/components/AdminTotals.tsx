import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useColors } from '../core/theme';
import { useAdminTotals } from '../core/project-queries';
import { ErrorNote } from './ui';
import { completionBars } from '../lib/project-list';
import { statusBars } from '../lib/reports';
import { toneStyle } from '../lib/tone';
import { categoryColorOf, spacing, radius, fontSize, type Palette } from '../lib/theme';
import { font } from '../lib/typography';

/**
 * The administrators' Dashboard charts (5b), as the website's: the tasks by status, and each
 * project's completion coloured by how healthy it is. Their All tasks and Overdue are the Dashboard's
 * top tiles (Stage 2). It shows the last copy offline.
 */
export function AdminTotals() {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const q = useAdminTotals(true);
  const rows = q.data?.projects ?? [];
  const status = statusBars(q.data?.status ?? {});
  const bars = completionBars(rows);
  const ready = !!q.data;

  return (
    <View style={s.wrap}>
      {q.isError && !q.data ? <ErrorNote message="Couldn’t load the totals for all projects." onRetry={() => void q.refetch()} retrying={q.isRefetching} /> : null}
      {ready ? (
        <View style={s.card}>
          <Text style={s.cardTitle} accessibilityRole="header">
            Tasks by status
          </Text>
          {status.length === 0 ? <Text style={s.muted}>No tasks yet.</Text> : null}
          {status.map((b) => (
            <View key={b.category} style={s.barRow} accessible accessibilityLabel={`${b.label}: ${b.value} tasks`}>
              <Text style={s.barLabel} numberOfLines={2}>
                {b.label}
              </Text>
              <View style={s.track}>
                <View style={[s.fill, { width: `${b.pct}%`, backgroundColor: categoryColorOf(c, b.category) }]} />
              </View>
              <Text style={s.barNum}>{b.value}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {ready ? (
        <View style={s.card}>
          <Text style={s.cardTitle} accessibilityRole="header">
            Project completion
          </Text>
          {bars.length === 0 ? <Text style={s.muted}>No projects yet.</Text> : null}
          {bars.map((b) => (
            <View key={b.id} style={s.barRow} accessible accessibilityLabel={`${b.label}: ${b.pct}% complete`}>
              <Text style={s.barLabel} numberOfLines={2}>
                {b.label}
              </Text>
              <View style={s.track}>
                <View style={[s.fill, { width: `${Math.min(100, b.pct)}%`, backgroundColor: toneStyle(c, b.tone).fg }]} />
              </View>
              <Text style={s.barNum}>{b.pct}%</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    wrap: { gap: spacing.md },
    card: { backgroundColor: c.surface, borderRadius: radius.card, borderWidth: 1, borderColor: c.line, padding: spacing.lg, gap: spacing.sm },
    cardTitle: { fontSize: fontSize.sm, ...font('700'), letterSpacing: 1, textTransform: 'uppercase', color: c.ink2 },
    muted: { fontSize: fontSize.sm, color: c.ink2 },
    barRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 32 },
    barLabel: { width: '34%', fontSize: fontSize.sm, color: c.ink },
    track: { flex: 1, height: 8, borderRadius: radius.pill, backgroundColor: c.ground, overflow: 'hidden' },
    fill: { height: 8, borderRadius: radius.pill },
    barNum: { minWidth: 36, textAlign: 'right', fontSize: fontSize.sm, ...font('700'), color: c.ink2 },
  });
