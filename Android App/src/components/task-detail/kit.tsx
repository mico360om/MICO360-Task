import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, type ViewStyle } from 'react-native';
import { useColors } from '../../core/theme';
import { isNetworkError } from '../../lib/api-client';
import { spacing, radius, fontSize, type Palette } from '../../lib/theme';

export type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved' }
  /** Offline: kept on this phone and sent when there's a connection. */
  | { status: 'queued' }
  | { status: 'error'; message: string };

/** The message for a failed action: the server's reason when it gave one. */
export function failureText(e: unknown, fallback: string): string {
  if (isNetworkError(e)) return 'You’re offline — this needs a connection. Please try again.';
  return e instanceof Error && e.message ? e.message : fallback;
}

/**
 * The saving → saved / queued / error state of one change. `run` awaits it and says whether it
 * went through, so the caller can keep what the user typed when it didn't. With `queueable`, being
 * offline is fine: the app's sync queue sends it later.
 */
export function useSave() {
  const [state, setState] = useState<SaveState>({ status: 'idle' });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const run = useCallback(async (save: () => Promise<unknown> | unknown, fallback: string, queueable = false): Promise<boolean> => {
    if (timer.current) clearTimeout(timer.current);
    setState({ status: 'saving' });
    try {
      await save();
      setState({ status: 'saved' });
      timer.current = setTimeout(() => setState({ status: 'idle' }), 2500);
      return true;
    } catch (e) {
      if (queueable && isNetworkError(e)) {
        setState({ status: 'queued' });
        return true;
      }
      setState({ status: 'error', message: failureText(e, fallback) });
      return false;
    }
  }, []);
  const fail = useCallback((message: string) => setState({ status: 'error', message }), []);
  const reset = useCallback(() => setState({ status: 'idle' }), []);
  return { state, run, fail, reset, busy: state.status === 'saving' };
}

/** "Saving…" / "✓ Saved" / "Will sync when you're online" (announced), or the error (an alert). */
export function SaveNote({ state }: { state: SaveState }) {
  const c = useColors();
  if (state.status === 'idle') return null;
  if (state.status === 'error') {
    return (
      <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ marginTop: spacing.xs, fontSize: fontSize.sm, color: c.danger, fontWeight: '600' }}>
        {state.message}
      </Text>
    );
  }
  const text = state.status === 'saving' ? 'Saving…' : state.status === 'saved' ? '✓ Saved' : 'Saved on this phone — will sync when you’re online';
  const color = state.status === 'saved' ? c.success : c.ink3;
  return (
    <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs }}>
      {state.status === 'saving' ? <ActivityIndicator size="small" color={c.ink3} /> : null}
      <Text style={{ fontSize: fontSize.xs, color, fontWeight: '600' }}>{text}</Text>
    </View>
  );
}

/** A titled card section; `right` sits beside the title. */
export function SectionCard({ title, right, children, style }: { title: string; right?: React.ReactNode; children: React.ReactNode; style?: ViewStyle }) {
  const s = useKitStyles();
  return (
    <View style={[s.card, style]}>
      <View style={s.cardHead}>
        <Text style={s.cardTitle} accessibilityRole="header">
          {title}
        </Text>
        {right ? <View style={s.cardRight}>{right}</View> : null}
      </View>
      {children}
    </View>
  );
}

/** A round 44dp icon button with a text glyph. */
export function IconButton({ glyph, label, onPress, disabled, tone = 'muted' }: { glyph: string; label: string; onPress: () => void; disabled?: boolean; tone?: 'muted' | 'danger' | 'brand' }) {
  const c = useColors();
  const color = tone === 'danger' ? c.danger : tone === 'brand' ? c.brand : c.ink2;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      hitSlop={4}
      style={({ pressed }) => ({ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, opacity: disabled ? 0.35 : pressed ? 0.6 : 1 })}
    >
      <Text style={{ fontSize: fontSize.lg, color, fontWeight: '700' }}>{glyph}</Text>
    </Pressable>
  );
}

/** A selectable chip (status, priority, scope…) with an optional colour dot. */
export function Chip({ label, selected, onPress, dot, disabled, a11yLabel }: { label: string; selected?: boolean; onPress?: () => void; dot?: string; disabled?: boolean; a11yLabel?: string }) {
  const s = useKitStyles();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || !onPress}
      accessibilityRole={onPress ? 'radio' : 'text'}
      accessibilityLabel={a11yLabel ?? label}
      accessibilityState={{ selected: !!selected, checked: !!selected, disabled: !!disabled }}
      style={({ pressed }) => [s.chip, selected && s.chipOn, pressed && { opacity: 0.7 }]}
    >
      {dot ? <View style={[s.dot, { backgroundColor: dot }]} /> : null}
      <Text style={[s.chipText, selected && s.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

/** A small read-only label pill. */
export function Tag({ label, color, tone }: { label: string; color?: string; tone?: 'danger' }) {
  const c = useColors();
  const s = useKitStyles();
  const fg = tone === 'danger' ? c.danger : color ?? c.ink2;
  const bg = tone === 'danger' ? c.dangerSoft : c.ground;
  return (
    <View style={[s.tag, { backgroundColor: bg }]}>
      {color && tone !== 'danger' ? <View style={[s.dot, { backgroundColor: color }]} /> : null}
      <Text style={[s.tagText, { color: tone === 'danger' ? fg : c.ink }]}>{label}</Text>
    </View>
  );
}

/** "3m ago", "2h ago", "5d ago", else a short date. */
export function relativeTime(iso: string, now = Date.now()): string {
  const s = Math.round((now - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function useKitStyles() {
  const c = useColors();
  return useMemo(() => makeStyles(c), [c]);
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    card: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
    cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 32 },
    cardTitle: { flex: 1, fontSize: fontSize.xs, fontWeight: '800', color: c.ink2, textTransform: 'uppercase', letterSpacing: 0.8 },
    cardRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      minHeight: 40,
      borderWidth: 1,
      borderColor: c.line,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.md,
      backgroundColor: c.surface,
    },
    chipOn: { borderColor: c.brand, backgroundColor: c.brandWash },
    chipText: { fontSize: fontSize.sm, color: c.ink, fontWeight: '600' },
    chipTextOn: { color: c.brand },
    dot: { width: 9, height: 9, borderRadius: 5 },
    tag: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 3 },
    tagText: { fontSize: fontSize.xs, fontWeight: '700' },
  });
