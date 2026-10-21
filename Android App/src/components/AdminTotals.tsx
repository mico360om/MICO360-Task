import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useColors } from '../core/theme';
import { useAdminTotals } from '../core/project-queries';
import { ErrorNote, SectionTitle } from './ui';
import { adminTotals, completionBars } from '../lib/project-list';
import { statusBars } from '../lib/reports';
import { toneStyle } from '../lib/tone';
import { categoryColorOf, spacing, radius, fontSize, type Palette } from '../lib/theme';

/**
 * Home for administrators (5b), as the website's dashboard: all tasks and the overdue ones across
 * every project (each opens Reports), the tasks by status, and each project's completion coloured
 * by how healthy it is. It shows the last copy offline.
 */
export function AdminTotals({ onOpenReports }: { onOpenReports: () => void }) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const q = useAdminTotals(true);
  const rows = q.data?.projects ?? [];
  const tiles = adminTotals(rows);
  const status = statusBars(q.data?.status ?? {});
  const bars = completionBars(rows);
  const ready = !!q.data;

  return (
    <View style={s.wrap}>
      <SectionTitle>Across all projects</SectionTitle>
      {q.isError && !q.data ? <ErrorNote message="Couldn’t load the totals for all projects." onRetry={() => void q.refetch()} retrying={q.isRefetching} /> : null}
      <View style={s.tiles}>
        {tiles.map((t) => (
          <Pressable
            key={t.key}
            onPress={onOpenReports}
            accessibilityRole="button"
            accessibilityLabel={`${t.label}: ${ready ? t.value : 'loading'}${ready && t.hint ? `, ${t.hint}` : ''}`}
            accessibilityHint="Opens Reports"
            style={({ pressed }) => [s.tile, pressed && s.pressed]}
          >
            <Text style={[s.tileValue, { color: toneStyle(c, t.tone).fg }]}>{ready ? t.value : '—'}</Text>
            <Text style={s.tileLabel}>{t.label}</Text>
            {ready && t.hint ? <Text style={s.tileHint}>{t.hint}</Text> : null}
          </Pressable>
        ))}
      </View>

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
    wrap: { gap: spacing.sm },
    pressed: { opacity: 0.7 },
    tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    tile: { flexGrow: 1, flexBasis: '47%', backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: c.line, padding: spacing.lg },
    tileValue: { fontSize: fontSize.xxl, fontWeight: '800' },
    tileLabel: { fontSize: fontSize.sm, color: c.ink2, marginTop: 2 },
    tileHint: { fontSize: fontSize.xs, color: c.ink3 },
    card: { backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: c.line, padding: spacing.lg, gap: spacing.sm },
    cardTitle: { fontSize: fontSize.sm, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: c.ink2 },
    muted: { fontSize: fontSize.sm, color: c.ink2 },
    barRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 32 },
    barLabel: { width: '34%', fontSize: fontSize.sm, color: c.ink },
    track: { flex: 1, height: 8, borderRadius: radius.pill, backgroundColor: c.ground, overflow: 'hidden' },
    fill: { height: 8, borderRadius: radius.pill },
    barNum: { minWidth: 36, textAlign: 'right', fontSize: fontSize.sm, fontWeight: '700', color: c.ink2 },
  });
