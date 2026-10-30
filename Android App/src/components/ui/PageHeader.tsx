import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { typeStyle } from '../../lib/typography';
import { useColors } from '../../core/theme';

/** A page's title in the content (the top bar carries the logo): title, subtitle, and actions that wrap below when there is no room. */
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  const c = useColors();
  return (
    <View style={styles.row}>
      <View style={styles.text}>
        <Text style={[typeStyle('title'), { color: c.ink }]} accessibilityRole="header" numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? <Text style={[typeStyle('body'), { color: c.ink2 }]}>{subtitle}</Text> : null}
      </View>
      {actions ? <View style={styles.actions}>{actions}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 44, marginBottom: 16 },
  text: { flexGrow: 1, flexShrink: 1, flexBasis: 200, gap: 2 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
