import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Switch, Pressable, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useServices, useSession } from '../core/providers';
import { useTheme, type ThemeMode } from '../core/theme';
import { Card, SectionTitle, Button, Muted } from '../components/ui';
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
  const { biometric, biometricLogin, session, push, baseUrl } = useServices();
  const user = useSession()?.user;
  const [bioOn, setBioOn] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);

  useEffect(() => {
    void biometric.isEnabled().then(setBioOn);
  }, [biometric]);

  async function toggleBiometric(next: boolean) {
    setBioBusy(true);
    try {
      await biometric.setEnabled(next);
      if (next) {
        // Remember the current session so the user can sign in with biometrics later.
        const s = session.getSession();
        if (s) await biometricLogin.arm(s.refreshToken, s.user.username || s.user.email);
      } else {
        await biometricLogin.disarm();
      }
      setBioOn(next);
    } catch {
      Alert.alert('Biometrics unavailable', 'Set up a fingerprint or face unlock on your device first.');
      setBioOn(false);
    } finally {
      setBioBusy(false);
    }
  }

  function confirmLogout() {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => {
          void push.unregister().catch(() => {});
          void session.logout();
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
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
            <View style={styles.segment}>
              {THEME_OPTIONS.map((opt) => {
                const active = opt.key === mode;
                return (
                  <Pressable
                    key={opt.key}
                    onPress={() => setMode(opt.key)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
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
          <SectionTitle>Security</SectionTitle>
          <Card>
            <View style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>Biometric unlock &amp; sign-in</Text>
                <Muted>Use fingerprint or face to open the app and to sign back in.</Muted>
              </View>
              <Switch
                value={bioOn}
                disabled={bioBusy}
                onValueChange={toggleBiometric}
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
          </Card>
        </View>

        <Button title="Sign out" variant="secondary" onPress={confirmLogout} />
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
    name: { fontSize: fontSize.lg, fontWeight: '700', color: c.ink },
    mono: { fontSize: fontSize.sm, color: c.ink, marginTop: 2 },
    segment: { flexDirection: 'row', backgroundColor: c.ground, borderRadius: radius.md, padding: 3, gap: 3 },
    segmentItem: { flex: 1, minHeight: 44, paddingVertical: spacing.sm, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
    segmentItemActive: { backgroundColor: c.brand },
    segmentText: { fontSize: fontSize.sm, fontWeight: '600', color: c.ink2 },
    segmentTextActive: { color: c.onBrand },
  });
