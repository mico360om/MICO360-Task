import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useColors } from '../../core/theme';
import type { DraftView } from '../../lib/inspection-outbox';
import { itemsOf } from '../../lib/inspection-rules';
import { INSPECTION_WORDS, finishHint } from '../../lib/inspection-words';
import { radius, spacing } from '../../lib/theme';
import { font, typeStyle } from '../../lib/typography';
import { Button, Card, SectionTitle } from '../ui';

/** At most this many unanswered items are named (then "and N more"), as on the website. */
const NAMED = 8;

/**
 * "Finish", as the website's: who signs and what signing does; Sign and finish opens the signing
 * sheet once every item is answered (else it names the ones left, each a tap away). Signed and
 * waiting to finish (no signal yet): it says so, and the signatures can be taken back to change an
 * answer.
 */
export function FinishCard({
  view,
  canAnswer,
  onSign,
  onTakeBack,
  onJump,
}: {
  view: DraftView;
  canAnswer: boolean;
  onSign: () => void;
  onTakeBack: () => void;
  onJump: (itemId: string) => void;
}) {
  const c = useColors();
  const [need, setNeed] = useState<string[] | null>(null);
  const d = view.snapshot;
  const items = itemsOf(d.structure);
  const answered = new Map(view.answers.map((a) => [a.itemId, a]));

  const start = () => {
    const unanswered = items.filter((i) => !answered.get(i.id)?.result).map((i) => i.id);
    if (unanswered.length) {
      setNeed(unanswered);
      return;
    }
    setNeed(null);
    onSign();
  };

  return (
    <Card>
      <SectionTitle>{INSPECTION_WORDS.finish}</SectionTitle>
      {view.locked ? (
        <View style={s.stack}>
          <Text style={[typeStyle('body'), { color: c.ink2 }]}>{INSPECTION_WORDS.signedOnPhone}</Text>
          <View style={s.start}>
            <Button title={INSPECTION_WORDS.takeBack} variant="secondary" size="sm" onPress={onTakeBack} />
          </View>
        </View>
      ) : (
        <View style={s.stack}>
          <Text style={[typeStyle('caption'), { color: c.ink2 }]}>{finishHint(d.signatureRoles.allowed, d.signatureRoles.required)}</Text>
          {need ? (
            <View style={[s.need, { backgroundColor: c.warningSoft }]} accessibilityRole="alert">
              <Text style={[typeStyle('body'), font('600'), { color: c.warningText }]}>{INSPECTION_WORDS.answerFirst.replace('{n}', String(need.length))}</Text>
              {need.slice(0, NAMED).map((itemId) => (
                <Pressable key={itemId} onPress={() => onJump(itemId)} accessibilityRole="link" style={s.jump}>
                  <Text style={[typeStyle('body'), s.underline, { color: c.warningText }]}>{items.find((i) => i.id === itemId)?.label}</Text>
                </Pressable>
              ))}
              {need.length > NAMED ? <Text style={[typeStyle('body'), { color: c.warningText }]}>{INSPECTION_WORDS.andMore.replace('{n}', String(need.length - NAMED))}</Text> : null}
            </View>
          ) : null}
          <View style={s.start}>
            <Button title={INSPECTION_WORDS.signAndFinish} onPress={start} disabled={!canAnswer} />
          </View>
        </View>
      )}
    </Card>
  );
}

const s = StyleSheet.create({
  stack: { gap: spacing.sm },
  start: { alignSelf: 'flex-start' },
  need: { borderRadius: radius.input, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: 2 },
  jump: { minHeight: 44, justifyContent: 'center' },
  underline: { textDecorationLine: 'underline' },
});
