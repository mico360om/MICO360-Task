import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, AccessibilityInfo, type TextInput } from 'react-native';
import { useColors } from '../../core/theme';
import { usePasswordChange } from '../../core/account-queries';
import { Card, SectionTitle, Muted, Button, TextField, ErrorNote } from '../ui';
import { KeyboardGroup } from '../KeyboardAware';
import { PASSWORD_RULE_HINT, checkPasswordChange, passwordChangeProblem, type PasswordField } from '../../lib/password-change';
import { SIGN_IN_LIMITS } from '../../lib/auth';
import { spacing, radius, fontSize, type Palette } from '../../lib/theme';

/**
 * Profile → Change password (6a), as on the website: the current password, the new one twice. The
 * server checks the current one and its rule; the change signs out every other device and this
 * phone stays signed in. The passwords are kept only in these fields, and cleared once changed.
 */
export function ChangePasswordCard() {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const change = usePasswordChange();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ field: PasswordField | null; message: string } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const currentRef = useRef<TextInput>(null);
  const nextRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);
  const refs: Record<PasswordField, React.RefObject<TextInput>> = { current: currentRef, next: nextRef, confirm: confirmRef };
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  /** Typing again clears the last outcome (as on the website). */
  const typed = (set: (v: string) => void) => (v: string) => {
    set(v);
    setDone(null);
  };
  const fieldError = (f: PasswordField) => (problem?.field === f ? problem.message : null);

  async function submit() {
    if (busy) return;
    setDone(null);
    const bad = checkPasswordChange({ current, next, confirm });
    if (bad) {
      setProblem(bad);
      refs[bad.field].current?.focus();
      return;
    }
    setProblem(null);
    setBusy(true);
    try {
      const result = await change(current, next);
      if (!mounted.current) return;
      setCurrent('');
      setNext('');
      setConfirm('');
      setDone(result.message);
      AccessibilityInfo.announceForAccessibility(result.message);
    } catch (e) {
      if (!mounted.current) return;
      const p = passwordChangeProblem(e);
      setProblem(p);
      if (p.field) refs[p.field].current?.focus();
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <View style={s.section}>
      <SectionTitle>Change password</SectionTitle>
      <Card>
        <Muted style={s.intro}>Update the password you use to sign in.</Muted>
        {problem && !problem.field ? <ErrorNote message={problem.message} /> : null}
        {done ? (
          <View style={s.done}>
            <Text style={s.doneText}>{done}</Text>
          </View>
        ) : null}
        <TextField
          inputRef={currentRef}
          label="Current password"
          required
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="password"
          textContentType="password"
          value={current}
          onChangeText={typed(setCurrent)}
          maxLength={SIGN_IN_LIMITS.password}
          returnKeyType="next"
          blurOnSubmit={false}
          onSubmitEditing={() => nextRef.current?.focus()}
          editable={!busy}
          error={fieldError('current')}
        />
        {/* Typing keeps the new passwords and "Update password" above the keyboard when they fit. */}
        <KeyboardGroup>
          <TextField
            inputRef={nextRef}
            label="New password"
            required
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="password-new"
            textContentType="newPassword"
            value={next}
            onChangeText={typed(setNext)}
            maxLength={SIGN_IN_LIMITS.password}
            returnKeyType="next"
            blurOnSubmit={false}
            onSubmitEditing={() => confirmRef.current?.focus()}
            editable={!busy}
            accessibilityHint={PASSWORD_RULE_HINT}
            error={fieldError('next')}
          />
          {/* TalkBack reads the rule as the field's hint, not twice. */}
          {fieldError('next') ? null : (
            <Text style={s.hint} importantForAccessibility="no">
              {PASSWORD_RULE_HINT}
            </Text>
          )}
          <KeyboardGroup>
            <TextField
              inputRef={confirmRef}
              label="Confirm new password"
              required
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="password-new"
              textContentType="newPassword"
              value={confirm}
              onChangeText={typed(setConfirm)}
              maxLength={SIGN_IN_LIMITS.password}
              returnKeyType="done"
              onSubmitEditing={() => void submit()}
              editable={!busy}
              error={fieldError('confirm')}
            />
            <Button title={busy ? 'Updating…' : 'Update password'} accessibilityLabel="Update password" onPress={() => void submit()} loading={busy} />
          </KeyboardGroup>
        </KeyboardGroup>
      </Card>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    section: { gap: spacing.sm },
    intro: { marginBottom: spacing.md },
    hint: { marginTop: -spacing.sm, marginBottom: spacing.md, fontSize: fontSize.xs, color: c.ink2 },
    done: { backgroundColor: c.successSoft, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
    doneText: { color: c.success, fontSize: fontSize.sm, fontWeight: '600' },
  });
