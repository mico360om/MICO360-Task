import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useColors } from '../../core/theme';
import type { InspectionListItem } from '../../lib/inspection-types';
import { INSPECTIONS_TAB_WORDS } from '../../lib/inspection-tab';
import { inspectionFacts } from '../../lib/inspection-words';
import { radius, spacing } from '../../lib/theme';
import { font, typeStyle } from '../../lib/typography';
import type { AppStackParamList } from '../../navigation/types';
import { Icon } from '../Icon';
import { Badge, ProgressBar } from '../ui';

/**
 * One inspection in the project's lists, as the website's row: its title (opens it), where, when,
 * who and for which task; finished: done late, visible to the client, and its result; in progress:
 * how far along.
 */
export function InspectionRow({ x, timeZone }: { x: InspectionListItem; timeZone: string }) {
  const c = useColors();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const finished = x.status === 'FINISHED';
  const lateDays = finished ? x.task?.lateDays ?? 0 : 0;
  return (
    <Pressable
      onPress={() => navigation.navigate('Inspection', { inspectionId: x.id, title: x.title })}
      accessibilityRole="button"
      accessibilityLabel={[x.title, inspectionFacts(x, timeZone), x.result].join(', ')}
      style={({ pressed }) => [s.row, { borderColor: c.line, backgroundColor: pressed ? c.surface2 : c.surface }]}
    >
      <View style={s.top}>
        <View style={s.main}>
          <Text style={[typeStyle('bodyStrong'), { color: c.ink }]}>{x.title}</Text>
          <Text style={[typeStyle('caption'), { color: c.ink2 }]}>{inspectionFacts(x, timeZone)}</Text>
        </View>
        <View style={s.marks}>
          {lateDays ? <Badge label={INSPECTIONS_TAB_WORDS.doneLate.replace('{n}', String(lateDays)).replace('{days}', lateDays === 1 ? 'day' : 'days')} tone="warning" /> : null}
          {x.clientVisible ? (
            <View style={[s.client, { backgroundColor: c.infoSoft }]}>
              <Icon name="misc.eye" size={12} color={c.infoText} />
              <Text style={[s.clientText, { color: c.infoText }]}>{INSPECTIONS_TAB_WORDS.visibleToClient}</Text>
            </View>
          ) : null}
          {finished ? <Badge label={x.result} tone={x.counts.failed > 0 ? 'danger' : 'success'} /> : <Text style={[typeStyle('caption'), { color: c.ink2 }]}>{x.result}</Text>}
        </View>
      </View>
      {!finished ? (
        <View style={s.bar}>
          <ProgressBar value={x.counts.total ? (x.counts.answered / x.counts.total) * 100 : 0} label={x.result} />
        </View>
      ) : null}
    </Pressable>
  );
}

const s = StyleSheet.create({
  row: { borderWidth: 1, borderRadius: radius.button, padding: spacing.md, minHeight: 44 },
  top: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: spacing.sm },
  main: { flexShrink: 1, flexGrow: 1, gap: 2 },
  marks: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  client: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.badge, paddingHorizontal: 6, paddingVertical: 2 },
  clientText: { ...font('600'), fontSize: 12, lineHeight: 16 },
  bar: { marginTop: spacing.sm },
});
