import React, { useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useServices } from '../../core/providers';
import { useColors } from '../../core/theme';
import { Button, TextField, ErrorNote, Heading, Muted } from '../../components/ui';
import { ApiError } from '../../lib/api-client';
import { spacing, type Palette } from '../../lib/theme';
import type { AuthScreenProps } from '../../navigation/types';

export function ResetPasswordScreen({ navigation, route }: AuthScreenProps<'Reset'>) {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { auth } = useServices();
  const [token, setToken] = useState(route.params?.token ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mismatch = confirm.length > 0 && password !== confirm;
  const weak = password.length > 0 && !(password.length >= 8 && /[A-Za-z]/.test(password) && /\d/.test(password));

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await auth.resetPassword(token.trim(), password);
      setDone(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reset the password.');
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
        {error ? <ErrorNote message={error} /> : null}
        <TextField
          label="Reset code"
          required
          autoCapitalize="none"
          autoCorrect={false}
          value={token}
          onChangeText={setToken}
          placeholder="Paste the code from your email"
        />
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
