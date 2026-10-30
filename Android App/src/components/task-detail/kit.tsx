import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, type ViewStyle } from 'react-native';
import { useColors } from '../../core/theme';
import { isNetworkError } from '../../lib/api-client';
import { keptOnPhoneText } from '../../lib/write-order';
import { spacing, radius, fontSize, type Palette } from '../../lib/theme';
import { font } from '../../lib/typography';
import { Icon } from '../Icon';

export type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved' }
  /** Kept on this phone and sent later; `message` says why (offline, no answer, waiting behind another change). */
  | { status: 'queued'; message?: string }
  | { status: 'error'; message: string };

/** The message for a failed action: the server's reason when it gave one. */
import { failureText } from '../../lib/task-detail';

export { failureText };

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
        setState({ status: 'queued', message: keptOnPhoneText(e) });
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

/** "Saving…" / "Saved" (with the check) / "Will sync when you're online" (announced), or the error (an alert). */
export function SaveNote({ state }: { state: SaveState }) {
  const c = useColors();
  if (state.status === 'idle') return null;
  if (state.status === 'error') {
    return (
      <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ marginTop: spacing.xs, fontSize: fontSize.sm, color: c.dangerText, ...font('600') }}>
        {state.message}
      </Text>
    );
  }
  const text = state.status === 'saving' ? 'Saving…' : state.status === 'saved' ? 'Saved' : state.message ?? 'Saved on this phone — will sync when you’re online.';
  const color = state.status === 'saved' ? c.successText : c.ink3;
  return (
    <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs }}>
      {state.status === 'saving' ? <ActivityIndicator size="small" color={c.ink3} /> : null}
      {state.status === 'saved' ? <Icon name="misc.check" size={14} color={color} /> : null}
      <Text style={{ fontSize: fontSize.xs, color, ...font('600') }}>{text}</Text>
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

/** The selectable chip is the app's shared one (status, priority, scope…, with an optional colour dot). */
export { Chip } from '../ui';

/** A small read-only label pill. */
export function Tag({ label, color, tone }: { label: string; color?: string; tone?: 'danger' }) {
  const c = useColors();
  const s = useKitStyles();
  const fg = tone === 'danger' ? c.dangerText : color ?? c.ink2;
  const bg = tone === 'danger' ? c.dangerSoft : c.ground;
  return (
    <View style={[s.tag, { backgroundColor: bg }]}>
      {color && tone !== 'danger' ? <View style={[s.dot, { backgroundColor: color }]} /> : null}
      <Text style={[s.tagText, { color: tone === 'danger' ? fg : c.ink }]}>{label}</Text>
    </View>
  );
}

/** "3m ago", "2h ago", "5d ago", else the day — the app's one (the website's words, company dates: final review B3). */
export { relativeTime } from '../../lib/relative-time';

export function useKitStyles() {
  const c = useColors();
  return useMemo(() => makeStyles(c), [c]);
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    card: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: radius.card, padding: spacing.md, gap: spacing.sm },
    cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 32 },
    cardTitle: { flex: 1, fontSize: fontSize.xs, ...font('800'), color: c.ink2, textTransform: 'uppercase', letterSpacing: 0.8 },
    cardRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    dot: { width: 9, height: 9, borderRadius: 5 },
    tag: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: radius.badge, paddingHorizontal: spacing.sm, paddingVertical: 3 },
    tagText: { fontSize: fontSize.xs, ...font('700') },
  });
