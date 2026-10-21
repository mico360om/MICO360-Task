import React, { useMemo } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useColors } from '../../core/theme';
import { toneStyle, type Tone } from '../../lib/tone';
import type { StatTile } from '../../lib/project-dashboard';
import { spacing, radius, fontSize, type Palette } from '../../lib/theme';

/**
 * The pieces a project's dashboard is made of (5b), as on the website's project dashboard: a card
 * with a heading and an action, a thin progress bar that says its value, the stat tiles, a text
 * button, and the tabs.
 */

export function useProjectStyles() {
  const c = useColors();
  return useMemo(() => makeStyles(c), [c]);
}

/** A card with a heading (read as one) and an optional action on the right. */
export function SectionCard({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  const s = useProjectStyles();
  return (
    <View style={s.card}>
      <View style={s.cardHead}>
        <Text style={s.cardTitle} accessibilityRole="header">
          {title}
        </Text>
        {action}
      </View>
      {children}
    </View>
  );
}

/** A small text button ("All 4", "Manage team"). */
export function LinkButton({ label, onPress, a11y }: { label: string; onPress: () => void; a11y?: string }) {
  const s = useProjectStyles();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={a11y ?? label} hitSlop={8} style={({ pressed }) => [s.link, pressed && s.pressed]}>
      <Text style={s.linkText}>{label}</Text>
    </Pressable>
  );
}

/** A quiet note in place of an empty list. */
export function EmptyNote({ children }: { children: React.ReactNode }) {
  const s = useProjectStyles();
  return <Text style={s.empty}>{children}</Text>;
}

/** A thin bar (0–100) that TalkBack reads as "<label>, N percent". */
export function ProgressBar({ value, label, tone = 'brand' }: { value: number; label: string; tone?: Tone }) {
  const c = useColors();
  const s = useProjectStyles();
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <View style={s.track} accessible accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 0, max: 100, now: v, text: `${v}%` }}>
      <View style={[s.fill, { width: `${v}%`, backgroundColor: toneStyle(c, tone).fg }]} />
    </View>
  );
}

/** The five stat tiles: two to a row on a phone, the fifth across its row. */
export function StatTiles({ tiles }: { tiles: StatTile[] }) {
  const c = useColors();
  const s = useProjectStyles();
  return (
    <View style={s.tiles}>
      {tiles.map((t, i) => (
        <View
          key={t.key}
          style={[s.tile, i === tiles.length - 1 && tiles.length % 2 === 1 && s.tileWide]}
          accessible
          accessibilityLabel={`${t.label}: ${t.value === '—' ? 'loading' : t.value}${t.hint ? `, ${t.hint}` : ''}`}
        >
          <Text style={[s.tileValue, { color: t.tone === 'neutral' ? c.ink : toneStyle(c, t.tone).fg }]}>{t.value}</Text>
          <Text style={s.tileLabel}>{t.label}</Text>
          {t.hint ? <Text style={s.tileHint}>{t.hint}</Text> : null}
        </View>
      ))}
    </View>
  );
}

export interface TabItem<T extends string> {
  value: T;
  label: string;
  count?: number;
}

/** The dashboard's tabs: they scroll sideways when large text doesn't fit them on one line. */
export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: TabItem<T>[]; value: T; onChange: (v: T) => void; label: string }) {
  const s = useProjectStyles();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabs} accessibilityRole="tablist" accessibilityLabel={label}>
      {tabs.map((t) => {
        const on = t.value === value;
        return (
          <Pressable
            key={t.value}
            onPress={() => onChange(t.value)}
            accessibilityRole="tab"
            accessibilityLabel={t.count ? `${t.label}, ${t.count}` : t.label}
            accessibilityState={{ selected: on }}
            style={({ pressed }) => [s.tab, on && s.tabOn, pressed && s.pressed]}
          >
            <Text style={[s.tabText, on && s.tabTextOn]}>{t.label}</Text>
            {t.count ? (
              <View style={s.tabCount}>
                <Text style={s.tabCountText}>{t.count}</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** One of a few choices as chips that scroll sideways (the Tasks tab's filters). */
export function FilterChips<T extends string>({ options, value, onChange, label }: { options: { value: T; label: string; count: number; danger?: boolean }[]; value: T; onChange: (v: T) => void; label: string }) {
  const c = useColors();
  const s = useProjectStyles();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="radio"
            accessibilityLabel={`${o.label}, ${o.count}`}
            accessibilityState={{ selected: on, checked: on }}
            style={({ pressed }) => [s.chip, on && s.chipOn, pressed && s.pressed]}
          >
            <Text style={[s.chipText, on && s.chipTextOn, o.danger && !on ? { color: c.danger } : null]}>
              {o.label} <Text style={s.chipCount}>{o.count}</Text>
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    pressed: { opacity: 0.7 },
    card: { backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: c.line, padding: spacing.lg, gap: spacing.sm },
    cardHead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginBottom: spacing.xs },
    cardTitle: { fontSize: fontSize.sm, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: c.ink2, flexShrink: 1 },
    link: { minHeight: 40, justifyContent: 'center', paddingHorizontal: spacing.xs },
    linkText: { fontSize: fontSize.sm, fontWeight: '700', color: c.brand },
    empty: { fontSize: fontSize.sm, color: c.ink2, backgroundColor: c.ground, borderRadius: radius.md, padding: spacing.md },
    track: { height: 8, borderRadius: 4, backgroundColor: c.line, overflow: 'hidden' },
    fill: { height: 8, borderRadius: 4 },
    tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    tile: { flexGrow: 1, flexBasis: '45%', backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: c.line, padding: spacing.md },
    tileWide: { flexBasis: '100%' },
    tileValue: { fontSize: fontSize.xl, fontWeight: '800' },
    tileLabel: { fontSize: fontSize.sm, fontWeight: '600', color: c.ink2, marginTop: 2 },
    tileHint: { fontSize: fontSize.xs, color: c.ink3 },
    tabs: { gap: spacing.xs, borderBottomWidth: 1, borderBottomColor: c.line },
    tab: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 48, paddingHorizontal: spacing.md, borderBottomWidth: 3, borderBottomColor: 'transparent' },
    tabOn: { borderBottomColor: c.brand },
    tabText: { fontSize: fontSize.md, fontWeight: '600', color: c.ink2 },
    tabTextOn: { color: c.brand, fontWeight: '800' },
    tabCount: { backgroundColor: c.ground, borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 1 },
    tabCountText: { fontSize: fontSize.xs, fontWeight: '700', color: c.ink2 },
    chips: { gap: spacing.sm, paddingVertical: spacing.xs },
    chip: { minHeight: 40, justifyContent: 'center', borderWidth: 1, borderColor: c.line, borderRadius: radius.pill, paddingHorizontal: spacing.md, backgroundColor: c.surface },
    chipOn: { borderColor: c.brand, backgroundColor: c.brandWash },
    chipText: { fontSize: fontSize.sm, fontWeight: '600', color: c.ink },
    chipTextOn: { color: c.brand, fontWeight: '800' },
    chipCount: { color: c.ink3, fontWeight: '600' },
  });
