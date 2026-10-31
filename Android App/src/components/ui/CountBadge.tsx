import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useColors } from '../../core/theme';
import { radius } from '../../lib/theme';
import { font } from '../../lib/typography';

/** How far a badge's number may grow with the phone's font size: it still fits its badge (re-check I). */
export const COUNT_BADGE_FONT_CAP = 1.3;

/**
 * A count on a button or a tab (the bell's unread alerts, the Chat tab's unread messages): the number
 * in white on the brand, ringed in the surface, at a corner (`style` moves it). The number grows with
 * the font up to COUNT_BADGE_FONT_CAP and the badge, at least 18 dp, grows to fit it. Hidden from
 * TalkBack: the button or tab says the count in its own name.
 */
export function CountBadge({ value, style }: { value: number | string; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return (
    <View style={[styles.badge, { backgroundColor: c.brand, borderColor: c.surface }, style]} importantForAccessibility="no-hide-descendants">
      <Text style={[styles.text, { color: c.onBrand }]} numberOfLines={1} maxFontSizeMultiplier={COUNT_BADGE_FONT_CAP}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    minHeight: 18,
    paddingHorizontal: 4,
    borderRadius: radius.pill,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { ...font('600'), fontSize: 10, lineHeight: 12, fontVariant: ['tabular-nums'], includeFontPadding: false },
});
