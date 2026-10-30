import { Pressable, StyleSheet, Text, View } from 'react-native';
import { shadow } from '../../lib/theme';
import { typeStyle } from '../../lib/typography';
import { toggleLook } from '../../lib/ui-kit';
import { useColors } from '../../core/theme';

/** The website's switch: a 44×24 track, brand when on, with its label; TalkBack hears a switch. */
export function Toggle({
  on,
  onChange,
  label,
  disabled,
  hint,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  hint?: string;
}) {
  const c = useColors();
  const look = toggleLook(c, on);
  return (
    <Pressable
      onPress={() => onChange(!on)}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ checked: on, disabled: !!disabled }}
      style={[styles.row, disabled ? styles.dim : null]}
    >
      <Text style={[typeStyle('label'), styles.label, { color: c.ink }]}>{label}</Text>
      <View style={[styles.track, { backgroundColor: look.track }]}>
        <View style={[styles.thumb, shadow.soft, { backgroundColor: look.thumb, left: on ? 22 : 2 }]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12 },
  label: { flex: 1 },
  track: { width: 44, height: 24, borderRadius: 12 },
  thumb: { position: 'absolute', top: 2, width: 20, height: 20, borderRadius: 10 },
  dim: { opacity: 0.5 },
});
