import { View } from 'react-native';
import { clampPercent } from '../../lib/ui-kit';
import { useColors } from '../../core/theme';

/** A thin bar in the project's colour (brand by default); TalkBack hears the label and the percent. */
export function ProgressBar({ value, label, color, height = 6 }: { value: number; label: string; color?: string; height?: number }) {
  const c = useColors();
  const now = clampPercent(value);
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now }}
      style={{ height, borderRadius: height / 2, backgroundColor: c.line2, overflow: 'hidden' }}
    >
      <View style={{ width: `${now}%`, height: '100%', borderRadius: height / 2, backgroundColor: color ?? c.brand }} />
    </View>
  );
}
