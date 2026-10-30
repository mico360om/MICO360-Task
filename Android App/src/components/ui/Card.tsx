import type { ReactNode } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { radius, shadow } from '../../lib/theme';
import { useColors } from '../../core/theme';

/** The website's card: surface, 1 px line, radius 18, soft card shadow; tappable with `onPress`. */
export function Card({
  children,
  style,
  onPress,
  accessibilityLabel,
  padded = true,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  accessibilityLabel?: string;
  padded?: boolean;
}) {
  const c = useColors();
  const base: ViewStyle = {
    backgroundColor: c.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: c.line,
    ...shadow.card,
    ...(padded ? { padding: 16 } : null),
  };
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={({ pressed }) => [base, pressed ? { backgroundColor: c.surface2 } : null, style]}
      >
        {children}
      </Pressable>
    );
  }
  return (
    <View style={[base, style]} accessibilityLabel={accessibilityLabel}>
      {children}
    </View>
  );
}
