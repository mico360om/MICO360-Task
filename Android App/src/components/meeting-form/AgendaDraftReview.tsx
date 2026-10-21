import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useColors } from '../../core/theme';
import { Button } from '../ui';
import { CheckRow } from '../meeting/sheet-kit';
import { spacing, radius, fontSize } from '../../lib/theme';
import type { AiAgendaItem } from '../../lib/types';

/**
 * The AI's drafted agenda, to tick through before anything is added (all ticked to start with), as
 * on the website's AgendaDraftReview. Used in the meeting form and on the meeting's page.
 */
export function AgendaDraftReview({
  items,
  leadName,
  onAdd,
  onDismiss,
  busy = false,
}: {
  items: AiAgendaItem[];
  leadName: (id: string | null) => string | null;
  onAdd: (chosen: AiAgendaItem[]) => void;
  onDismiss: () => void;
  busy?: boolean;
}) {
  const c = useColors();
  const [ticked, setTicked] = useState(() => items.map(() => true));
  // A new draft starts with every item ticked again.
  useEffect(() => setTicked(items.map(() => true)), [items]);
  if (items.length === 0) {
    return (
      <View style={[styles.box, { borderColor: c.line, backgroundColor: c.ground }]}>
        <Text style={[styles.note, { color: c.ink2 }]}>The AI had nothing to suggest for this meeting. Add the items yourself.</Text>
        <Button title="Dismiss" variant="ghost" onPress={onDismiss} />
      </View>
    );
  }
  return (
    <View style={[styles.box, { borderColor: c.brand, backgroundColor: c.brandWash }]} accessibilityLabel="Drafted agenda">
      <Text style={[styles.heading, { color: c.ink2 }]} accessibilityRole="header">
        DRAFTED AGENDA
      </Text>
      {items.map((item, i) => {
        const lead = leadName(item.ownerId);
        return (
          <View key={`${i}-${item.title}`}>
            <CheckRow label={`${item.title} — ${lead ?? 'No lead'} · ${item.minutes} min`} checked={!!ticked[i]} onChange={() => setTicked((t) => t.map((x, j) => (j === i ? !x : x)))} disabled={busy} />
          </View>
        );
      })}
      <View style={styles.row}>
        <Button title="Dismiss" variant="ghost" onPress={onDismiss} disabled={busy} style={styles.flex} />
        <Button title="Add selected" onPress={() => onAdd(items.filter((_, i) => ticked[i]))} loading={busy} disabled={!ticked.some(Boolean)} style={styles.flex} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
  heading: { fontSize: fontSize.xs, fontWeight: '800', letterSpacing: 0.8 },
  note: { fontSize: fontSize.sm },
  row: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  flex: { flex: 1 },
});
