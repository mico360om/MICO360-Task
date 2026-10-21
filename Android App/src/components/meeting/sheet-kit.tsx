import React, { useMemo, useState } from 'react';
import { Modal, View, Text, Pressable, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '../../core/theme';
import { KeyboardAwareScrollView } from '../KeyboardAware';
import { Button, TextField } from '../ui';
import { spacing, radius, fontSize, type Palette } from '../../lib/theme';

/**
 * The pieces the meeting's sheets are made of (2b): a bottom sheet whose fields scroll above the
 * keyboard with its buttons below, a choice of cards (which meetings of a series), a picker that
 * opens in place (no sheet over a sheet), chips and a checkbox row.
 */

export function useSheetStyles() {
  const c = useColors();
  return useMemo(() => makeStyles(c), [c]);
}

/** A bottom sheet: a title, fields that scroll (and stay above the keyboard), buttons below. */
export function Sheet({
  visible,
  title,
  subtitle,
  onClose,
  closeLabel,
  footer,
  children,
}: {
  visible: boolean;
  title: string;
  subtitle?: string | null;
  onClose: () => void;
  /** What TalkBack calls the area above the sheet that closes it. */
  closeLabel?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const s = useSheetStyles();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* On Android the modal's window already shrinks for the keyboard. */}
      <KeyboardAvoidingView style={s.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={s.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel={closeLabel ?? `Close ${title}`} />
        <View style={[s.sheet, { paddingBottom: spacing.lg + insets.bottom }]} accessibilityViewIsModal>
          <Text style={s.title} accessibilityRole="header">
            {title}
          </Text>
          {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
          <KeyboardAwareScrollView style={s.body} contentContainerStyle={s.bodyContent}>
            {children}
          </KeyboardAwareScrollView>
          {footer ? <View style={s.footer}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Two buttons side by side: the way out, and the action. */
export function SheetButtons({
  cancel = 'Cancel',
  onCancel,
  confirm,
  onConfirm,
  busy,
  disabled,
  danger,
}: {
  cancel?: string;
  onCancel: () => void;
  confirm?: string;
  onConfirm?: () => void;
  busy?: boolean;
  disabled?: boolean;
  danger?: boolean;
}) {
  const c = useColors();
  const s = useSheetStyles();
  return (
    <>
      <Button title={cancel} variant="ghost" onPress={onCancel} disabled={busy} style={s.footerButton} />
      {confirm && onConfirm ? (
        <Button title={confirm} onPress={onConfirm} loading={busy} disabled={disabled} style={danger ? { ...s.footerButton, backgroundColor: c.danger } : s.footerButton} />
      ) : null}
    </>
  );
}

/** A message inside a sheet: an error (announced at once) or a quiet note. */
export function SheetMessage({ text, tone = 'error' }: { text: string | null | undefined; tone?: 'error' | 'success' | 'info' }) {
  const s = useSheetStyles();
  if (!text) return null;
  return (
    <Text
      style={[s.message, tone === 'error' ? s.messageError : tone === 'success' ? s.messageSuccess : s.messageInfo]}
      accessibilityRole={tone === 'error' ? 'alert' : undefined}
      accessibilityLiveRegion={tone === 'error' ? 'assertive' : 'polite'}
    >
      {text}
    </Text>
  );
}

/** A label above a group of choices. */
export function FieldLabel({ children }: { children: React.ReactNode }) {
  const s = useSheetStyles();
  return (
    <Text style={s.label} importantForAccessibility="no">
      {children}
    </Text>
  );
}

/** One of a few choices, as chips (category, status, priority, role). */
export function ChipChoice<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  const s = useSheetStyles();
  return (
    <View style={s.group}>
      <FieldLabel>{label}</FieldLabel>
      <View style={s.chips} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable
              key={o.value}
              onPress={() => onChange(o.value)}
              disabled={disabled}
              accessibilityRole="radio"
              accessibilityLabel={o.label}
              accessibilityState={{ selected: on, checked: on, disabled: !!disabled }}
              style={({ pressed }) => [s.chip, on && s.chipOn, pressed && s.pressed]}
            >
              <Text style={[s.chipText, on && s.chipTextOn]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** A checkbox with its words ("Mark as a key point"). */
export function CheckRow({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const s = useSheetStyles();
  return (
    <Pressable
      onPress={() => onChange(!checked)}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked, disabled: !!disabled }}
      style={({ pressed }) => [s.checkRow, pressed && s.pressed]}
    >
      <View style={[s.checkbox, checked && s.checkboxOn]}>{checked ? <Text style={s.checkTick}>✓</Text> : null}</View>
      <Text style={s.checkText}>{label}</Text>
    </Pressable>
  );
}

/** Choices as cards with a hint each ("This meeting only" / "All upcoming meetings in the series"). */
export function CardChoice<T extends string>({
  legend,
  options,
  value,
  onChange,
}: {
  legend: string;
  options: { value: T; label: string; hint: string; disabled?: boolean }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const s = useSheetStyles();
  return (
    <View style={s.group} accessibilityRole="radiogroup" accessibilityLabel={legend}>
      <FieldLabel>{legend}</FieldLabel>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            disabled={o.disabled}
            accessibilityRole="radio"
            accessibilityLabel={`${o.label}. ${o.hint}`}
            accessibilityState={{ selected: on, checked: on, disabled: !!o.disabled }}
            style={({ pressed }) => [s.card, on && s.cardOn, o.disabled && s.disabled, pressed && s.pressed]}
          >
            <View style={[s.radio, on && s.radioOn]}>{on ? <View style={s.radioDot} /> : null}</View>
            <View style={s.flex}>
              <Text style={s.cardTitle}>{o.label}</Text>
              <Text style={s.cardHint}>{o.hint}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

export interface PickOption {
  value: string;
  label: string;
  hint?: string;
}

/**
 * A choice from a long list (a person, a project), opened in place: the chosen one, and — once
 * tapped — a search and the list. Without a sheet over a sheet.
 */
export function InlinePicker({
  label,
  options,
  value,
  onChange,
  placeholder,
  emptyText = 'Nothing to choose from.',
  disabled,
}: {
  label: string;
  options: PickOption[];
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  emptyText?: string;
  disabled?: boolean;
}) {
  const s = useSheetStyles();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const chosen = options.find((o) => o.value === value);
  const needle = q.trim().toLowerCase();
  const shown = (needle ? options.filter((o) => `${o.label} ${o.hint ?? ''}`.toLowerCase().includes(needle)) : options).slice(0, 60);
  return (
    <View style={s.group}>
      <FieldLabel>{label}</FieldLabel>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${chosen?.label ?? placeholder}`}
        accessibilityHint={open ? 'Closes the list' : 'Opens the list to choose from'}
        accessibilityState={{ expanded: open, disabled: !!disabled }}
        style={({ pressed }) => [s.pickerRow, pressed && s.pressed, disabled && s.disabled]}
      >
        <Text style={[s.pickerValue, !chosen && s.placeholder]} numberOfLines={1}>
          {chosen?.label ?? placeholder}
        </Text>
        <Text style={s.chevron} importantForAccessibility="no">
          {open ? '▴' : '▾'}
        </Text>
      </Pressable>
      {open ? (
        <View style={s.pickerList}>
          {options.length > 8 ? <TextField value={q} onChangeText={setQ} placeholder="Search…" accessibilityLabel={`Search ${label.toLowerCase()}`} autoCapitalize="none" style={s.search} /> : null}
          {shown.length === 0 ? <Text style={s.cardHint}>{options.length ? 'No match.' : emptyText}</Text> : null}
          {shown.map((o) => (
            <Pressable
              key={o.value || 'none'}
              onPress={() => {
                onChange(o.value);
                setOpen(false);
                setQ('');
              }}
              accessibilityRole="button"
              accessibilityLabel={o.hint ? `${o.label}, ${o.hint}` : o.label}
              accessibilityState={{ selected: o.value === value }}
              style={({ pressed }) => [s.option, pressed && s.pressed]}
            >
              <View style={s.flex}>
                <Text style={[s.optionText, o.value === value && s.chipTextOn]}>{o.label}</Text>
                {o.hint ? <Text style={s.cardHint}>{o.hint}</Text> : null}
              </View>
              {o.value === value ? <Text style={s.chipTextOn}>✓</Text> : null}
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** A button-like row in a sheet's list of actions. */
export function ActionRowButton({ label, onPress, danger, busy, hint, disabled }: { label: string; onPress: () => void; danger?: boolean; busy?: boolean; hint?: string; disabled?: boolean }) {
  const s = useSheetStyles();
  return (
    <Pressable
      onPress={onPress}
      disabled={busy || disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ busy: !!busy, disabled: !!disabled }}
      style={({ pressed }) => [s.option, pressed && s.pressed, disabled && s.disabled]}
    >
      <Text style={[s.optionText, danger && s.danger]}>{label}</Text>
      {busy ? <ActivityIndicator size="small" /> : null}
    </Pressable>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    fill: { flex: 1 },
    flex: { flex: 1 },
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
    sheet: { backgroundColor: c.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, gap: spacing.sm, maxHeight: '90%' },
    // The fields shrink (and scroll) when the keyboard leaves less room, so the buttons stay in view.
    body: { flexGrow: 0, flexShrink: 1 },
    bodyContent: { gap: spacing.sm, paddingBottom: spacing.xs },
    title: { fontSize: fontSize.xl, fontWeight: '800', color: c.ink, textAlign: 'auto' },
    subtitle: { fontSize: fontSize.sm, color: c.ink2, textAlign: 'auto' },
    footer: { flexDirection: 'row', gap: spacing.sm, paddingTop: spacing.xs },
    footerButton: { flex: 1 },
    message: { fontSize: fontSize.sm, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, overflow: 'hidden' },
    messageError: { color: c.danger, backgroundColor: c.dangerSoft, fontWeight: '600' },
    messageSuccess: { color: c.success, backgroundColor: c.successSoft, fontWeight: '600' },
    messageInfo: { color: c.ink2, backgroundColor: c.ground },
    label: { fontSize: fontSize.sm, fontWeight: '600', color: c.ink },
    group: { gap: spacing.xs, marginBottom: spacing.xs },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    chip: { minHeight: 40, justifyContent: 'center', borderWidth: 1, borderColor: c.line, borderRadius: radius.pill, paddingHorizontal: spacing.md, backgroundColor: c.surface },
    chipOn: { borderColor: c.brand, backgroundColor: c.brandWash },
    chipText: { fontSize: fontSize.sm, fontWeight: '600', color: c.ink },
    chipTextOn: { color: c.brand, fontWeight: '700' },
    pressed: { opacity: 0.7 },
    disabled: { opacity: 0.5 },
    checkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
    checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: c.ink3, alignItems: 'center', justifyContent: 'center' },
    checkboxOn: { borderColor: c.brand, backgroundColor: c.brand },
    checkTick: { color: c.onBrand, fontSize: fontSize.sm, fontWeight: '800' },
    checkText: { fontSize: fontSize.md, color: c.ink, flexShrink: 1 },
    card: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, borderWidth: 1, borderColor: c.line, borderRadius: radius.md, padding: spacing.md, minHeight: 48 },
    cardOn: { borderColor: c.brand, backgroundColor: c.brandWash },
    cardTitle: { fontSize: fontSize.md, fontWeight: '600', color: c.ink },
    cardHint: { fontSize: fontSize.xs, color: c.ink2, marginTop: 2 },
    radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: c.ink3, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
    radioOn: { borderColor: c.brand },
    radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: c.brand },
    pickerRow: { flexDirection: 'row', alignItems: 'center', minHeight: 48, borderWidth: 1, borderColor: c.line, borderRadius: radius.md, paddingHorizontal: spacing.md, backgroundColor: c.surface },
    pickerValue: { flex: 1, fontSize: fontSize.md, color: c.ink },
    placeholder: { color: c.ink3 },
    chevron: { fontSize: fontSize.md, color: c.ink3 },
    pickerList: { borderWidth: 1, borderColor: c.line, borderRadius: radius.md, padding: spacing.sm, gap: 2 },
    search: { marginBottom: 0 },
    option: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48, paddingHorizontal: spacing.sm, borderRadius: radius.sm },
    optionText: { fontSize: fontSize.md, fontWeight: '600', color: c.ink, textAlign: 'auto' },
    danger: { color: c.danger },
  });
