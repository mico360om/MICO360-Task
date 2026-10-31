import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useColors } from '../../core/theme';
import { FOLLOW_UP_WORDS, allButton, assigneeOf, followUpChoices, type AssigneeChoice } from '../../lib/inspection-follow-ups';
import type { FlushState, InspectionOutbox } from '../../lib/inspection-outbox';
import type { InspectionDetail } from '../../lib/inspection-types';
import { problemText } from '../../lib/inspection-words';
import { spacing } from '../../lib/theme';
import type { ApiMember } from '../../lib/types';
import { font, typeStyle } from '../../lib/typography';
import { Button, Card, Chip } from '../ui';

/**
 * Asks for follow-up tasks for failed items, as the website: kept on this phone first (so it works
 * with no signal), then sent at once; what became of each is said when the answer comes back.
 */
export function askFollowUps(o: {
  outbox: InspectionOutbox | null;
  ownerId: string | null;
  inspectionId: string;
  itemIds: string[];
  choice: AssigneeChoice;
  /** The inspection as shown: a finished one keeps no record on the phone, so this starts one. */
  detail: InspectionDetail;
  send: () => Promise<FlushState>;
  onProblem: (text: string) => void;
}): void {
  const { outbox, ownerId, inspectionId, itemIds, choice } = o;
  if (!outbox || !ownerId || !itemIds.length) return;
  try {
    outbox.queueFollowUps(ownerId, inspectionId, itemIds, assigneeOf(choice), o.detail);
  } catch (e) {
    o.onProblem(problemText(e, FOLLOW_UP_WORDS.failed));
    return;
  }
  void o.send();
}

/** "Failed items (n)": who new tasks go to, and one button for every failed item still without one. */
export function FailedItemsCard({
  failedCount,
  without,
  members,
  owner,
  choice,
  onChoice,
  ownerId,
  inspectionId,
  outbox,
  detail,
  send,
  onProblem,
}: {
  failedCount: number;
  /** The failed items with no task yet (made, asked for, or being made). */
  without: string[];
  members: readonly ApiMember[];
  owner: { id: string } | null;
  choice: AssigneeChoice;
  onChoice: (choice: AssigneeChoice) => void;
  ownerId: string | null;
  inspectionId: string;
  outbox: InspectionOutbox | null;
  detail: InspectionDetail;
  send: () => Promise<FlushState>;
  onProblem: (text: string) => void;
}) {
  const c = useColors();
  const all = allButton(without.length);
  const choices = followUpChoices(members, owner);
  return (
    <Card>
      <Text style={[typeStyle('body'), font('600'), { color: c.ink }]} accessibilityRole="header">
        {FOLLOW_UP_WORDS.heading.replace('{n}', String(failedCount))}
      </Text>
      <Text style={[typeStyle('caption'), s.gap, { color: c.ink2 }]}>{FOLLOW_UP_WORDS.intro}</Text>
      <Text style={[typeStyle('label'), s.label, { color: c.ink2 }]}>{FOLLOW_UP_WORDS.giveTo}</Text>
      <View style={s.chips} accessibilityLabel={FOLLOW_UP_WORDS.giveTo}>
        {choices.map((o) => (
          <Chip key={o.value} label={o.label} selected={o.value === choice} onPress={() => onChoice(o.value)} />
        ))}
      </View>
      <View style={s.all}>
        <Button
          title={all.label}
          size="sm"
          disabled={all.disabled}
          onPress={() => askFollowUps({ outbox, ownerId, inspectionId, itemIds: without, choice, detail, send, onProblem })}
        />
      </View>
    </Card>
  );
}

const s = StyleSheet.create({
  gap: { marginTop: 2 },
  label: { marginTop: spacing.md, marginBottom: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  all: { alignSelf: 'flex-start', marginTop: spacing.md },
});
