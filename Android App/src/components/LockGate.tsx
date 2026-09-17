import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useServices, useSession } from '../core/providers';
import { useColors } from '../core/theme';
import { Button } from './ui';
import { spacing, fontSize, type Palette } from '../lib/theme';

/**
 * Gates the app behind the OS biometric prompt when the user has enabled
 * biometric unlock (A1.3). No session, or the feature disabled → renders through.
 */
export function LockGate({ children }: { children: React.ReactNode }) {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { biometric, session } = useServices();
  const authed = useSession();
  const [locked, setLocked] = useState(false);
  const [failed, setFailed] = useState(false);

  const tryUnlock = useCallback(async () => {
    const res = await biometric.unlock();
    if (res.ok) {
      setLocked(false);
      setFailed(false);
    } else {
      setFailed(true);
    }
  }, [biometric]);

  useEffect(() => {
    let active = true;
    (async () => {
      if (authed && (await biometric.isEnabled())) {
        if (!active) return;
        setLocked(true);
        void tryUnlock();
      } else if (active) {
        setLocked(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [authed, biometric, tryUnlock]);

  if (authed && locked) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.emoji}>🔒</Text>
        <Text style={styles.title}>MICO360 Tasks is locked</Text>
        <Text style={styles.sub}>Unlock with your fingerprint or face to continue.</Text>
        <Button title="Unlock" onPress={tryUnlock} style={styles.btn} />
        {failed ? <Button title="Sign out instead" variant="ghost" onPress={() => void session.logout()} /> : null}
      </View>
    );
  }

  return <>{children}</>;
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md, backgroundColor: c.ground },
    emoji: { fontSize: 44 },
    title: { fontSize: fontSize.xl, fontWeight: '800', color: c.ink, textAlign: 'center' },
    sub: { fontSize: fontSize.md, color: c.ink2, textAlign: 'center', marginBottom: spacing.md },
    btn: { alignSelf: 'stretch' },
  });
