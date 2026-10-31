import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useColors } from '../../core/theme';
import { FieldLabel, InlinePicker } from '../meeting/sheet-kit';
import type { PersonOption } from '../../lib/task-form';
import { spacing, radius, fontSize } from '../../lib/theme';
import { font } from '../../lib/typography';
import { Icon } from '../Icon';

const DEFAULT_LABELS = { list: 'Assignees (optional)', add: 'Add people', allChosen: 'Everyone on this project is assigned.' };

/**
 * Who works on the task (4a), as on the website's AssigneeSelect: the chosen people as removable
 * chips, and a searchable list of the rest of the project's active members. A note under it says
 * who gets the task when nobody is picked.
 */
export function AssigneeField({
  people,
  value,
  onChange,
  note,
  disabled,
  status,
  labels = DEFAULT_LABELS,
}: {
  people: readonly PersonOption[];
  value: string[];
  onChange: (ids: string[]) => void;
  note: string | null;
  disabled?: boolean;
  /** The project's people are still loading, or couldn't be loaded (offline, never opened). */
  status?: 'loading' | 'failed' | null;
  /** Its own words (a schedule's inspectors — Stage 4): the list's label, the picker's, and when everyone is chosen. */
  labels?: { list: string; add: string; allChosen: string };
}) {
  const c = useColors();
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const chosen = value.map((id) => byId.get(id) ?? { id, name: 'Someone', username: '', avatarUrl: null });
  const options = useMemo(
    () => people.filter((p) => !value.includes(p.id)).map((p) => ({ value: p.id, label: p.name, hint: p.username ? `@${p.username}` : undefined })),
    [people, value],
  );
  const placeholder = status === 'loading' ? 'Loading…' : people.length ? 'Search by name…' : 'No one is on this project yet';
  return (
    <View style={styles.wrap}>
      <FieldLabel>{labels.list}</FieldLabel>
      {chosen.length ? (
        <View style={styles.chips} accessibilityLabel="Assigned people">
          {chosen.map((p) => (
            <View key={p.id} style={[styles.chip, { borderColor: c.line, backgroundColor: c.ground }]}>
              <Text style={[styles.chipText, { color: c.ink }]} numberOfLines={1}>
                {p.name}
              </Text>
              <Pressable
                onPress={() => onChange(value.filter((id) => id !== p.id))}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${p.name}`}
                hitSlop={6}
                style={styles.remove}
              >
                <Icon name="ui.close" size={14} color={c.ink2} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      <InlinePicker
        label={labels.add}
        options={options}
        value=""
        onChange={(id) => id && onChange([...value, id])}
        placeholder={placeholder}
        emptyText={labels.allChosen}
        disabled={disabled || people.length === 0}
      />
      {status === 'failed' ? <Text style={[styles.note, { color: c.ink2 }]}>Couldn’t load the project’s people — you can still create the task, and assign people from it later.</Text> : null}
      {note ? <Text style={[styles.note, { color: c.ink2 }]}>{note}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs, marginBottom: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, borderWidth: 1, borderRadius: radius.pill, paddingLeft: spacing.md, maxWidth: '100%', minHeight: 40 },
  chipText: { fontSize: fontSize.sm, ...font('600'), flexShrink: 1, textAlign: 'auto' },
  remove: { width: 40, minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  note: { fontSize: fontSize.xs },
});
