import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '../../core/theme';
import { radius, spacing } from '../../lib/theme';
import { AppText, Button, ErrorNote, Muted } from '../ui';

/**
 * Before something goes on the project's client page (a report, approved minutes): exactly what the
 * client will see, as the website's preview dialog. Nothing is shown to the client until its own
 * "Show to client" is tapped, and that waits for the preview to load (never on an error).
 */
export function ClientPreviewSheet({
  visible,
  title,
  intro,
  loading,
  error,
  namesNote,
  children,
  onCancel,
  onConfirm,
  busy,
  confirmLabel = 'Show to client',
  footer,
}: {
  visible: boolean;
  title: string;
  intro: string;
  loading: boolean;
  /** Couldn't load the preview, or couldn't change it. */
  error: string | null;
  /** "Highlighted: names of people on the project…" when the preview names someone. */
  namesNote?: React.ReactNode;
  /** The preview card (what the client sees). */
  children?: React.ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
  busy: boolean;
  confirmLabel?: string;
  /** A switch under the preview (minutes: "Include Risks & open issues"). */
  footer?: React.ReactNode;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const close = busy ? () => undefined : onCancel;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View style={s.fill}>
        <Pressable style={[s.backdrop, { backgroundColor: c.scrim }]} onPress={close} accessibilityRole="button" accessibilityLabel={`Close ${title}`} />
        <View style={[s.sheet, { backgroundColor: c.surface, paddingTop: spacing.lg + insets.top, paddingBottom: spacing.lg + insets.bottom }]} accessibilityViewIsModal>
          <View style={[s.head, { borderBottomColor: c.line }]}>
            <AppText variant="heading" accessibilityRole="header">
              {title}
            </AppText>
            <Muted style={s.intro}>{intro}</Muted>
          </View>
          <ScrollView style={s.body} contentContainerStyle={s.bodyContent}>
            {loading ? <Muted>Loading…</Muted> : null}
            {!loading && namesNote ? <View style={[s.note, { backgroundColor: c.ground }]}>{namesNote}</View> : null}
            {!loading && children ? <View style={[s.preview, { borderColor: c.line }]}>{children}</View> : null}
            {!loading && footer ? footer : null}
            {error ? <ErrorNote message={error} /> : null}
          </ScrollView>
          <View style={[s.buttons, { borderTopColor: c.line }]}>
            <Button title="Cancel" variant="secondary" onPress={onCancel} disabled={busy} style={s.button} />
            <Button title={confirmLabel} onPress={onConfirm} loading={busy} disabled={loading || !!error || busy} style={s.button} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  backdrop: { ...StyleSheet.absoluteFillObject },
  sheet: { flex: 1, marginTop: spacing.xl, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, overflow: 'hidden' },
  head: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  intro: { marginTop: spacing.xs },
  body: { flex: 1 },
  bodyContent: { padding: spacing.lg, gap: spacing.lg },
  note: { borderRadius: radius.input, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  preview: { borderWidth: 1, borderRadius: radius.button, padding: spacing.lg },
  buttons: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  button: { flex: 1 },
});
