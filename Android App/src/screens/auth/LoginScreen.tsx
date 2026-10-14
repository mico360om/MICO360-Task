import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Image, StyleSheet, KeyboardAvoidingView, Platform, Pressable, ScrollView, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useServices, useServer } from '../../core/providers';
import { useColors } from '../../core/theme';
import { Button, TextField, ErrorNote } from '../../components/ui';
import { ApiError, isNetworkError } from '../../lib/api-client';
import { authErrorMessage, isAccountLocked } from '../../lib/auth-errors';
import { parseServerAddress, probeServer, serverLabel, sitePageUrl } from '../../lib/server-address';
import { fetchEmailEnabled, isCodeComplete, normaliseCode, resendLabel, resendWaitSeconds } from '../../lib/email-sign-in';
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
  // When the last code was sent, and a clock that ticks while "Resend" waits out the server's limit.
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const resendWait = resendWaitSeconds(sentAt, now);
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
    if (codeSent && resendWait > 0) return;
    setBusy(true);
    setError(null);
    setLocked(false);
    try {
      await auth.requestOtp(identifier.trim());
      const at = Date.now();
      setSentAt(at);
      setNow(at);
      setCode('');
      setCodeSent(true);
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  }

  const submitCode = () => afterLogin(auth.verifyOtp(identifier.trim(), code.trim()));

  /** Back to the first step, to send the code somewhere else. */
  function useDifferentAddress() {
    setCodeSent(false);
    setSentAt(null);
    setCode('');
    setError(null);
  }

  useEffect(() => {
    if (resendWait <= 0) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [resendWait > 0, sentAt]);

  // Server choice: task.mico360.com by default, or e.g. a self-hosted server on the office network.
  const server = useServer();
  const [editingServer, setEditingServer] = useState(false);
  const [serverInput, setServerInput] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);
  const [checkingServer, setCheckingServer] = useState(false);

  // Email codes and reset links need the server's email to be set up: ask the chosen server, and
  // offer "Email code" only once it has said yes (the same rule as the web app).
  const [emailEnabled, setEmailEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    setEmailEnabled(null);
    void fetchEmailEnabled(server.baseUrl).then((enabled) => {
      if (active) setEmailEnabled(enabled);
    });
    return () => { active = false; };
  }, [server.baseUrl]);
  useEffect(() => {
    if (emailEnabled !== true && mode === 'otp') setMode('password');
  }, [emailEnabled, mode]);

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

          {emailEnabled === true ? (
            <View style={styles.tabs}>
              <ModeTab label="Password" active={mode === 'password'} onPress={() => setMode('password')} styles={styles} />
              <ModeTab label="Email code" active={mode === 'otp'} onPress={() => setMode('otp')} styles={styles} />
            </View>
          ) : null}

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
            // The code just sent belongs to this address: changing it means asking for a new code.
            editable={!(mode === 'otp' && codeSent)}
            style={mode === 'otp' && codeSent ? styles.lockedInput : undefined}
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
              {emailEnabled === false ? (
                // No email on this server: a reset link could not be sent.
                <Text style={[styles.note, styles.noteBelow]}>Forgot your password? Ask your administrator to reset it.</Text>
              ) : (
                <Pressable onPress={() => navigation.navigate('Forgot')} style={styles.forgot} accessibilityRole="link">
                  <Text style={styles.forgotText}>Forgot your password?</Text>
                </Pressable>
              )}
            </>
          ) : (
            <>
              {codeSent ? (
                <>
                  <Text style={styles.note} accessibilityLiveRegion="polite">
                    If that account exists, we’ve emailed it a one-time code. Check your inbox — and your spam folder.
                  </Text>
                  <TextField
                    label="One-time code"
                    required
                    keyboardType="number-pad"
                    textContentType="oneTimeCode"
                    autoComplete="sms-otp"
                    autoFocus
                    value={code}
                    onChangeText={(text) => setCode(normaliseCode(text))}
                    placeholder="6-digit code"
                    maxLength={10}
                  />
                  <Button title="Verify & sign in" onPress={submitCode} loading={busy} disabled={!isCodeComplete(code)} />
                  <View style={styles.codeLinks}>
                    <Pressable
                      onPress={requestCode}
                      disabled={resendWait > 0 || busy}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: resendWait > 0 || busy }}
                      // A steady name while it waits: a label that changed every second would be re-read.
                      accessibilityLabel={resendWait > 0 ? 'Resend code, available after a minute' : 'Resend code'}
                      hitSlop={8}
                    >
                      <Text style={resendWait > 0 ? styles.linkMuted : styles.forgotText}>{resendLabel(resendWait)}</Text>
                    </Pressable>
                    <Pressable onPress={useDifferentAddress} accessibilityRole="button" hitSlop={8}>
                      <Text style={styles.linkMuted}>Use a different email</Text>
                    </Pressable>
                  </View>
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
    linkMuted: { color: c.ink2, fontSize: fontSize.sm, fontWeight: '600' },
    lockedInput: { backgroundColor: c.line, color: c.ink2 },
    codeLinks: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.md },
    note: { color: c.ink2, fontSize: fontSize.sm, marginBottom: spacing.md, textAlign: 'center' },
    // Under a button, the same gap as the "Forgot your password?" link it replaces.
    noteBelow: { marginTop: spacing.md, marginBottom: 0 },
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
