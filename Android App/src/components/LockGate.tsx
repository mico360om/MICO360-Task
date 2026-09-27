import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, AppState, Modal } from 'react-native';
import { useServices, useUserId } from '../core/providers';
import { useColors } from '../core/theme';
import { Button } from './ui';
import { useDrawerStore } from '../lib/drawer-store';
import { createLockPolicy } from '../lib/lock-policy';
import { spacing, fontSize, type Palette } from '../lib/theme';

/**
 * Gates the app behind the OS biometric prompt when the user has enabled biometric unlock
 * (A1.3, MOB-03):
 * - it reacts to the signed-in USER, not the session object, so silent token refreshes never
 *   trigger it;
 * - it locks on a cold start with a saved session and when the app returns from the background
 *   after the grace period — never right after the user signed in;
 * - it is an overlay (a full-screen Modal): the navigation tree underneath stays mounted, so the
 *   screen, scroll position and any half-typed comment are still there after unlocking.
 */
export function LockGate({ children }: { children: React.ReactNode }) {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { biometric, signOut } = useServices();
  const userId = useUserId();
  const policy = useRef(createLockPolicy()).current;
  const [locked, setLockedState] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const setLocked = useCallback(
    (value: boolean) => {
      policy.setLocked(value);
      setLockedState(value);
    },
    [policy],
  );

  const tryUnlock = useCallback(async () => {
    setBusy(true);
    try {
      const res = await biometric.unlock();
      if (res.ok) {
        setLocked(false);
        setFailed(false);
      } else {
        setFailed(true);
      }
    } finally {
      setBusy(false);
    }
  }, [biometric, setLocked]);

  const lockIfEnabled = useCallback(async () => {
    if (!(await biometric.isEnabled())) return;
    useDrawerStore.getState().closeDrawer();
    setLocked(true);
    setFailed(false);
    void tryUnlock();
  }, [biometric, setLocked, tryUnlock]);

  // Signed-in user changed (cold start with a saved session → lock; fresh sign-in → no lock).
  useEffect(() => {
    if (policy.onUserChange(userId)) void lockIfEnabled();
    else if (!userId) setLocked(false);
  }, [userId, policy, lockIfEnabled, setLocked]);

  // Back from the background after the grace period → lock.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') policy.onBackground();
      else if (state === 'active' && policy.onForeground()) void lockIfEnabled();
    });
    return () => sub.remove();
  }, [policy, lockIfEnabled]);

  const showLock = !!userId && locked;

  return (
    <View style={styles.fill}>
      {/* Hidden from screen readers (and covered) while locked, but never unmounted. */}
      <View style={styles.fill} importantForAccessibility={showLock ? 'no-hide-descendants' : 'auto'}>
        {children}
      </View>
      {/* A Modal so it also covers any open sheet or drawer (they are Modals too). Back is ignored. */}
      <Modal visible={showLock} animationType="none" transparent={false} statusBarTranslucent onRequestClose={() => {}}>
        <View style={styles.overlay} accessibilityViewIsModal>
          <Text style={styles.emoji} importantForAccessibility="no">
            🔒
          </Text>
          <Text style={styles.title} accessibilityRole="header">
            MICO360 Tasks is locked
          </Text>
          <Text style={styles.sub}>Unlock with your fingerprint to continue.</Text>
          <Button title="Unlock" onPress={() => void tryUnlock()} loading={busy} style={styles.btn} />
          {failed ? (
            // 'lock': revoke the session, but keep the owner's unsynced offline changes.
            <Button title="Sign out instead" variant="ghost" onPress={() => void signOut('lock')} />
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    fill: { flex: 1 },
    overlay: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing.xl,
      gap: spacing.md,
      backgroundColor: c.ground,
    },
    emoji: { fontSize: 44 },
    title: { fontSize: fontSize.xl, fontWeight: '800', color: c.ink, textAlign: 'center' },
    sub: { fontSize: fontSize.md, color: c.ink2, textAlign: 'center', marginBottom: spacing.md },
    btn: { alignSelf: 'stretch' },
  });
