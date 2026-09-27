import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useServices } from '../../core/providers';
import { useColors } from '../../core/theme';
import { Button, TextField, ErrorNote, Heading, Muted } from '../../components/ui';
import { spacing, type Palette } from '../../lib/theme';
import type { AuthScreenProps } from '../../navigation/types';
import { ApiError, isNetworkError } from '../../lib/api-client';
import { authErrorMessage, isEmailNotConfigured } from '../../lib/auth-errors';

export function ForgotPasswordScreen({ navigation }: AuthScreenProps<'Forgot'>) {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { auth } = useServices();
  const [identifier, setIdentifier] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await auth.forgotPassword(identifier.trim());
      setSent(true);
    } catch (e) {
      if (isEmailNotConfigured(e) || isNetworkError(e) || (e instanceof ApiError && e.status === 429)) {
        // Nothing was sent, and saying so reveals nothing about the account (503 / offline / 429).
        setError(authErrorMessage(e));
      } else {
        // Never reveal whether an account exists — treat as sent.
        setSent(true);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Heading>Reset your password</Heading>
        <Muted style={styles.intro}>
          Enter your email or username and we&apos;ll send a link to reset your password and unlock your account.
        </Muted>

        {error ? <ErrorNote message={error} /> : null}

        {sent ? (
          <View style={styles.sent}>
            <Text style={styles.sentTitle} accessibilityRole="header" accessibilityLiveRegion="polite">
              Check your email
            </Text>
            <Muted>
              If an account matches, a reset link is on its way. Tap the link on this phone — it opens MICO360 Tasks
              so you can choose a new password. If it opens in the browser instead, you can finish there, or copy the
              link and paste it on the next screen.
            </Muted>
            <Button title="Paste the reset link" onPress={() => navigation.navigate('Reset')} />
            <Button title="Back to sign in" variant="ghost" onPress={() => navigation.navigate('Login')} />
          </View>
        ) : (
          <>
            <TextField
              label="Email or username"
              required
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              value={identifier}
              onChangeText={setIdentifier}
              placeholder="you@company.com"
            />
            <Button title="Send reset link" onPress={submit} loading={busy} disabled={!identifier} />
            <Button title="Back to sign in" variant="ghost" onPress={() => navigation.navigate('Login')} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.ground },
    scroll: { padding: spacing.xl, flexGrow: 1, justifyContent: 'center', gap: spacing.md },
    intro: { marginBottom: spacing.md },
    sent: { gap: spacing.md },
    sentTitle: { fontSize: 18, fontWeight: '700', color: c.ink },
  });
