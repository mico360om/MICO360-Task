import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useColors } from '../../core/theme';
import { useWriteMeetingDescription } from '../../core/meeting-ai';
import { Button } from '../ui';
import { SheetMessage } from '../meeting/sheet-kit';
import { meetingAiFailure } from '../../lib/meeting-ai';
import { spacing, radius, fontSize } from '../../lib/theme';

/**
 * "Write description" (2c), as on the website: the AI writes the invitation's description from the
 * title, the agenda and the sentence. It is offered, never put in by itself, and says when it would
 * replace your words. Needs a connection.
 */
export function WriteDescription({
  current,
  request,
  onUse,
  disabled,
}: {
  current: string;
  /** What the AI writes from (null: no title yet, so the button waits). */
  request: { title: string; agenda?: string[]; text?: string } | null;
  onUse: (text: string) => void;
  disabled?: boolean;
}) {
  const c = useColors();
  const write = useWriteMeetingDescription();
  const [offer, setOffer] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const ask = () => {
    if (!request) return;
    setProblem(null);
    setOffer(null);
    write.mutate(request, {
      onSuccess: (text) => (text.trim() ? setOffer(text.trim()) : setProblem('The AI didn’t write anything this time. Try again, or write it yourself.')),
      onError: (e) => setProblem(meetingAiFailure(e, 'Couldn’t write a description. Try again, or write it yourself.')),
    });
  };
  const mine = !!current.trim();
  return (
    <View style={styles.wrap}>
      <Button title={write.isPending ? 'Writing…' : '✨ Write description'} variant="ghost" onPress={ask} loading={write.isPending} disabled={disabled || !request} style={styles.start} />
      <SheetMessage text={problem} />
      {offer ? (
        <View style={[styles.offer, { borderColor: c.brand, backgroundColor: c.brandWash }]} accessibilityLabel="Suggested description">
          <Text style={[styles.text, { color: c.ink }]}>{offer}</Text>
          {mine ? <Text style={[styles.small, { color: c.ink2 }]}>Replaces your description.</Text> : null}
          <View style={styles.row}>
            <Button title={mine ? 'Keep mine' : 'Dismiss'} variant="ghost" onPress={() => setOffer(null)} style={styles.flex} />
            <Button
              title="Use this description"
              onPress={() => {
                onUse(offer);
                setOffer(null);
              }}
              disabled={disabled}
              style={styles.flex}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs, marginBottom: spacing.sm },
  start: { alignSelf: 'flex-start' },
  offer: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
  text: { fontSize: fontSize.sm, lineHeight: 20, textAlign: 'auto' },
  small: { fontSize: fontSize.xs },
  row: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  flex: { flex: 1 },
});
