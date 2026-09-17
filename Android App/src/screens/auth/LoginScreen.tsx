import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Image, StyleSheet, KeyboardAvoidingView, Platform, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useServices } from '../../core/providers';
import { useColors } from '../../core/theme';
import { Button, TextField, ErrorNote } from '../../components/ui';
import { ApiError } from '../../lib/api-client';
import { spacing, fontSize, radius, type Palette } from '../../lib/theme';
import type { AuthScreenProps } from '../../navigation/types';
import logo from '../../../assets/logo.png';

type Mode = 'password' | 'otp';

export function LoginScreen({ navigation }: AuthScreenProps<'Login'>) {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { auth, session, push, biometric, biometricLogin } = useServices();
  const [mode, setMode] = useState<Mode>('password');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [canBio, setCanBio] = useState(false);
  const [bioLabel, setBioLabel] = useState<string | undefined>(undefined);

  // Offer biometric sign-in when a credential was remembered + biometrics are on.
  useEffect(() => {
    let active = true;
    (async () => {
      const armed = (await biometricLogin.isArmed()) && (await biometric.isEnabled());
      if (!active) return;
      setCanBio(armed);
      if (armed) setBioLabel((await biometricLogin.getCredential())?.label);
    })();
    return () => { active = false; };
  }, [biometric, biometricLogin]);

  function handleError(e: unknown) {
    if (e instanceof ApiError) {
      setLocked(e.code === 'ACCOUNT_LOCKED' || e.status === 423);
      setError(e.message);
    } else {
      setError('Something went wrong. Please try again.');
    }
  }

  async function afterLogin(promise: Promise<Awaited<ReturnType<typeof auth.login>>>) {
    setBusy(true);
    setError(null);
    setLocked(false);
    try {
      const s = await promise;
      await session.setSession(s);
      // Remember the session for biometric login when the user has biometrics enabled.
      if (await biometric.isEnabled()) await biometricLogin.arm(s.refreshToken, identifier.trim() || undefined);
      void push.register().catch(() => {}); // best-effort push registration
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  }

  async function signInWithBiometrics() {
    setBusy(true);
    setError(null);
    setLocked(false);
    try {
      const res = await biometric.unlock();
      if (!res.ok) {
        setError(res.reason === 'unavailable' ? 'Biometrics are unavailable — sign in with your password.' : 'Biometric authentication failed.');
        return;
      }
      const cred = await biometricLogin.getCredential();
      if (!cred) {
        setCanBio(false);
        setError('No saved biometric sign-in. Please sign in with your password.');
        return;
      }
      const s = await auth.refresh(cred.refreshToken);
      await session.setSession(s);
      await biometricLogin.arm(s.refreshToken, cred.label); // rotate the remembered token
      void push.register().catch(() => {});
    } catch {
      // The remembered token is expired/invalid → forget it and fall back to password.
      await biometricLogin.disarm();
      setCanBio(false);
      setError('Your biometric sign-in has expired. Please sign in with your password.');
    } finally {
      setBusy(false);
    }
  }

  const submitPassword = () => afterLogin(auth.login(identifier.trim(), password));

  async function requestCode() {
    setBusy(true);
    setError(null);
    setLocked(false);
    try {
      await auth.requestOtp(identifier.trim());
      setCodeSent(true);
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  }

  const submitCode = () => afterLogin(auth.verifyOtp(identifier.trim(), code.trim()));

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.brand}>
            <Image source={logo} style={styles.logo} resizeMode="contain" accessibilityRole="image" accessibilityLabel="MICO360" />
            <Text style={styles.title}>Welcome back</Text>
            <Text style={styles.subtitle}>Sign in to MICO360 Tasks</Text>
          </View>

          {canBio ? (
            <View style={styles.bioWrap}>
              <Button
                title={bioLabel ? `Sign in with biometrics (${bioLabel})` : 'Sign in with biometrics'}
                variant="secondary"
                onPress={signInWithBiometrics}
                loading={busy}
              />
              <Text style={styles.bioOr}>or sign in below</Text>
            </View>
          ) : null}

          <View style={styles.tabs}>
            <ModeTab label="Password" active={mode === 'password'} onPress={() => setMode('password')} styles={styles} />
            <ModeTab label="Email code" active={mode === 'otp'} onPress={() => setMode('otp')} styles={styles} />
          </View>

          {locked ? (
            <View style={styles.lockedNote}>
              <Text style={styles.lockedTitle}>Account locked</Text>
              <Text style={styles.lockedBody}>
                Too many failed attempts. Reset your password to unlock your account.
              </Text>
              <Button title="Reset password" variant="secondary" onPress={() => navigation.navigate('Forgot')} />
            </View>
          ) : error ? (
            <ErrorNote message={error} />
          ) : null}

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

          {mode === 'password' ? (
            <>
              <TextField
                label="Password"
                required
                secureTextEntry
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••"
              />
              <Button title="Sign in" onPress={submitPassword} loading={busy} disabled={!identifier || !password} />
              <Pressable onPress={() => navigation.navigate('Forgot')} style={styles.forgot}>
                <Text style={styles.forgotText}>Forgot your password?</Text>
              </Pressable>
            </>
          ) : (
            <>
              {codeSent ? (
                <>
                  <TextField
                    label="6-digit code"
                    required
                    keyboardType="number-pad"
                    value={code}
                    onChangeText={setCode}
                    placeholder="123456"
                    maxLength={6}
                  />
                  <Button title="Verify & sign in" onPress={submitCode} loading={busy} disabled={code.length < 6} />
                  <Pressable onPress={requestCode} style={styles.forgot}>
                    <Text style={styles.forgotText}>Resend code</Text>
                  </Pressable>
                </>
              ) : (
                <Button title="Email me a code" onPress={requestCode} loading={busy} disabled={!identifier} />
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function ModeTab({ label, active, onPress, styles }: { label: string; active: boolean; onPress: () => void; styles: Styles }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${label} sign-in`}
      style={[styles.tab, active && styles.tabActive]}
    >
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.ground },
    flex: { flex: 1 },
    scroll: { padding: spacing.xl, justifyContent: 'center', flexGrow: 1 },
    brand: { alignItems: 'center', marginBottom: spacing.xl },
    logo: { width: 120, height: 120, marginBottom: spacing.md },
    title: { fontSize: fontSize.xxl, fontWeight: '800', color: c.ink },
    subtitle: { fontSize: fontSize.md, color: c.ink2, marginTop: spacing.xs },
    bioWrap: { marginBottom: spacing.lg, gap: spacing.sm },
    bioOr: { textAlign: 'center', color: c.ink3, fontSize: fontSize.xs },
    tabs: { flexDirection: 'row', backgroundColor: c.line, borderRadius: radius.md, padding: 3, marginBottom: spacing.lg },
    tab: { flex: 1, paddingVertical: spacing.sm, alignItems: 'center', borderRadius: radius.sm },
    tabActive: { backgroundColor: c.surface },
    tabText: { fontSize: fontSize.sm, fontWeight: '600', color: c.ink2 },
    tabTextActive: { color: c.brand },
    forgot: { alignItems: 'center', marginTop: spacing.md },
    forgotText: { color: c.brand, fontSize: fontSize.sm, fontWeight: '600' },
    lockedNote: {
      backgroundColor: c.errorWash,
      borderWidth: 1,
      borderColor: c.danger,
      borderRadius: radius.md,
      padding: spacing.lg,
      marginBottom: spacing.lg,
      gap: spacing.sm,
    },
    lockedTitle: { color: c.danger, fontSize: fontSize.md, fontWeight: '700' },
    lockedBody: { color: c.ink, fontSize: fontSize.sm },
  });
