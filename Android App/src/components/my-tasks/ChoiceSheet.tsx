import React from 'react';
import { Text, Pressable, View, StyleSheet } from 'react-native';
import { useColors } from '../../core/theme';
import { Sheet } from '../meeting/sheet-kit';
import { Button } from '../ui';
import { spacing, radius, fontSize } from '../../lib/theme';

/**
 * One choice from a short list, in a sheet (My Tasks' filters and sort, a bulk action's priority or
 * column — 4d): each option a radio, the chosen one ticked. Choosing closes it.
 */
export function ChoiceSheet({
  visible,
  title,
  options,
  value,
  onChoose,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: { value: string; label: string; dot?: string }[];
  /** The chosen one (none: undefined). */
  value?: string;
  onChoose: (value: string) => void;
  onClose: () => void;
}) {
  const c = useColors();
  return (
    <Sheet visible={visible} title={title} onClose={onClose} footer={<Button title="Close" variant="ghost" onPress={onClose} style={styles.flex} />}>
      <View accessibilityRole="radiogroup" accessibilityLabel={title}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable
              key={o.value || 'none'}
              onPress={() => {
                onChoose(o.value);
                onClose();
              }}
              accessibilityRole="radio"
              accessibilityLabel={o.label}
              accessibilityState={{ selected: on, checked: on }}
              style={({ pressed }) => [styles.option, pressed && { backgroundColor: c.ground }]}
            >
              {o.dot ? <View style={[styles.dot, { backgroundColor: o.dot }]} /> : null}
              <Text style={[styles.text, { color: on ? c.brand : c.ink }, on && styles.on]}>{o.label}</Text>
              {on ? <Text style={{ color: c.brand, fontWeight: '800' }}>✓</Text> : null}
            </Pressable>
          );
        })}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  option: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 48, paddingHorizontal: spacing.sm, borderRadius: radius.md },
  dot: { width: 10, height: 10, borderRadius: 5 },
  text: { flex: 1, fontSize: fontSize.md, fontWeight: '600' },
  on: { fontWeight: '800' },
});
