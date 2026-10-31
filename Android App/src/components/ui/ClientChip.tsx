import { StyleSheet, Text, View } from 'react-native';
import { radius } from '../../lib/theme';
import { font } from '../../lib/typography';
import { useColors } from '../../core/theme';
import { Icon } from '../Icon';

/** The website's "Visible to client" mark on a task shown on its project's client page: the eye and the words, in blue. */
export function ClientChip() {
  const c = useColors();
  return (
    <View
      accessible
      accessibilityLabel="Visible to client"
      accessibilityHint="Shown on the project’s client page"
      style={[styles.chip, { backgroundColor: c.infoSoft }]}
    >
      <Icon name="misc.eye" size={12} color={c.infoText} />
      <Text style={[styles.text, { color: c.infoText }]} numberOfLines={1}>
        Visible to client
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', borderRadius: radius.badge, paddingHorizontal: 6, paddingVertical: 2 },
  text: { fontSize: 12, lineHeight: 16, ...font('600') },
});
