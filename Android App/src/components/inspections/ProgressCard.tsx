import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useColors } from '../../core/theme';
import type { InspectionCounts } from '../../lib/inspection-types';
import { INSPECTION_WORDS, progressWords } from '../../lib/inspection-words';
import { spacing } from '../../lib/theme';
import { font, typeStyle } from '../../lib/typography';
import { Icon } from '../Icon';
import { Card, ProgressBar } from '../ui';

/** How far along an inspection is: "12 of 40 answered", passed / failed / N/A with their marks, a bar, the description. */
export function ProgressCard({ counts, description }: { counts: InspectionCounts; description: string | null }) {
  const c = useColors();
  const w = progressWords(counts);
  return (
    <Card accessibilityLabel={`Progress: ${w.answered}, ${w.passed}, ${w.failed}, ${w.na}`}>
      <View style={s.row}>
        <Text style={[typeStyle('body'), { color: c.ink }]}>
          <Text style={[typeStyle('number'), { color: c.ink }]}>{counts.answered}</Text>
          <Text style={{ color: c.ink2 }}>{` of ${counts.total} answered`}</Text>
        </Text>
        <View style={s.counts}>
          <View style={s.count}>
            <Icon name="misc.check" size={14} color={c.successText} />
            <Text style={[typeStyle('label'), { color: c.successText }]}>{w.passed}</Text>
          </View>
          <View style={s.count}>
            <Icon name="ui.close" size={14} color={counts.failed ? c.dangerText : c.ink2} />
            <Text style={[typeStyle('label'), counts.failed ? font('600') : null, { color: counts.failed ? c.dangerText : c.ink2 }]}>{w.failed}</Text>
          </View>
          <Text style={[typeStyle('label'), { color: c.ink2 }]}>{w.na}</Text>
        </View>
      </View>
      <View style={s.bar}>
        <ProgressBar value={counts.total ? (counts.answered / counts.total) * 100 : 0} label={INSPECTION_WORDS.answered} height={8} />
      </View>
      {description ? <Text style={[typeStyle('body'), s.description, { color: c.ink2 }]}>{description}</Text> : null}
    </Card>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.sm },
  counts: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.md },
  count: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  bar: { marginTop: spacing.sm },
  description: { marginTop: spacing.md },
});
