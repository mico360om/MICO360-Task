import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Image, StyleSheet, KeyboardAvoidingView, Platform, Pressable, ScrollView, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useServices, useServer } from '../../core/providers';
import { useColors } from '../../core/theme';
import { Button, TextField, ErrorNote } from '../../components/ui';
import { ApiError, isNetworkError } from '../../lib/api-client';
import { authErrorMessage, isAccountLocked } from '../../lib/auth-errors';
import { parseServerAddress, probeServer, serverLabel, sitePageUrl } from '../../lib/server-address';
import { spacing, fontSize, radius, type Palette } from '../../lib/theme';
import type { AuthScreenProps } from '../../navigation/types';
import logo from '../../../assets/logo.png';

type Mode = 'password' | 'otp';

export function LoginScreen({ navigation }: AuthScreenProps<'Login'>) {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { auth, session, biometric, biometricLogin } = useServices();
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

  // Offer biometric sign-in only when a credential is remembered and biometrics are on. Reading
  // the marker never shows a prompt; the token itself sits behind a biometric-bound key (MOB-01).
  useEffect(() => {
    let active = true;
    (async () => {
      const armed = (await biometricLogin.isArmed()) && (await biometric.isEnabled());
      if (!active) return;
      setCanBio(armed);
      if (armed) setBioLabel(await biometricLogin.getLabel());
    })();
    return () => { active = false; };
  }, [biometric, biometricLogin]);

  function handleError(e: unknown) {
    // Lockout shows "try again in N minutes"; missing email config, rate limits and being
    // offline get their own clear messages (auth-errors.ts).
    setLocked(isAccountLocked(e));
    setError(authErrorMessage(e));
  }

  async function afterLogin(promise: Promise<Awaited<ReturnType<typeof auth.login>>>) {
    setBusy(true);
    setError(null);
    setLocked(false);
    try {
      const s = await promise;
      // Push registration happens once the signed-in app mounts (every launch + token rotation).
      await session.setSession(s);
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
      // Reading the biometric-bound key shows the strong-biometric prompt (no device-PIN fallback).
      const cred = await biometricLogin.getCredential();
      if (!cred) {
        const stillArmed = await biometricLogin.isArmed();
        setCanBio(stillArmed);
        setError(stillArmed ? 'Fingerprint not confirmed.' : 'No saved biometric sign-in. Please sign in with your password.');
        return;
      }
      const s = await auth.refresh(cred.refreshToken);
      // The remembered token was just spent (single use) and re-saving it would need another
      // prompt, so this sign-in is one-shot; turn it back on in Settings.
      await biometricLogin.disarm();
      await session.setSession(s);
    } catch (e) {
      if (isNetworkError(e)) {
        setError('Can’t reach the server. Check your connection and try again.');
      } else if (e instanceof ApiError && e.status !== 401 && e.status !== 400) {
        // 429 / 5xx: the credential may still be good — keep it.
        setError('The server is busy. Please try again in a minute.');
      } else {
        // The remembered token is expired/revoked → forget it and fall back to password.
        await biometricLogin.disarm();
        setCanBio(false);
        setError('Your biometric sign-in has expired. Please sign in with your password.');
      }
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

  // Server choice: task.mico360.com by default, or e.g. a self-hosted server on the office network.
  const server = useServer();
  const [editingServer, setEditingServer] = useState(false);
  const [serverInput, setServerInput] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);
  const [checkingServer, setCheckingServer] = useState(false);

  function startServerEdit() {
    setServerInput(server.baseUrl.replace(/\/api\/v\d+$/, ''));
    setServerError(null);
    setEditingServer(true);
  }

  async function applyServer() {
    const parsed = parseServerAddress(serverInput);
    if (!parsed.ok) {
      setServerError(parsed.error);
      return;
    }
    setCheckingServer(true);
    setServerError(null);
    const reachable = await probeServer(parsed.apiBase);
    setCheckingServer(false);
    if (!reachable) {
      setServerError(`Can’t reach a MICO360 Tasks server at ${serverLabel(parsed.apiBase)}. Check the address and that the server is running.`);
      return;
    }
    setEditingServer(false);
    await server.setServer(parsed.apiBase);
  }

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
            <View style={styles.lockedNote} accessibilityRole="alert" accessibilityLiveRegion="assertive">
              <Text style={styles.lockedTitle}>Account locked</Text>
              {/* Includes "Try again in N minutes" when the server sends retryAfterSeconds. */}
              <Text style={styles.lockedBody}>{error ?? 'Too many failed attempts. Reset your password to unlock your account.'}</Text>
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
              <Pressable onPress={() => navigation.navigate('Forgot')} style={styles.forgot} accessibilityRole="link">
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
                  <Pressable onPress={requestCode} style={styles.forgot} accessibilityRole="button" accessibilityLabel="Resend code">
                    <Text style={styles.forgotText}>Resend code</Text>
                  </Pressable>
                </>
              ) : (
                <Button title="Email me a code" onPress={requestCode} loading={busy} disabled={!identifier} />
              )}
            </>
          )}

          <View style={styles.serverBox}>
            {editingServer ? (
              <>
                <TextField
                  label="Server address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  value={serverInput}
                  onChangeText={setServerInput}
                  placeholder="https://task.mico360.com or 192.168.1.20:4000"
                  error={serverError}
                />
                <Button title="Use this server" onPress={applyServer} loading={checkingServer} disabled={!serverInput.trim()} />
                {server.baseUrl !== server.defaultBaseUrl ? (
                  <Pressable onPress={() => void server.setServer(null)} style={styles.forgot} accessibilityRole="button">
                    <Text style={styles.forgotText}>Use the default server ({serverLabel(server.defaultBaseUrl)})</Text>
                  </Pressable>
                ) : null}
                <Pressable onPress={() => setEditingServer(false)} style={styles.forgot} accessibilityRole="button">
                  <Text style={styles.serverText}>Cancel</Text>
                </Pressable>
              </>
            ) : (
              <Pressable
                onPress={startServerEdit}
                accessibilityRole="button"
                accessibilityLabel={`Server: ${serverLabel(server.baseUrl)}. Change server`}
              >
                <Text style={styles.serverText}>
                  Server: {serverLabel(server.baseUrl)} · <Text style={styles.forgotText}>Change</Text>
                </Text>
              </Pressable>
            )}
            <Pressable
              onPress={() => void Linking.openURL(sitePageUrl(server.baseUrl, '/privacy')).catch(() => {})}
              accessibilityRole="link"
              style={styles.privacy}
            >
              <Text style={styles.serverText}>Privacy policy</Text>
            </Pressable>
          </View>
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
    serverBox: { marginTop: spacing.xl, paddingTop: spacing.lg, borderTopWidth: 1, borderTopColor: c.line, alignItems: 'stretch', gap: spacing.sm },
    serverText: { textAlign: 'center', color: c.ink3, fontSize: fontSize.xs },
    privacy: { alignItems: 'center', paddingVertical: spacing.xs },
  });
