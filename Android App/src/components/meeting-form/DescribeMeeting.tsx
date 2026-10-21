import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useColors } from '../../core/theme';
import { useParseMeeting } from '../../core/meeting-ai';
import { Button, TextField } from '../ui';
import { CheckRow, ChipChoice, SheetMessage } from '../meeting/sheet-kit';
import { chosenPatch, isChosen, meetingAiFailure, type DescribedPatch, type DescribeSuggestion } from '../../lib/meeting-ai';
import { companyTodayKey } from '../../lib/due-date';
import { AI_SENTENCE_MAX } from '../../lib/resources';
import { spacing, radius, fontSize } from '../../lib/theme';
import type { AiMeetingDraft } from '../../lib/types';

/**
 * "Describe the meeting" (2c), as on the website: the assistant reads a sentence and suggests the
 * title, day and time, length, repeat, project, place, link and description — and in a new meeting
 * the people, guests and agenda points. Nothing changes until "Use selected details"; a suggestion
 * that would replace something you set yourself starts unticked, and a name more than one person
 * goes by asks which one. Needs a connection.
 */
export function DescribeMeeting({
  timeZone,
  withPeopleAndAgenda,
  suggest,
  onApply,
  onSentence,
  disabled,
}: {
  timeZone: string;
  /** A new meeting: people, guests and agenda points are offered too. */
  withPeopleAndAgenda: boolean;
  /** What the form would take from the server's reading (worked out against the form as it is now). */
  suggest: (d: AiMeetingDraft) => DescribeSuggestion[];
  onApply: (patch: DescribedPatch) => void;
  /** The sentence read: Draft agenda and Write description use it too. */
  onSentence: (text: string) => void;
  disabled?: boolean;
}) {
  const c = useColors();
  const parse = useParseMeeting();
  // The AI may take a while: its answer is weighed against the form as it is when it arrives.
  const latest = useRef(suggest);
  latest.current = suggest;
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [found, setFound] = useState<DescribeSuggestion[] | null>(null);
  const [notFound, setNotFound] = useState<string[]>([]);

  const read = () => {
    const t = text.trim();
    if (!t || parse.isPending) return;
    setProblem(null);
    setFound(null);
    onSentence(t);
    parse.mutate(
      { text: t, today: companyTodayKey(new Date(), timeZone) },
      {
        onSuccess: (d) => {
          setFound(latest.current(d));
          setNotFound(withPeopleAndAgenda ? d.people?.notFound ?? [] : []);
        },
        onError: (e) => setProblem(meetingAiFailure(e, 'Couldn’t read that description. Try rephrasing it, or fill in the details yourself.')),
      },
    );
  };
  const update = (key: string, change: (s: DescribeSuggestion) => DescribeSuggestion) => setFound((f) => f?.map((s) => (s.key === key ? change(s) : s)) ?? f);
  const close = () => {
    setFound(null);
    setNotFound([]);
  };

  return (
    <View style={[styles.card, { borderColor: c.brand, backgroundColor: c.brandWash }]}>
      <Text style={[styles.title, { color: c.brand }]} accessibilityRole="header">
        ✨ Describe the meeting
      </Text>
      <Text style={[styles.hint, { color: c.ink2 }]}>
        The assistant suggests the title, time, length, repeat, project and place{withPeopleAndAgenda ? ', people and agenda' : ''} — you choose what to use.
      </Text>
      <TextField
        accessibilityLabel="Describe the meeting"
        value={text}
        onChangeText={(v) => {
          setText(v);
          if (problem) setProblem(null);
        }}
        placeholder="e.g. “Weekly site review with Sara and Omar every Monday at 10 for 90 minutes, PUMP project”"
        multiline
        maxLength={AI_SENTENCE_MAX}
        editable={!disabled}
        style={styles.multiline}
      />
      <Button title={parse.isPending ? 'Reading…' : 'Fill meeting details'} variant="secondary" onPress={read} loading={parse.isPending} disabled={disabled || !text.trim()} />
      <SheetMessage text={problem} />
      {found && found.length === 0 ? <SheetMessage text="Nothing new to fill in from that description." tone="info" /> : null}
      {found && found.length > 0 ? (
        <View style={[styles.found, { borderColor: c.line, backgroundColor: c.surface }]} accessibilityLabel="Suggested details">
          <Text style={[styles.heading, { color: c.ink2 }]} accessibilityRole="header">
            FOUND IN YOUR DESCRIPTION
          </Text>
          {found.map((s) =>
            s.kind === 'choice' ? (
              <ChipChoice<string>
                key={s.key}
                label={`Which ${s.said}?`}
                options={[...s.options.map((o) => ({ value: o.id, label: o.username ? `${o.name} @${o.username}` : o.name })), { value: '', label: 'Neither' }]}
                value={s.chosen ?? ''}
                onChange={(v) => update(s.key, (x) => ({ ...x, chosen: v || null }) as DescribeSuggestion)}
              />
            ) : (
              <View key={s.key}>
                <CheckRow
                  label={`${s.kind === 'agenda' ? 'Agenda' : s.label}: ${s.shown}`}
                  checked={s.checked}
                  onChange={() => update(s.key, (x) => ({ ...x, checked: !(x as { checked: boolean }).checked }) as DescribeSuggestion)}
                />
                {s.kind === 'field' && s.replaces ? <Text style={[styles.replaces, { color: c.ink2 }]}>Replaces {s.replaces}</Text> : null}
              </View>
            ),
          )}
          {notFound.length ? <Text style={[styles.hint, { color: c.ink2 }]}>Not found: {notFound.join(', ')} — add them by hand under People, or as a guest.</Text> : null}
          <View style={styles.row}>
            <Button title="Dismiss" variant="ghost" onPress={close} style={styles.flex} />
            <Button
              title="Use selected details"
              onPress={() => {
                onApply(chosenPatch(found));
                close();
              }}
              disabled={disabled || !found.some(isChosen)}
              style={styles.flex}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm, marginBottom: spacing.md },
  title: { fontSize: fontSize.md, fontWeight: '800' },
  hint: { fontSize: fontSize.xs },
  heading: { fontSize: fontSize.xs, fontWeight: '800', letterSpacing: 0.8 },
  multiline: { minHeight: 72, paddingTop: spacing.sm, textAlignVertical: 'top' },
  found: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
  replaces: { fontSize: fontSize.xs, marginLeft: 30, marginTop: -6 },
  row: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  flex: { flex: 1 },
});
