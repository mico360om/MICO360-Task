import { StyleSheet, Text, View } from 'react-native';
import { typeStyle } from '../../lib/typography';
import { useColors } from '../../core/theme';
import { Muted } from './Text';

/** "Nothing here yet" for an empty list (the icon and action come in the next step). */
export function EmptyState({ title, subtitle }: { title: string; subtitle?: string }) {
  const c = useColors();
  return (
    <View style={styles.empty}>
      <Text style={[typeStyle('heading'), { color: c.ink }]}>{title}</Text>
      {subtitle ? <Muted style={{ textAlign: 'center' }}>{subtitle}</Muted> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8 },
});
