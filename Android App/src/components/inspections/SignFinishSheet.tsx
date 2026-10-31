import React, { useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '../../core/theme';
import { SIGNATURE_LABEL, type SignatureRole } from '../../lib/inspection-rules';
import type { SignatureInput } from '../../lib/inspection-types';
import { SIGN_WORDS, signButtonsSideBySide, signatureInputs, type SignatureValue } from '../../lib/signature-ink';
import { radius, spacing } from '../../lib/theme';
import { AppText, Button, Muted } from '../ui';
import { SignaturePad } from './SignaturePad';

/**
 * Signing ends the inspection, as the website's sign dialog: the inspector always signs; the form
 * may ask for the client's or a supervisor's signature too (needed, or optional). Each signature is
 * drawn with a finger, or the typed name, and always carries the signer's name; the time is stamped
 * here, one for all. With no signal the signatures stay on this phone and it finishes once back
 * online. The sheet doesn't scroll while a finger is signing.
 */
export function SignFinishSheet({
  visible,
  roles,
  inspectorName,
  online,
  onCancel,
  onSign,
}: {
  visible: boolean;
  roles: { allowed: SignatureRole[]; required: SignatureRole[] };
  inspectorName: string;
  online: boolean;
  onCancel: () => void;
  onSign: (signatures: SignatureInput[]) => void;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  // Side by side while both words fit; stacked (Sign and finish on top) at a large font.
  const { width, fontScale } = useWindowDimensions();
  const sideBySide = signButtonsSideBySide(width, fontScale);
  const [values, setValues] = useState<Partial<Record<SignatureRole, SignatureValue | null>>>({});
  const [problems, setProblems] = useState<Partial<Record<SignatureRole, string | null>>>({});
  const [signing, setSigning] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const tops = useRef<Partial<Record<SignatureRole, number>>>({});

  const submit = () => {
    const pads = roles.allowed.map((role) => ({ role, required: roles.required.includes(role), value: values[role] ?? null }));
    const result = signatureInputs(pads, new Date().toISOString());
    if (!result.ok) {
      setProblems({ [result.role]: result.problem });
      scroll.current?.scrollTo({ y: Math.max(0, (tops.current[result.role] ?? 0) - spacing.lg), animated: true });
      return;
    }
    onSign(result.signatures);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={s.fill}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: c.scrim }]} onPress={onCancel} accessibilityRole="button" accessibilityLabel={`Close ${SIGN_WORDS.title}`} />
        <View style={[s.sheet, { backgroundColor: c.surface, paddingTop: spacing.lg + insets.top, paddingBottom: spacing.lg + insets.bottom }]} accessibilityViewIsModal>
          <View style={[s.head, { borderBottomColor: c.line }]}>
            <AppText variant="heading" accessibilityRole="header">
              {SIGN_WORDS.title}
            </AppText>
            <Muted style={s.intro}>{`${SIGN_WORDS.intro}${online ? '' : SIGN_WORDS.offline}`}</Muted>
          </View>
          <ScrollView ref={scroll} style={s.body} contentContainerStyle={s.bodyContent} scrollEnabled={!signing} keyboardShouldPersistTaps="handled">
            {roles.allowed.map((role) => {
              const needed = roles.required.includes(role);
              return (
                <View
                  key={role}
                  onLayout={(e) => {
                    tops.current[role] = e.nativeEvent.layout.y;
                  }}
                >
                  <SignaturePad
                    label={`${SIGN_WORDS.padLabel.replace('{role}', SIGNATURE_LABEL[role])}${needed ? '' : SIGN_WORDS.optional}`}
                    defaultName={role === 'INSPECTOR' ? inspectorName : ''}
                    required={needed}
                    value={values[role] ?? null}
                    onChange={(v) => {
                      setValues((cur) => ({ ...cur, [role]: v }));
                      if (problems[role]) setProblems((cur) => ({ ...cur, [role]: null }));
                    }}
                    error={problems[role] ?? null}
                    onSigning={setSigning}
                  />
                </View>
              );
            })}
          </ScrollView>
          <View style={[s.buttons, signButtonsSideBySide(width, fontScale) ? s.buttonsRow : s.buttonsStacked, { borderTopColor: c.line }]}>
            <Button title={SIGN_WORDS.cancel} variant="secondary" onPress={onCancel} style={sideBySide ? s.button : null} />
            <Button title={SIGN_WORDS.title} onPress={submit} style={sideBySide ? s.button : null} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  sheet: { flex: 1, marginTop: spacing.xl, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, overflow: 'hidden' },
  head: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  intro: { marginTop: spacing.xs },
  body: { flex: 1 },
  bodyContent: { padding: spacing.lg, gap: spacing.xl },
  buttons: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  buttonsRow: { flexDirection: 'row' },
  buttonsStacked: { flexDirection: 'column-reverse' },
  button: { flex: 1 },
});
