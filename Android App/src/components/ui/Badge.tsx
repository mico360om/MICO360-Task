import { StyleSheet, Text, View } from 'react-native';
import { radius } from '../../lib/theme';
import { font, typeStyle } from '../../lib/typography';
import { toneStyle, type Tone } from '../../lib/tone';
import { priorityLook } from '../../lib/ui-kit';
import type { Priority } from '../../lib/types';
import { useColors } from '../../core/theme';

/** The website's Badge: a soft tone fill, small upper-case text in the tone's text colour, optional dot. */
export function Badge({ label, tone = 'neutral', dot }: { label: string; tone?: Tone; dot?: boolean }) {
  const c = useColors();
  const t = toneStyle(c, tone);
  return (
    <View style={[styles.box, { backgroundColor: t.bg }]}>
      {dot ? <View style={[styles.dot, { backgroundColor: t.fg }]} /> : null}
      <Text style={[typeStyle('badge'), { color: t.fg }]}>{label}</Text>
    </View>
  );
}

/** The website's PriorityBadge: Low/Normal neutral, High amber, Urgent red. */
export function PriorityBadge({ priority }: { priority: Priority }) {
  const c = useColors();
  const look = priorityLook(c, priority);
  return (
    <View style={[styles.box, { backgroundColor: look.bg }]} accessibilityLabel={`Priority ${look.label}`}>
      <Text style={[typeStyle('caption'), font('600'), { color: look.fg }]}>{look.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', borderRadius: radius.badge, paddingHorizontal: 8, paddingVertical: 2 },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
