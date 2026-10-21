import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useColors } from '../../core/theme';
import { useFreeTimes } from '../../core/meeting-ai';
import { Button } from '../ui';
import { SheetMessage } from '../meeting/sheet-kit';
import { busyLines, clashLine, freeTimesFailure, freeTimesView, rangeText, recheckFreeTimes } from '../../lib/meeting-ai';
import { meetingWhen } from '../../lib/meeting-detail';
import { spacing, radius, fontSize } from '../../lib/theme';
import type { FreeTimesInput } from '../../lib/types';

/**
 * Free times (2c), worked out by the server without AI, as on the website: three suggested times
 * when everyone invited is free (inside the company's meeting hours), who clashes with the chosen
 * time, and each person's meetings on the chosen day (one this person can't see shows as "Busy").
 * Picking a time moves the start and keeps the length. Needs a connection.
 */
export function FreeTimes({ input, timeZone, onPick, disabled }: { input: FreeTimesInput | null; timeZone: string; onPick: (startAt: string) => void; disabled?: boolean }) {
  const c = useColors();
  const { query: q, settled } = useFreeTimes(input);
  const [show, setShow] = useState(false);
  // Suggestions are for what was chosen when asked: a change hides them until asked again.
  const key = input ? JSON.stringify(input) : '';
  useEffect(() => setShow(false), [key]);
  // Clashes and the busy day only for what the form holds now (not the time before it changed).
  const data = settled ? q.data : undefined;
  const view = freeTimesView({ shown: show, settled, fetching: q.isFetching, error: q.isError ? q.error : null, data });
  const ask = () => {
    // Asking (again) checks afresh: someone may have booked a meeting, or the meeting hours changed.
    if (recheckFreeTimes({ shown: show, stale: q.isStale, settled })) void q.refetch();
    setShow(true);
  };

  return (
    <View style={[styles.card, { borderColor: c.line, backgroundColor: c.surface }]} accessibilityLabel="Free times">
      <View style={styles.head}>
        <Text style={[styles.title, { color: c.ink }]} accessibilityRole="header">
          Free times
        </Text>
        <Button title="Suggest 3 times" variant="secondary" onPress={ask} disabled={disabled || !input} style={styles.ask} />
      </View>
      {!input ? <Text style={[styles.small, { color: c.ink2 }]}>Choose when it starts to see who is free.</Text> : null}
      {view === 'error' ? (
        <SheetMessage text={freeTimesFailure(q.error)} />
      ) : view === 'finding' ? (
        <Text style={[styles.small, { color: c.ink2 }]}>Finding free times…</Text>
      ) : view === 'suggestions' && data ? (
          <View style={styles.chips} accessibilityLabel="Suggested times">
            {data.suggestions.map((s) => (
              <Pressable
                key={s}
                onPress={() => onPick(s)}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityLabel={`Use ${rangeText(s, null, timeZone)}`}
                style={({ pressed }) => [styles.chip, { borderColor: c.brand, backgroundColor: c.brandWash }, pressed && styles.pressed]}
              >
                <Text style={[styles.chipText, { color: c.brand }]}>{rangeText(s, null, timeZone)}</Text>
              </Pressable>
            ))}
          </View>
      ) : view === 'none' ? (
        <Text style={[styles.small, { color: c.ink2 }]}>No free time found in the next two weeks.</Text>
      ) : null}
      {data?.clashes.length ? (
        <View style={[styles.clash, { backgroundColor: c.warningSoft }]} accessibilityRole="alert" accessibilityLabel="Clashes">
          <Text style={[styles.clashTitle, { color: c.warning }]}>Someone invited already has a meeting then:</Text>
          {data.clashes.map((cl) => (
            <Text key={`${cl.userId}-${cl.start}`} style={[styles.small, { color: c.ink }]}>
              {clashLine(cl, timeZone)}
            </Text>
          ))}
        </View>
      ) : null}
      {data?.day.length && input ? (
        <View style={styles.day}>
          <Text style={[styles.small, { color: c.ink2, fontWeight: '700' }]}>
            Busy on {meetingWhen({ startAt: input.startAt, endAt: null }, timeZone).day} ({data.workingHours.start}–{data.workingHours.end})
          </Text>
          {busyLines(data.day, timeZone).map((p) => (
            <Text key={p.userId} style={[styles.small, { color: c.ink }]} accessibilityLabel={`${p.name}: ${p.text}`}>
              <Text style={styles.bold}>{p.name}</Text> — {p.text}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm, marginBottom: spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, flexWrap: 'wrap' },
  title: { fontSize: fontSize.sm, fontWeight: '800' },
  ask: { minHeight: 40 },
  small: { fontSize: fontSize.xs, lineHeight: 17 },
  bold: { fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { minHeight: 40, justifyContent: 'center', borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md },
  chipText: { fontSize: fontSize.sm, fontWeight: '700' },
  pressed: { opacity: 0.7 },
  clash: { borderRadius: radius.md, padding: spacing.sm, gap: 2 },
  clashTitle: { fontSize: fontSize.xs, fontWeight: '800' },
  day: { gap: 2 },
});
