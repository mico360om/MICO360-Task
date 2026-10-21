import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useColors } from '../../core/theme';
import { useDraftAgenda } from '../../core/meeting-ai';
import { Button, TextField } from '../ui';
import { InlinePicker, SheetMessage } from '../meeting/sheet-kit';
import { AgendaDraftReview } from './AgendaDraftReview';
import { addAgendaTopic, addDraftedItems, agendaMinutesInput, agendaTotal, meetingAiFailure, moveAgendaDraft, type AgendaDraft } from '../../lib/meeting-ai';
import { spacing, radius, fontSize } from '../../lib/theme';
import type { AiAgendaItem, AiDraftAgendaInput } from '../../lib/types';

/**
 * A new meeting's Agenda (2c), saved with it, as on the website: topics in order, each with a lead
 * (the organizer or one of the invited team members) and minutes, totalled against the meeting's
 * length — and "Draft agenda", the AI's proposal, reviewed before it is added. Needs a connection
 * to draft; the topics themselves are just typed.
 */
export function AgendaField({
  agenda,
  onChange,
  leads,
  minutes,
  draftRequest,
  disabled,
}: {
  agenda: AgendaDraft[];
  onChange: (next: AgendaDraft[]) => void;
  leads: { id: string; name: string }[];
  /** The meeting's length. */
  minutes: number;
  /** What "Draft agenda" sends, or why it can't start yet (the button waits). */
  draftRequest: { ok: true; input: AiDraftAgendaInput } | { ok: false; hint: string };
  disabled?: boolean;
}) {
  const c = useColors();
  const draft = useDraftAgenda();
  const [title, setTitle] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [drafted, setDrafted] = useState<AiAgendaItem[] | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const total = agendaTotal(agenda, minutes);
  const leadOptions = [{ value: '', label: 'No lead' }, ...leads.map((l) => ({ value: l.id, label: l.name }))];

  const patch = (key: string, change: Partial<AgendaDraft>) => onChange(agenda.map((i) => (i.key === key ? { ...i, ...change } : i)));
  const add = () => {
    const r = addAgendaTopic(agenda, title);
    if (!r.ok) return setProblem(r.error);
    setProblem(null);
    onChange(r.agenda);
    setTitle('');
  };
  const askDraft = () => {
    if (!draftRequest.ok) return;
    setDraftError(null);
    setDrafted(null);
    draft.mutate(draftRequest.input, {
      onSuccess: setDrafted,
      onError: (e) => setDraftError(meetingAiFailure(e, 'Couldn’t draft an agenda. Try again, or add the items yourself.')),
    });
  };

  return (
    <View style={[styles.card, { borderColor: c.line, backgroundColor: c.surface }]} accessibilityLabel="Agenda">
      <Text style={[styles.title, { color: c.ink }]} accessibilityRole="header">
        Agenda
      </Text>
      {agenda.map((item, index) => {
        const n = index + 1;
        return (
          <View key={item.key} style={[styles.item, { borderColor: c.line, backgroundColor: c.ground }]}>
            <TextField accessibilityLabel={`Agenda item ${n}`} value={item.title} onChangeText={(v) => patch(item.key, { title: v })} editable={!disabled} error={item.title.trim() ? null : 'An agenda item needs a title.'} maxLength={300} />
            <InlinePicker label={`Lead for item ${n}`} options={leadOptions} value={item.ownerId ?? ''} onChange={(v) => patch(item.key, { ownerId: v || null })} placeholder="No lead" disabled={disabled} />
            <View style={styles.row}>
              <View style={styles.minutes}>
                <TextField
                  accessibilityLabel={`Minutes for item ${n}`}
                  value={item.minutes != null ? String(item.minutes) : ''}
                  onChangeText={(v) => patch(item.key, { minutes: agendaMinutesInput(v) })}
                  placeholder="min"
                  keyboardType="number-pad"
                  maxLength={3}
                  editable={!disabled}
                />
              </View>
              <Small label="↑" a11y={`Move item ${n} up`} onPress={() => onChange(moveAgendaDraft(agenda, index, -1))} disabled={disabled || index === 0} />
              <Small label="↓" a11y={`Move item ${n} down`} onPress={() => onChange(moveAgendaDraft(agenda, index, 1))} disabled={disabled || index === agenda.length - 1} />
              <Small label="✕" a11y={`Remove item ${n}`} onPress={() => onChange(agenda.filter((i) => i.key !== item.key))} disabled={disabled} />
            </View>
          </View>
        );
      })}
      {agenda.length ? <Text style={[styles.small, { color: total.over ? c.warning : c.ink2, fontWeight: total.over ? '700' : '400' }]}>{total.text}</Text> : null}
      <TextField
        accessibilityLabel="New agenda item"
        value={title}
        onChangeText={(v) => {
          setTitle(v);
          setProblem(null);
        }}
        onSubmitEditing={add}
        placeholder="Add a topic…"
        maxLength={300}
        editable={!disabled}
      />
      <Button title="Add item" variant="secondary" onPress={add} disabled={disabled} />
      <SheetMessage text={problem} />
      <View style={styles.draftRow}>
        <Button title={draft.isPending ? 'Drafting…' : '✨ Draft agenda'} variant="ghost" onPress={askDraft} loading={draft.isPending} disabled={disabled || !draftRequest.ok} />
        {!draftRequest.ok ? <Text style={[styles.small, { color: c.ink2 }]}>{draftRequest.hint}</Text> : null}
      </View>
      <SheetMessage text={draftError} />
      {drafted ? (
        <AgendaDraftReview
          items={drafted}
          leadName={(id) => leads.find((l) => l.id === id)?.name ?? null}
          onAdd={(chosen) => {
            onChange(addDraftedItems(agenda, chosen, leads));
            setDrafted(null);
          }}
          onDismiss={() => setDrafted(null)}
        />
      ) : null}
    </View>
  );
}

function Small({ label, a11y, onPress, disabled }: { label: string; a11y: string; onPress: () => void; disabled?: boolean }) {
  const c = useColors();
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={a11y} accessibilityState={{ disabled: !!disabled }} style={[styles.small44, { borderColor: c.line }, disabled && styles.dim]}>
      <Text style={[styles.smallText, { color: c.ink2 }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm, marginBottom: spacing.md },
  title: { fontSize: fontSize.sm, fontWeight: '800' },
  item: { borderWidth: 1, borderRadius: radius.md, padding: spacing.sm, gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  minutes: { width: 90 },
  small: { fontSize: fontSize.xs },
  small44: { width: 44, height: 44, borderWidth: 1, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  smallText: { fontSize: fontSize.md, fontWeight: '700' },
  dim: { opacity: 0.4 },
  draftRow: { gap: spacing.xs },
});
