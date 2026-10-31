import { StyleSheet, Text, View } from 'react-native';
import { radius } from '../../lib/theme';
import { font } from '../../lib/typography';
import { useColors } from '../../core/theme';
import { Icon } from '../Icon';

/**
 * The website's InspectionChip: on a task carried out with an inspection form (a check), a word with
 * a small clipboard — never the icon alone — in the brand's tint.
 */
export function InspectionChip({ size = 'xs' }: { size?: 'xs' | 'sm' }) {
  const c = useColors();
  const xs = size === 'xs';
  return (
    <View
      accessible
      accessibilityLabel="Inspection"
      accessibilityHint="Carried out with an inspection form"
      style={[styles.chip, { backgroundColor: c.brandWash, paddingHorizontal: xs ? 4 : 6 }]}
    >
      <Icon name="misc.inspection" size={xs ? 11 : 12} color={c.brandText} />
      <Text style={[styles.text, { color: c.brandText, fontSize: xs ? 11 : 12, lineHeight: xs ? 14 : 16 }]} numberOfLines={1}>
        Inspection
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', borderRadius: radius.badge, paddingVertical: 2 },
  text: { ...font('600') },
});
