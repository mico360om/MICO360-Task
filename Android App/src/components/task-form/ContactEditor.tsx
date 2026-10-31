import React, { useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, type TextInput } from 'react-native';
import { useColors } from '../../core/theme';
import { useExternalContactSuggestions } from '../../core/external-contact-queries';
import { Button, TextField, capLines } from '../ui';
import {
  EXTERNAL_CONTACT_LIMITS,
  EXTERNAL_CONTACT_WORDS,
  checkExternalContact,
  suggestionText,
  type ExternalContactField,
  type ExternalContactFields,
} from '../../lib/external-contacts';
import { contactFailureText, contactFieldProblems, draftOf, type ContactDraftText } from '../../lib/task-external-contacts';
import { spacing, radius, fontSize, type Palette } from '../../lib/theme';
import { font } from '../../lib/typography';

type Problems = Partial<Record<ExternalContactField, string>>;

/**
 * One external contact being added or edited (the task screen's card and the task form's field —
 * the website's editor): name (required), company, designation, email, phone and remarks, checked
 * with the shared rules before it goes and marked with the server's word for each field when it is
 * refused. Typing a name suggests earlier contacts of the project; picking one fills all six boxes
 * (a copy — nothing is shared between tasks).
 */
export function ContactEditor({
  title,
  initial,
  projectId,
  onSubmit,
  onCancel,
  submitLabel = EXTERNAL_CONTACT_WORDS.save,
  disabled = false,
}: {
  title: string;
  initial: ExternalContactFields | null;
  /** The task's project: its earlier contacts are suggested ('' — none). */
  projectId: string;
  /** Save the checked contact; rejects (with the server's refusal) to keep the editor open. */
  onSubmit: (contact: ExternalContactFields) => Promise<unknown> | void;
  onCancel: () => void;
  submitLabel?: string;
  disabled?: boolean;
}) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const [draft, setDraft] = useState<ContactDraftText>(() => draftOf(initial));
  const [problems, setProblems] = useState<Problems>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Suggestions follow the name being typed, until one is picked or another box is used (not on
  // leaving the name: a tap on a suggestion leaves it first, and the list must still be there).
  const [typing, setTyping] = useState(false);
  const nameRef = useRef<TextInput>(null);
  const suggestionsQ = useExternalContactSuggestions(projectId, typing ? draft.name : '');
  const suggestions = typing && draft.name.trim() ? (suggestionsQ.data ?? []) : [];
  const busy = disabled || saving;

  const set = (field: ExternalContactField, value: string) => {
    setDraft((d) => ({ ...d, [field]: value }));
    if (problems[field]) setProblems((p) => ({ ...p, [field]: undefined }));
  };
  const pickSuggestion = (pick: ExternalContactFields) => {
    setDraft(draftOf(pick));
    setProblems({});
    setTyping(false);
  };

  async function save() {
    if (busy) return;
    const check = checkExternalContact(draft);
    if (!check.ok) {
      setProblems(check.problems);
      if (check.problems.name) nameRef.current?.focus();
      return;
    }
    setSaving(true);
    setFailure(null);
    try {
      await onSubmit(check.contact);
    } catch (e) {
      const fields = contactFieldProblems(e);
      setProblems(fields);
      if (Object.keys(fields).length === 0) setFailure(contactFailureText(e, EXTERNAL_CONTACT_WORDS.saveFailed));
    } finally {
      setSaving(false);
    }
  }

  const L = EXTERNAL_CONTACT_WORDS.labels;
  return (
    <View style={s.box}>
      <Text style={s.title} accessibilityRole="header">
        {title}
      </Text>
      <TextField
        inputRef={nameRef}
        label={L.name}
        required
        value={draft.name}
        onChangeText={(v) => {
          set('name', v);
          setTyping(true);
        }}
        maxLength={EXTERNAL_CONTACT_LIMITS.name}
        error={problems.name}
        editable={!busy}
        autoCorrect={false}
        accessibilityHint={projectId ? EXTERNAL_CONTACT_WORDS.suggestionHint : undefined}
      />
      {suggestions.length > 0 ? (
        <View style={s.suggestions} accessibilityLabel={EXTERNAL_CONTACT_WORDS.suggestions}>
          <Text style={s.suggestHead}>{EXTERNAL_CONTACT_WORDS.suggestions}</Text>
          {suggestions.map((pick, i) => (
            <Pressable
              key={`${pick.name}-${pick.company ?? ''}-${i}`}
              onPress={() => pickSuggestion(pick)}
              accessibilityRole="button"
              accessibilityLabel={suggestionText(pick)}
              accessibilityHint={EXTERNAL_CONTACT_WORDS.suggestionHint}
              style={({ pressed }) => [s.suggestion, pressed && s.pressed]}
            >
              <Text style={s.suggestText} numberOfLines={capLines(2)}>
                {suggestionText(pick)}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <TextField onFocus={() => setTyping(false)} label={L.company} value={draft.company} onChangeText={(v) => set('company', v)} maxLength={EXTERNAL_CONTACT_LIMITS.company} error={problems.company} editable={!busy} />
      <TextField onFocus={() => setTyping(false)} label={L.designation} value={draft.designation} onChangeText={(v) => set('designation', v)} maxLength={EXTERNAL_CONTACT_LIMITS.designation} error={problems.designation} editable={!busy} />
      <TextField
        label={L.email}
        onFocus={() => setTyping(false)}
        value={draft.email}
        onChangeText={(v) => set('email', v)}
        maxLength={EXTERNAL_CONTACT_LIMITS.email}
        error={problems.email}
        editable={!busy}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <TextField onFocus={() => setTyping(false)} label={L.phone} value={draft.phone} onChangeText={(v) => set('phone', v)} maxLength={EXTERNAL_CONTACT_LIMITS.phone} error={problems.phone} editable={!busy} keyboardType="phone-pad" />
      <TextField
        label={L.remarks}
        onFocus={() => setTyping(false)}
        value={draft.remarks}
        onChangeText={(v) => set('remarks', v)}
        maxLength={EXTERNAL_CONTACT_LIMITS.remarks}
        error={problems.remarks}
        editable={!busy}
        multiline
        numberOfLines={3}
        style={s.multiline}
      />
      {failure ? (
        <Text style={s.failure} accessibilityRole="alert" accessibilityLiveRegion="polite">
          {failure}
        </Text>
      ) : null}
      <View style={s.actions}>
        <Button title={EXTERNAL_CONTACT_WORDS.cancel} variant="ghost" onPress={onCancel} disabled={saving} style={s.grow} />
        <Button title={submitLabel} onPress={() => void save()} loading={saving} disabled={disabled} style={s.grow} />
      </View>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    box: { borderWidth: 1, borderColor: c.line, borderRadius: radius.input, padding: spacing.md, gap: spacing.xs, backgroundColor: c.ground },
    title: { fontSize: fontSize.sm, ...font('700'), color: c.ink, marginBottom: spacing.xs },
    suggestions: { marginTop: -spacing.sm, marginBottom: spacing.sm, borderWidth: 1, borderColor: c.line, borderRadius: radius.input, backgroundColor: c.surface, overflow: 'hidden' },
    suggestHead: { fontSize: fontSize.xs, ...font('700'), color: c.ink2, paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: 2 },
    suggestion: { minHeight: 48, justifyContent: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderTopWidth: 1, borderTopColor: c.line },
    suggestText: { fontSize: fontSize.sm, color: c.ink },
    pressed: { backgroundColor: c.brandWash },
    multiline: { minHeight: 84, paddingTop: spacing.sm, textAlignVertical: 'top' },
    failure: { fontSize: fontSize.sm, ...font('600'), color: c.dangerText },
    actions: { flexDirection: 'row', gap: spacing.sm },
    grow: { flex: 1 },
  });
