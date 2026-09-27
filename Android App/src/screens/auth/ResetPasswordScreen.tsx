import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useServices } from '../../core/providers';
import { useColors } from '../../core/theme';
import { Button, TextField, ErrorNote, Heading, Muted } from '../../components/ui';
import { ApiError, isNetworkError } from '../../lib/api-client';
import { extractResetToken } from '../../lib/deep-link';
import { spacing, type Palette } from '../../lib/theme';
import type { AuthScreenProps } from '../../navigation/types';

/**
 * Choose a new password (MOB-09). Opened from the e-mailed link via Android App Links
 * (`https://task.mico360.com/reset?token=…`) with the token already filled in, or reached from
 * "Forgot password" where the user can paste the whole link (or just its token).
 */
export function ResetPasswordScreen({ navigation, route }: AuthScreenProps<'Reset'>) {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { auth } = useServices();
  const linkToken = route.params?.token ?? '';
  const [tokenInput, setTokenInput] = useState(linkToken);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A second link tapped while this screen is open brings a new token.
  useEffect(() => {
    if (linkToken) setTokenInput(linkToken);
  }, [linkToken]);

  const token = extractResetToken(tokenInput);
  const fromLink = !!linkToken && token === linkToken;
  const mismatch = confirm.length > 0 && password !== confirm;
  const weak = password.length > 0 && !(password.length >= 8 && /[A-Za-z]/.test(password) && /\d/.test(password));

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await auth.resetPassword(token, password);
      setDone(true);
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : isNetworkError(e)
            ? 'Can’t reach the server. Check your connection and try again.'
            : 'Could not reset the password.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.scroll}>
          <Heading>Password updated</Heading>
          <Muted>Your account is unlocked. You can now sign in with your new password.</Muted>
          <Button title="Back to sign in" onPress={() => navigation.navigate('Login')} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Heading>Choose a new password</Heading>
        {fromLink ? (
          <Muted>Your reset link was opened in the app. Enter your new password below.</Muted>
        ) : (
          <Muted>Paste the reset link from the email (or just the code after “token=”).</Muted>
        )}
        {error ? <ErrorNote message={error} /> : null}
        {!fromLink ? (
          <TextField
            label="Reset link"
            required
            autoCapitalize="none"
            autoCorrect={false}
            value={tokenInput}
            onChangeText={setTokenInput}
            placeholder="https://task.mico360.com/reset?token=…"
          />
        ) : null}
        <TextField
          label="New password"
          required
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          placeholder="At least 8 chars, a letter and a number"
          error={weak ? 'Use at least 8 characters, including a letter and a number.' : null}
        />
        <TextField
          label="Confirm password"
          required
          secureTextEntry
          value={confirm}
          onChangeText={setConfirm}
          error={mismatch ? 'Passwords do not match.' : null}
        />
        <Button
          title="Update password"
          onPress={submit}
          loading={busy}
          disabled={!token || !password || mismatch || weak}
        />
        <Button title="Back to sign in" variant="ghost" onPress={() => navigation.navigate('Login')} />
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.ground },
    scroll: { padding: spacing.xl, flexGrow: 1, justifyContent: 'center', gap: spacing.md },
  });
