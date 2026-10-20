import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useServices } from '../core/providers';
import { useServerConfig, useServerVersion } from '../core/queries';
import { useColors } from '../core/theme';
import { updateAvailable } from '../lib/app-version';
import { sitePageUrl } from '../lib/server-address';
import { spacing, fontSize, radius, type Palette } from '../lib/theme';

/**
 * "A new version of MICO360 Tasks is available" — shown when the server runs a newer release than
 * this app (the website and the app share one version number). Download opens the site's Android
 * download.
 */
export function UpdateBanner() {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const { app, baseUrl } = useServices();
  const server = useServerVersion().data?.version ?? null;
  const config = useServerConfig().data;
  const insets = useSafeAreaInsets();
  if (!updateAvailable(app.version, server)) return null;
  const download = config?.androidAppUrl || sitePageUrl(baseUrl, '/downloads/MICO360-Tasks.apk');
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
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    wrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm, backgroundColor: c.brand },
    text: { flex: 1, color: '#fff', fontSize: fontSize.sm, fontWeight: '600' },
    button: { minHeight: 40, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: '#fff' },
    buttonText: { color: c.brand, fontWeight: '800', fontSize: fontSize.sm },
  });
