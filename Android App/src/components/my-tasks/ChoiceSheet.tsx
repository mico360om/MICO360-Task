import React from 'react';
import { Text, Pressable, View, StyleSheet } from 'react-native';
import { useColors } from '../../core/theme';
import { Sheet } from '../meeting/sheet-kit';
import { Button } from '../ui';
import { spacing, radius, fontSize } from '../../lib/theme';
import { font } from '../../lib/typography';
import { Icon } from '../Icon';

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
              <Text style={[styles.text, { color: on ? c.brandText : c.ink }, on && styles.on]}>{o.label}</Text>
              {on ? <Icon name="misc.check" size={18} color={c.brandText} /> : null}
            </Pressable>
          );
        })}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  option: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 48, paddingHorizontal: spacing.sm, borderRadius: radius.button },
  dot: { width: 10, height: 10, borderRadius: 5 },
  text: { flex: 1, fontSize: fontSize.md, ...font('600') },
  on: { ...font('800') },
});
