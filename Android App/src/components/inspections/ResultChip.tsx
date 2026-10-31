import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useColors } from '../../core/theme';
import type { ItemResult } from '../../lib/inspection-rules';
import { ITEM_WORDS } from '../../lib/inspection-item';
import type { IconName } from '../../lib/icons';
import { radius } from '../../lib/theme';
import { toneStyle, type Tone } from '../../lib/tone';
import { font } from '../../lib/typography';
import { Icon } from '../Icon';

const LOOK: Record<ItemResult, { text: string; tone: Tone; icon: IconName | null }> = {
  PASS: { text: ITEM_WORDS.pass, tone: 'success', icon: 'misc.check' },
  FAIL: { text: ITEM_WORDS.fail, tone: 'danger', icon: 'ui.close' },
  NA: { text: ITEM_WORDS.na, tone: 'neutral', icon: null },
};

/** A result in words with its own mark (never colour alone), as the website's: Pass, Fail, N/A, Not answered. */
export function ResultChip({ result }: { result: ItemResult | null }) {
  const c = useColors();
  if (!result) {
    return (
      <View style={[s.chip, { backgroundColor: c.ground }]}>
        <Text style={[s.quiet, { color: c.ink2 }]}>{ITEM_WORDS.notAnswered}</Text>
      </View>
    );
  }
  const look = LOOK[result];
  const t = toneStyle(c, look.tone);
  return (
    <View style={[s.chip, { backgroundColor: t.bg }]} accessible accessibilityLabel={look.text}>
      {look.icon ? <Icon name={look.icon} size={12} color={t.fg} /> : null}
      <Text style={[s.text, { color: t.fg }]}>{look.text.toUpperCase()}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', borderRadius: radius.badge, paddingHorizontal: 6, paddingVertical: 2 },
  text: { ...font('700'), fontSize: 11, lineHeight: 14, letterSpacing: 0.4 },
  quiet: { ...font('500'), fontSize: 12, lineHeight: 16 },
});
