import { StyleSheet, Text, View } from 'react-native';
import { radius } from '../../lib/theme';
import { typeStyle } from '../../lib/typography';
import { toneStyle } from '../../lib/tone';
import type { IconName } from '../../lib/icons';
import { useColors } from '../../core/theme';
import { Icon } from '../Icon';
import { Card } from './Card';

/** The website's Dashboard tile: a label, a big number, an optional hint and an icon bubble in its tone. */
export function StatTile({
  label,
  value,
  hint,
  icon,
  tone = 'brand',
  onPress,
  actionLabel,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: IconName;
  tone?: 'brand' | 'success' | 'warning' | 'info' | 'danger';
  onPress?: () => void;
  /** What tapping the tile does, e.g. "Open your overdue tasks". */
  actionLabel?: string;
}) {
  const c = useColors();
  const t = toneStyle(c, tone);
  const name = `${label}: ${value}${hint ? `, ${hint}` : ''}`;
  return (
    <Card onPress={onPress} accessibilityLabel={onPress ? name : undefined} accessibilityHint={onPress ? actionLabel : undefined}>
      <View style={styles.row} accessible={!onPress} accessibilityLabel={onPress ? undefined : name}>
        <View style={styles.text}>
          <Text style={[typeStyle('eyebrow'), { color: c.ink2 }]} numberOfLines={2}>
            {label}
          </Text>
          <Text style={[typeStyle('display'), styles.value, { color: c.ink }]} numberOfLines={1} adjustsFontSizeToFit>
            {value}
          </Text>
          {hint ? (
            <Text style={[typeStyle('caption'), { color: c.ink2 }]} numberOfLines={2}>
              {hint}
            </Text>
          ) : null}
        </View>
        {icon ? (
          <View style={[styles.bubble, { backgroundColor: t.bg }]}>
            <Icon name={icon} size={20} color={t.fg} />
          </View>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  text: { flex: 1, gap: 4 },
  value: { marginTop: 2 },
  bubble: { width: 40, height: 40, borderRadius: radius.button, alignItems: 'center', justifyContent: 'center' },
});
