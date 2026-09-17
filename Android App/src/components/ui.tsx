import React, { useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  type ViewStyle,
  type TextStyle,
  type TextProps,
  type TextInputProps,
} from 'react-native';
import { spacing, radius, fontSize, type Palette } from '../lib/theme';
import { typeStyle, type TypeRole } from '../lib/typography';
import { toneStyle, type Tone } from '../lib/tone';
import { useColors } from '../core/theme';

/** Build the themed stylesheet for the current palette. */
function makeStyles(c: Palette) {
  return StyleSheet.create({
    card: {
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.line,
      padding: spacing.lg,
    },
    sectionTitle: {
      ...typeStyle('label'),
      letterSpacing: 1,
      textTransform: 'uppercase',
      color: c.ink2,
      marginBottom: spacing.sm,
    },
    heading: { ...typeStyle('title'), color: c.ink },
    muted: { ...typeStyle('label'), fontWeight: '400', color: c.ink2 },
    btn: {
      minHeight: 48,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.lg,
    },
    btnPrimary: { backgroundColor: c.brand },
    btnSecondary: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.brand },
    btnGhost: { backgroundColor: 'transparent' },
    btnPressed: { opacity: 0.7 },
    btnText: { ...typeStyle('bodyStrong'), color: c.onBrand },
    btnTextDark: { color: c.brand },
    fieldWrap: { marginBottom: spacing.md },
    fieldLabel: { ...typeStyle('label'), color: c.ink, marginBottom: spacing.xs },
    input: {
      minHeight: 48,
      borderWidth: 1,
      borderColor: c.line,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      fontSize: fontSize.md,
      color: c.ink,
      backgroundColor: c.surface,
    },
    inputError: { borderColor: c.danger },
    fieldError: { color: c.danger, fontSize: fontSize.xs, marginTop: spacing.xs },
    badgeText: { ...typeStyle('caption'), fontWeight: '700' },
    badgeSolidText: { ...typeStyle('caption'), fontWeight: '700', color: c.onBrand },
    pillText: { ...typeStyle('caption'), fontWeight: '600' },
    loader: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
    empty: { alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, gap: spacing.sm },
    emptyTitle: { ...typeStyle('heading'), color: c.ink },
    errorNote: {
      backgroundColor: c.errorWash,
      borderWidth: 1,
      borderColor: c.danger,
      borderRadius: radius.md,
      padding: spacing.md,
      marginBottom: spacing.md,
    },
    errorNoteText: { color: c.danger, fontSize: fontSize.sm, fontWeight: '500' },
    badge: { borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3, alignSelf: 'flex-start' },
    pill: { borderRadius: radius.pill, borderWidth: 1, paddingHorizontal: spacing.sm, paddingVertical: 2, alignSelf: 'flex-start' },
  });
}

/** Hook: the themed UI stylesheet, recomputed when the palette changes. */
export function useUiStyles() {
  const c = useColors();
  return useMemo(() => makeStyles(c), [c]);
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const s = useUiStyles();
  return <View style={[s.card, style]}>{children}</View>;
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  const s = useUiStyles();
  return <Text style={s.sectionTitle}>{children}</Text>;
}

export function Heading({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  const s = useUiStyles();
  return <Text style={[s.heading, style]}>{children}</Text>;
}

export function Muted({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  const s = useUiStyles();
  return <Text style={[s.muted, style]}>{children}</Text>;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading,
  disabled,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const c = useColors();
  const s = useUiStyles();
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.btn,
        variant === 'primary' && s.btnPrimary,
        variant === 'secondary' && s.btnSecondary,
        variant === 'ghost' && s.btnGhost,
        (pressed || isDisabled) && s.btnPressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? c.onBrand : c.brand} />
      ) : (
        <Text style={[s.btnText, variant !== 'primary' && s.btnTextDark]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function TextField({
  label,
  error,
  required,
  style,
  ...props
}: TextInputProps & { label?: string; error?: string | null; required?: boolean }) {
  const c = useColors();
  const s = useUiStyles();
  return (
    <View style={s.fieldWrap}>
      {label ? (
        <Text style={s.fieldLabel}>
          {label}
          {required ? <Text style={{ color: c.danger }}> *</Text> : null}
        </Text>
      ) : null}
      <TextInput
        placeholderTextColor={c.ink3}
        style={[s.input, error ? s.inputError : null, style]}
        {...props}
      />
      {error ? <Text style={s.fieldError}>{error}</Text> : null}
    </View>
  );
}

/**
 * Semantic badge: a soft-filled pill whose colors come from the tone (neutral/brand/success/
 * warning/info/danger), theme-aware in light & dark. Pass an explicit `color` for a solid,
 * white-on-color badge (e.g. a Kanban category color).
 */
export function Badge({ label, tone = 'neutral', color }: { label: string; tone?: Tone; color?: string }) {
  const c = useColors();
  const s = useUiStyles();
  if (color) {
    return (
      <View style={[s.badge, { backgroundColor: color }]}>
        <Text style={s.badgeSolidText}>{label}</Text>
      </View>
    );
  }
  const t = toneStyle(c, tone);
  return (
    <View style={[s.badge, { backgroundColor: t.bg }]}>
      <Text style={[s.badgeText, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

/** Outlined pill; tinted by tone, or an explicit `color`. */
export function Pill({ label, tone, color }: { label: string; tone?: Tone; color?: string }) {
  const c = useColors();
  const s = useUiStyles();
  const tint = color ?? (tone ? toneStyle(c, tone).fg : c.ink2);
  return (
    <View style={[s.pill, { borderColor: tint }]}>
      <Text style={[s.pillText, { color: tint }]}>{label}</Text>
    </View>
  );
}

/**
 * Typographic text primitive: applies a role from the type scale (display/title/heading/…),
 * colored by `tone` or an explicit `color` (defaults to ink). The design-system replacement for
 * ad-hoc `<Text style={{ fontSize, fontWeight }}>`.
 */
export function AppText({
  variant = 'body',
  color,
  tone,
  style,
  children,
  ...rest
}: TextProps & { variant?: TypeRole; color?: string; tone?: Tone; children: React.ReactNode }) {
  const c = useColors();
  const resolved = tone ? toneStyle(c, tone).fg : color ?? c.ink;
  return (
    <Text style={[typeStyle(variant), { color: resolved }, style]} {...rest}>
      {children}
    </Text>
  );
}

export function Loader() {
  const c = useColors();
  const s = useUiStyles();
  return (
    <View style={s.loader}>
      <ActivityIndicator color={c.brand} size="large" />
    </View>
  );
}

export function EmptyState({ title, subtitle }: { title: string; subtitle?: string }) {
  const s = useUiStyles();
  return (
    <View style={s.empty}>
      <Text style={s.emptyTitle}>{title}</Text>
      {subtitle ? <Muted style={{ textAlign: 'center' }}>{subtitle}</Muted> : null}
    </View>
  );
}

export function ErrorNote({ message }: { message: string }) {
  const s = useUiStyles();
  return (
    <View style={s.errorNote}>
      <Text style={s.errorNoteText}>{message}</Text>
    </View>
  );
}
