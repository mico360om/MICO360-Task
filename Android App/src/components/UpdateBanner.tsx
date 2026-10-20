import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useServices } from '../core/providers';
import { useServerConfig, useServerVersion } from '../core/queries';
import { useColors } from '../core/theme';
import { asyncStore } from '../adapters/async-storage';
import { offeredAppVersion, showUpdateBanner, UPDATE_DISMISSED_KEY } from '../lib/app-version';
import { sitePageUrl } from '../lib/server-address';
import { spacing, fontSize, radius, type Palette } from '../lib/theme';

/**
 * "A new version of MICO360 Tasks is available" — shown when the app file the site offers is newer
 * than this app (the server reads its version; a release that changes only the website never shows
 * it). Download opens the site's Android download; "Not now" puts it away until a newer one.
 */
export function UpdateBanner() {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const { app, baseUrl } = useServices();
  const serverVersion = useServerVersion().data?.version ?? null;
  const config = useServerConfig().data;
  // Decided once the site's settings are in, so the notice never flashes up and away again.
  const server = config ? offeredAppVersion(config, serverVersion) : null;
  const insets = useSafeAreaInsets();
  // undefined until read, so a banner already put away never flashes up.
  const [dismissed, setDismissed] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    asyncStore
      .getItem(UPDATE_DISMISSED_KEY)
      .catch(() => null)
      .then((v) => {
        if (active) setDismissed(v);
      });
    return () => {
      active = false;
    };
  }, []);
  if (dismissed === undefined || !showUpdateBanner(app.version, server, dismissed)) return null;
  const download = config?.androidAppUrl || sitePageUrl(baseUrl, '/downloads/MICO360-Tasks.apk');
  const putAway = () => {
    setDismissed(server);
    if (server) void asyncStore.setItem(UPDATE_DISMISSED_KEY, server).catch(() => {});
  };
  return (
    <View style={[s.wrap, { paddingBottom: spacing.sm + insets.bottom }]} accessibilityRole="alert">
      <Text style={s.text}>A new version of MICO360 Tasks is available (v{server}).</Text>
      <Pressable
        onPress={() => void Linking.openURL(download).catch(() => {})}
        accessibilityRole="link"
        accessibilityLabel={`Download version ${server}`}
        style={({ pressed }) => [s.button, pressed && { opacity: 0.7 }]}
      >
        <Text style={s.buttonText}>Download</Text>
      </Pressable>
      <Pressable
        onPress={putAway}
        accessibilityRole="button"
        accessibilityLabel="Not now — hide this until a newer version"
        hitSlop={6}
        style={({ pressed }) => [s.later, pressed && { opacity: 0.7 }]}
      >
        <Text style={s.laterText}>Not now</Text>
      </Pressable>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    wrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm, backgroundColor: c.brand },
    text: { flex: 1, color: '#fff', fontSize: fontSize.sm, fontWeight: '600' },
    button: { minHeight: 40, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: '#fff' },
    buttonText: { color: c.brand, fontWeight: '800', fontSize: fontSize.sm },
    later: { minHeight: 40, justifyContent: 'center', paddingHorizontal: spacing.xs },
    laterText: { color: '#fff', fontWeight: '700', fontSize: fontSize.sm, textDecorationLine: 'underline' },
  });
