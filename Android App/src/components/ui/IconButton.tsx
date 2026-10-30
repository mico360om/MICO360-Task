import { Pressable, StyleSheet, Text, View } from 'react-native';
import { radius } from '../../lib/theme';
import { font } from '../../lib/typography';
import type { IconName } from '../../lib/icons';
import { useColors } from '../../core/theme';
import { Icon } from '../Icon';

/**
 * A 44×44 button showing one drawn icon; `label` is what TalkBack says (put any count in it).
 * `badge` draws a small brand count on the corner (the bell's unread number).
 */
export function IconButton({
  icon,
  label,
  onPress,
  variant = 'plain',
  size = 20,
  color,
  badge,
  hint,
  disabled,
  rotate,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  variant?: 'plain' | 'outlined';
  size?: number;
  color?: string;
  badge?: number | string;
  hint?: string;
  disabled?: boolean;
  /** Turns the icon (`ui.back` at 180 is "next"). */
  rotate?: 0 | 90 | 180 | 270;
}) {
  const c = useColors();
  const showBadge = badge !== undefined && badge !== '' && badge !== 0;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        styles.box,
        variant === 'outlined' ? { borderWidth: 1, borderColor: c.line, borderRadius: radius.input } : null,
        disabled ? styles.dim : pressed ? { backgroundColor: c.ground } : null,
      ]}
    >
      <Icon name={icon} size={size} color={color ?? c.ink2} rotate={rotate} />
      {showBadge ? (
        <View style={[styles.badge, { backgroundColor: c.brand, borderColor: c.surface }]} importantForAccessibility="no-hide-descendants">
          <Text style={[styles.badgeText, { color: c.onBrand }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
            {badge}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.input },
  dim: { opacity: 0.4 },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { ...font('600'), fontSize: 10, lineHeight: 12, fontVariant: ['tabular-nums'] },
});
