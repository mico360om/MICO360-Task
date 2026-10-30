import { Pressable, StyleSheet, Text, View } from 'react-native';
import { radius } from '../../lib/theme';
import { typeStyle } from '../../lib/typography';
import { chipLook } from '../../lib/ui-kit';
import { useColors } from '../../core/theme';

/**
 * A selectable chip (filters, status, priority, scope…): brand fill with white text when selected,
 * an optional colour `dot` and `count`. 32 dp tall; the hit area reaches 44 dp.
 */
export function Chip({
  label,
  selected = false,
  onPress,
  count,
  dot,
  disabled,
  a11yLabel,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  count?: number;
  /** The dot's colour. */
  dot?: string;
  disabled?: boolean;
  a11yLabel?: string;
}) {
  const c = useColors();
  const look = chipLook(c, selected);
  const name = a11yLabel ?? (count !== undefined ? `${label}, ${count}` : label);
  return (
    <Pressable
      onPress={onPress}
      disabled={!!disabled || !onPress}
      hitSlop={{ top: 6, bottom: 6 }}
      accessibilityRole="button"
      accessibilityLabel={name}
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: look.bg, borderColor: look.border },
        disabled ? styles.dim : pressed ? styles.pressed : null,
      ]}
    >
      {dot ? <View style={[styles.dot, { backgroundColor: dot, borderColor: selected ? c.onBrand : 'transparent' }]} /> : null}
      <Text style={[styles.text, { color: look.fg }]} numberOfLines={1}>
        {label}
      </Text>
      {count !== undefined ? <Text style={[styles.count, { color: look.fg }]}>{count}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 32,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
  },
  text: { ...typeStyle('button'), fontSize: 13, lineHeight: 18 },
  count: { ...typeStyle('number'), fontSize: 12, lineHeight: 16, opacity: 0.85 },
  dot: { width: 8, height: 8, borderRadius: 4, borderWidth: 1 },
  pressed: { opacity: 0.85 },
  dim: { opacity: 0.5 },
});
