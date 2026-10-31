import { Image, StyleSheet, View } from 'react-native';
import SPLASH_IMAGE from '../../assets/logo.png';
import { lightColors } from '../lib/theme';

/**
 * What shows while the brand fonts load (at most core/fonts' FONT_WAIT_MS): the app.json splash —
 * its maroon background and its picture, contained — so the native splash runs straight on into it.
 * It loads nothing that styles text (App picks the faces first).
 */
export function FontSplash() {
  return (
    <View style={styles.fill} accessible accessibilityLabel="MICO360 Tasks is starting">
      <Image source={SPLASH_IMAGE} style={StyleSheet.absoluteFill} resizeMode="contain" accessibilityIgnoresInvertColors />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: lightColors.brand },
});
