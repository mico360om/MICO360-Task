import { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BRAND_GRADIENT, radius, shadow } from '../../lib/theme';
import { typeStyle } from '../../lib/typography';
import { buttonLook, type ButtonSize, type ButtonVariant } from '../../lib/ui-kit';
import type { IconName } from '../../lib/icons';
import { useColors } from '../../core/theme';
import { Icon } from '../Icon';

/** The website's Button: gradient primary, neutral secondary, ghost, danger; sm / md / lg. */
export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  loading,
  disabled,
  style,
  accessibilityLabel,
  accessibilityHint,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}) {
  const c = useColors();
  const look = useMemo(() => buttonLook(c, variant, size), [c, variant, size]);
  const isDisabled = !!disabled || !!loading;
  return (
    <Pressable
      accessibilityRole="button"
      // Keep the name while the spinner replaces the text, and announce busy/disabled (MOB-10).
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isDisabled, busy: !!loading }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        { minHeight: look.minHeight, paddingHorizontal: look.paddingHorizontal },
        look.fill === 'gradient' ? shadow.brand : look.fill ? { backgroundColor: look.fill } : null,
        look.border ? { borderWidth: 1, borderColor: look.border } : null,
        isDisabled ? styles.dim : pressed ? styles.pressed : null,
        style,
      ]}
    >
      {look.fill === 'gradient' ? (
        <LinearGradient colors={BRAND_GRADIENT.colors} locations={BRAND_GRADIENT.locations} start={BRAND_GRADIENT.start} end={BRAND_GRADIENT.end} style={styles.fill} />
      ) : null}
      <View style={styles.row}>
        {loading ? (
          <ActivityIndicator color={look.text} />
        ) : (
          <>
            {icon ? <Icon name={icon} size={18} color={look.text} /> : null}
            <Text style={[typeStyle('button'), { fontSize: look.fontSize, color: look.text }]} numberOfLines={1}>
              {title}
            </Text>
          </>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: radius.button, alignItems: 'center', justifyContent: 'center' },
  fill: { ...StyleSheet.absoluteFillObject, borderRadius: radius.button },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  pressed: { opacity: 0.85 },
  dim: { opacity: 0.6 },
});
