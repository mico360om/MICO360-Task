import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Switch, Pressable, StyleSheet, Alert, AppState, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useServices, useSession, useMyQueuedChanges } from '../core/providers';
import { useTheme, type ThemeMode } from '../core/theme';
import { Card, SectionTitle, Button, Muted } from '../components/ui';
import { SyncStatus } from '../components/SyncStatus';
import { getPushPermission, openAppSettings, type PushPermission } from '../adapters/push';
import { useNotificationPreferences, useSaveNotificationPreferences } from '../core/queries';
import { NOTIFICATION_TYPES, REMINDER_OPTIONS, isTypeOn, toggleType, withReminderLead } from '../lib/notification-prefs';
import { sitePageUrl } from '../lib/server-address';
import { spacing, radius, fontSize, type Palette } from '../lib/theme';
import type { TabScreenProps } from '../navigation/types';

const THEME_OPTIONS: { key: ThemeMode; label: string }[] = [
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
  { key: 'system', label: 'System' },
];

export function SettingsScreen({ navigation }: TabScreenProps<'Settings'>) {
  const { colors: c, mode, setMode } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { biometric, biometricLogin, session, push, baseUrl, signOut } = useServices();
  const user = useSession()?.user;
  const queued = useMyQueuedChanges();
  const [bioOn, setBioOn] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [pushPerm, setPushPerm] = useState<{ status: PushPermission; canAskAgain: boolean } | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const prefsQ = useNotificationPreferences();
  const savePrefs = useSaveNotificationPreferences();
  const prefs = prefsQ.data;
  const [prefsErr, setPrefsErr] = useState<string | null>(null);
  const save = (next: Parameters<typeof savePrefs.mutate>[0]) => {
    setPrefsErr(null);
    savePrefs.mutate(next, { onError: () => setPrefsErr('Couldn’t save — check your connection and try again.') });
  };
  const openPage = (path: string) => void Linking.openURL(sitePageUrl(baseUrl, path)).catch(() => {});

  useEffect(() => {
    void biometric.isEnabled().then(setBioOn);
  }, [biometric]);

  // Notification permission — re-read when coming back from the system settings (NTF-01).
  const refreshPushPerm = useCallback(() => {
    void getPushPermission().then(setPushPerm);
  }, []);
  useEffect(() => {
    refreshPushPerm();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refreshPushPerm();
    });
    return () => sub.remove();
  }, [refreshPushPerm]);

  async function toggleBiometric(next: boolean) {
    setBioBusy(true);
    try {
      if (next) {
        await biometric.setEnabled(true); // requires strong biometrics (fingerprint) to be enrolled
        const s = session.getSession();
        try {
          // Stored behind a biometric-bound keystore key: this shows the fingerprint prompt once.
          if (s) await biometricLogin.arm(s.refreshToken, s.user.username || s.user.email);
        } catch {
          await biometric.setEnabled(false);
          Alert.alert('Biometrics not turned on', 'Your fingerprint was not confirmed. Please try again.');
          setBioOn(false);
          return;
        }
      } else {
        await biometric.setEnabled(false);
        await biometricLogin.disarm();
      }
      setBioOn(next);
    } catch {
      Alert.alert('Biometrics unavailable', 'Set up a fingerprint on your device first. Face unlock that uses only the camera is not secure enough.');
      setBioOn(false);
    } finally {
      setBioBusy(false);
    }
  }

  async function enableNotifications() {
    setPushBusy(true);
    try {
      await push.register(); // asks for permission when the OS still allows it
    } catch {
      /* offline — registration is retried on the next launch */
    } finally {
      setPushBusy(false);
      refreshPushPerm();
    }
  }

  async function doSignOut() {
    setSigningOut(true);
    try {
      await signOut('user');
    } finally {
      setSigningOut(false);
    }
  }

  function confirmLogout() {
    const unsynced = queued.pending.length + queued.failed.length;
    const message =
      unsynced > 0
        ? `${unsynced === 1 ? '1 change has' : `${unsynced} changes have`} not been saved to the server yet. ` +
          'Signing out deletes them from this phone. Sign out anyway?'
        : 'Are you sure you want to sign out?';
    Alert.alert(unsynced > 0 ? 'Unsynced changes' : 'Sign out', message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void doSignOut() },
    ]);
  }

  const pushOff = pushPerm && pushPerm.status !== 'granted';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <SyncStatus />

        <View style={styles.section}>
          <SectionTitle>Account</SectionTitle>
          <Pressable onPress={() => navigation.navigate('Profile')} accessibilityRole="button" accessibilityLabel="Open your profile">
            <Card>
              <Text style={styles.name}>{user?.username ?? 'Account'}</Text>
              <Muted>{user?.email}</Muted>
            </Card>
          </Pressable>
        </View>

        <View style={styles.section}>
          <SectionTitle>Appearance</SectionTitle>
          <Card>
            <View style={styles.segment} accessibilityRole="radiogroup">
              {THEME_OPTIONS.map((opt) => {
                const active = opt.key === mode;
                return (
                  <Pressable
                    key={opt.key}
                    onPress={() => setMode(opt.key)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active, checked: active }}
                    accessibilityLabel={`${opt.label} theme`}
                    style={[styles.segmentItem, active && styles.segmentItemActive]}
                  >
                    <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{opt.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </Card>
        </View>

        <View style={styles.section}>
          <SectionTitle>Notifications</SectionTitle>
          <Card>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Push notifications</Text>
              <Muted>
                {pushPerm === null
                  ? 'Checking…'
                  : pushOff
                    ? 'Off — you will not be alerted about assignments, mentions or messages.'
                    : 'On'}
              </Muted>
            </View>
            {pushOff ? (
              pushPerm?.canAskAgain ? (
                <Button title="Turn on notifications" variant="secondary" onPress={() => void enableNotifications()} loading={pushBusy} style={styles.rowBtn} />
              ) : (
                <Button title="Open system settings" variant="secondary" onPress={openAppSettings} style={styles.rowBtn} />
              )
            ) : null}
          </Card>
        </View>

        <View style={styles.section}>
          <SectionTitle>Notify me about</SectionTitle>
          <Card>
            {prefsQ.isError && !prefs ? (
              <Muted>Your choices can’t be loaded right now.</Muted>
            ) : (
              NOTIFICATION_TYPES.map((n, i) => (
                <View key={n.type} style={[styles.row, i > 0 && styles.divided]}>
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle}>{n.label}</Text>
                    <Muted>{n.description}</Muted>
                  </View>
                  <Switch
                    value={isTypeOn(prefs, n.type)}
                    disabled={!prefs}
                    onValueChange={() => save(toggleType(prefs, n.type))}
                    accessibilityLabel={n.label}
                    trackColor={{ true: c.brand, false: c.line }}
                    thumbColor={c.surface}
                  />
                </View>
              ))
            )}
            <View style={styles.divided}>
              <Text style={styles.rowTitle}>“Due soon” reminder</Text>
              <View style={styles.chips} accessibilityRole="radiogroup">
                {REMINDER_OPTIONS.map((o) => {
                  const active = (prefs?.reminderLeadMinutes ?? null) === o.minutes;
                  return (
                    <Pressable
                      key={o.label}
                      disabled={!prefs}
                      onPress={() => save(withReminderLead(prefs, o.minutes))}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: active, selected: active }}
                      style={[styles.chip, active && styles.chipActive]}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>{o.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
            {prefsErr ? <Text style={styles.error} accessibilityRole="alert">{prefsErr}</Text> : null}
            <Muted>These apply to the app, email and phone alerts, and match your choices on the web.</Muted>
          </Card>
        </View>

        <View style={styles.section}>
          <SectionTitle>Security</SectionTitle>
          <Card>
            <View style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>Biometric unlock</Text>
                <Muted>Ask for your fingerprint when the app opens or returns after a few minutes away.</Muted>
              </View>
              <Switch
                value={bioOn}
                disabled={bioBusy}
                onValueChange={(v) => void toggleBiometric(v)}
                accessibilityLabel="Biometric unlock"
                trackColor={{ true: c.brand, false: c.line }}
                thumbColor={c.surface}
              />
            </View>
          </Card>
        </View>

        <View style={styles.section}>
          <SectionTitle>Shortcuts</SectionTitle>
          <Pressable onPress={() => navigation.navigate('Calendar')} accessibilityRole="button" accessibilityLabel="Open calendar">
            <Card>
              <Text style={styles.rowTitle}>Calendar</Text>
            </Card>
          </Pressable>
        </View>

        <View style={styles.section}>
          <SectionTitle>About</SectionTitle>
          <Card>
            <Muted>Connected to</Muted>
            <Text style={styles.mono}>{baseUrl}</Text>
            <View style={[styles.links, styles.divided]}>
              <Pressable onPress={() => openPage('/privacy')} accessibilityRole="link" hitSlop={6}>
                <Text style={styles.linkText}>Privacy policy</Text>
              </Pressable>
              <Pressable onPress={() => openPage('/terms')} accessibilityRole="link" hitSlop={6}>
                <Text style={styles.linkText}>Terms of use</Text>
              </Pressable>
            </View>
          </Card>
        </View>

        <Button title="Sign out" variant="secondary" onPress={confirmLogout} loading={signingOut} />
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.ground },
    scroll: { padding: spacing.lg, gap: spacing.lg },
    section: { gap: spacing.sm },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
    rowText: { flex: 1 },
    rowTitle: { fontSize: fontSize.md, fontWeight: '600', color: c.ink },
    rowBtn: { marginTop: spacing.md },
    name: { fontSize: fontSize.lg, fontWeight: '700', color: c.ink },
    mono: { fontSize: fontSize.sm, color: c.ink, marginTop: 2 },
    segment: { flexDirection: 'row', backgroundColor: c.ground, borderRadius: radius.md, padding: 3, gap: 3 },
    segmentItem: { flex: 1, minHeight: 44, paddingVertical: spacing.sm, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
    segmentItemActive: { backgroundColor: c.brand },
    segmentText: { fontSize: fontSize.sm, fontWeight: '600', color: c.ink2 },
    segmentTextActive: { color: c.onBrand },
    divided: { borderTopWidth: 1, borderTopColor: c.line, paddingTop: spacing.md, marginTop: spacing.md },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
    chip: { borderWidth: 1, borderColor: c.line, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, minHeight: 36, justifyContent: 'center' },
    chipActive: { borderColor: c.brand, backgroundColor: c.brandWash },
    chipText: { fontSize: fontSize.sm, color: c.ink, fontWeight: '600' },
    chipTextActive: { color: c.brand },
    error: { fontSize: fontSize.sm, color: c.danger, marginTop: spacing.sm },
    links: { flexDirection: 'row', gap: spacing.lg },
    linkText: { fontSize: fontSize.sm, fontWeight: '700', color: c.brand },
  });
