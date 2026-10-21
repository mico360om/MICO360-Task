import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useColors } from '../../core/theme';
import { Button, TextField } from '../ui';
import { InlinePicker, SheetMessage } from '../meeting/sheet-kit';
import { addGuest, addTeamMember, invitableOptions, personKey, PEOPLE_FULL, PEOPLE_MAX, type MeetingPerson } from '../../lib/meeting-ai';
import { spacing, radius, fontSize } from '../../lib/theme';
import type { ApiDirectoryUser } from '../../lib/types';

/**
 * A new meeting's People (2c), saved with it in one go, as on the website: active team members
 * from the directory and guests by email (named from the part before the @ unless a name is given),
 * each required or optional. The organizer is always in, so isn't offered.
 */
export function PeopleField({
  people,
  onChange,
  directory,
  organizerId,
  disabled,
}: {
  people: MeetingPerson[];
  onChange: (next: MeetingPerson[]) => void;
  directory: ApiDirectoryUser[];
  organizerId: string | null;
  disabled?: boolean;
}) {
  const c = useColors();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const options = useMemo(() => invitableOptions(directory, organizerId, people), [directory, organizerId, people]);

  const add = () => {
    const r = addGuest(people, email, name);
    if (!r.ok) return setProblem(r.error);
    setProblem(null);
    onChange(r.people);
    setEmail('');
    setName('');
  };
  const toggleRole = (p: MeetingPerson) => onChange(people.map((x) => (personKey(x) === personKey(p) ? { ...x, role: x.role === 'OPTIONAL' ? 'REQUIRED' : 'OPTIONAL' } : x)));

  return (
    <View style={[styles.card, { borderColor: c.line, backgroundColor: c.surface }]} accessibilityLabel="People">
      <Text style={[styles.title, { color: c.ink }]} accessibilityRole="header">
        People
      </Text>
      <Text style={[styles.hint, { color: c.ink2 }]}>You’re in as the organizer. Invitations go out when you send them from the meeting’s page.</Text>
      {people.map((p) => (
        <View key={personKey(p)} style={[styles.person, { borderColor: c.line }]}>
          <View style={styles.flex}>
            <Text style={[styles.name, { color: c.ink }]}>{p.name}</Text>
            {p.kind === 'guest' ? <Text style={[styles.hint, { color: c.ink3 }]}>{p.email} · Guest</Text> : null}
          </View>
          <Pressable
            onPress={() => toggleRole(p)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={`${p.name}: ${p.role === 'OPTIONAL' ? 'optional' : 'required'} — tap to make ${p.role === 'OPTIONAL' ? 'required' : 'optional'}`}
            style={[styles.role, { borderColor: c.line }]}
          >
            <Text style={[styles.roleText, { color: c.ink2 }]}>{p.role === 'OPTIONAL' ? 'Optional' : 'Required'}</Text>
          </Pressable>
          <Pressable
            onPress={() => onChange(people.filter((x) => personKey(x) !== personKey(p)))}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${p.name}`}
            hitSlop={6}
            style={styles.remove}
          >
            <Text style={[styles.removeText, { color: c.ink3 }]}>✕</Text>
          </Pressable>
        </View>
      ))}
      {people.length >= PEOPLE_MAX ? <SheetMessage text={PEOPLE_FULL} tone="info" /> : null}
      <InlinePicker
        label="Add a team member"
        options={options}
        value=""
        onChange={(id) => id && onChange(addTeamMember(people, directory, id))}
        placeholder="Add a team member…"
        emptyText="Everyone is already invited."
        disabled={disabled || people.length >= PEOPLE_MAX}
      />
      <TextField
        accessibilityLabel="Guest email"
        value={email}
        onChangeText={(v) => {
          setEmail(v);
          setProblem(null);
        }}
        placeholder="Guest email"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        editable={!disabled}
      />
      <TextField accessibilityLabel="Guest name (optional)" value={name} onChangeText={setName} placeholder="Guest name (optional)" editable={!disabled} maxLength={200} />
      <Button title="Add guest" variant="secondary" onPress={add} disabled={disabled || !email.trim()} />
      <SheetMessage text={problem} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm, marginBottom: spacing.md },
  title: { fontSize: fontSize.sm, fontWeight: '800' },
  hint: { fontSize: fontSize.xs },
  person: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderRadius: radius.md, paddingLeft: spacing.md, minHeight: 48 },
  flex: { flex: 1, paddingVertical: spacing.xs },
  name: { fontSize: fontSize.md, fontWeight: '600', textAlign: 'auto' },
  role: { minHeight: 36, justifyContent: 'center', borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm },
  roleText: { fontSize: fontSize.xs, fontWeight: '700' },
  remove: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  removeText: { fontSize: fontSize.md, fontWeight: '700' },
});
