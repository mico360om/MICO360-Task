import { Image, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import SPLASH_IMAGE from '../../assets/logo.png';
import { lightColors } from '../lib/theme';

/**
 * What shows while the app starts — the brand fonts loading (at most core/fonts' FONT_WAIT_MS), the
 * services and the lock setting being read: the app.json splash — its maroon background and its
 * picture, contained — so the native splash runs straight on into it, with the status bar's icons
 * light on it (over the navigator's own choice while the lock gate's cover shows). It loads nothing
 * that styles text (App picks the faces first).
 */
export function FontSplash() {
  return (
    <View style={styles.fill} accessible accessibilityLabel="MICO360 Tasks is starting">
      <StatusBar style="light" />
      <Image source={SPLASH_IMAGE} style={StyleSheet.absoluteFill} resizeMode="contain" accessibilityIgnoresInvertColors />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: lightColors.brand },
});
