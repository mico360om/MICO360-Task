import { StyleSheet, Text, View } from 'react-native';
import { radius } from '../../lib/theme';
import { font } from '../../lib/typography';
import { useColors } from '../../core/theme';
import { Icon } from '../Icon';

/** The website's ApprovalChip: the hourglass and "Waiting for approval", in amber. */
export function ApprovalChip({ size = 'xs' }: { size?: 'xs' | 'sm' }) {
  const c = useColors();
  const xs = size === 'xs';
  return (
    <View
      accessible
      accessibilityLabel="Waiting for approval"
      style={[styles.chip, { backgroundColor: c.warningSoft, paddingHorizontal: xs ? 4 : 6 }]}
    >
      <Icon name="misc.waiting" size={xs ? 11 : 12} color={c.warningText} />
      <Text style={[styles.text, { color: c.warningText, fontSize: xs ? 11 : 12, lineHeight: xs ? 14 : 16 }]} numberOfLines={1}>
        Waiting for approval
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', borderRadius: radius.badge, paddingVertical: 2 },
  text: { ...font('600') },
});
