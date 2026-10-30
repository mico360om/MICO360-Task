import { StyleSheet, Text, View } from 'react-native';
import { radius } from '../../lib/theme';
import { typeStyle } from '../../lib/typography';
import type { IconName } from '../../lib/icons';
import { useColors } from '../../core/theme';
import { Icon } from '../Icon';
import { Button } from './Button';

/** The website's EmptyState: an icon in a brand bubble, what is missing, and what to do next. */
export function EmptyState({
  title,
  subtitle,
  icon = 'misc.inbox',
  action,
}: {
  title: string;
  subtitle?: string;
  icon?: IconName;
  action?: { title: string; onPress: () => void };
}) {
  const c = useColors();
  return (
    <View style={styles.empty}>
      <View style={[styles.bubble, { backgroundColor: c.brandWash }]}>
        <Icon name={icon} size={24} color={c.brandText} />
      </View>
      <Text style={[typeStyle('bodyStrong'), styles.center, { color: c.ink }]}>{title}</Text>
      {subtitle ? <Text style={[typeStyle('body'), styles.center, styles.subtitle, { color: c.ink2 }]}>{subtitle}</Text> : null}
      {action ? <Button title={action.title} onPress={action.onPress} style={styles.action} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8 },
  bubble: { width: 48, height: 48, borderRadius: radius.card, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  center: { textAlign: 'center' },
  subtitle: { maxWidth: 320 },
  action: { marginTop: 8 },
});
