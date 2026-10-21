import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useColors } from '../../core/theme';
import { useParseTask } from '../../core/new-task';
import { Button, TextField } from '../ui';
import { CheckRow, SheetMessage } from '../meeting/sheet-kit';
import { chosenTaskPatch, describeFailure, describeHint, DESCRIBE_TEXT, type AiTaskDraft, type DescribedFields, type TaskSuggestion } from '../../lib/task-describe';
import { companyTodayKey } from '../../lib/due-date';
import { AI_SENTENCE_MAX } from '../../lib/resources';
import { spacing, radius, fontSize } from '../../lib/theme';

/**
 * "Describe it in plain English" (4a), as on the website: the assistant reads a sentence and
 * suggests a title, description, due date, repeat, priority (and the project, when it can still be
 * chosen). Nothing changes until "Use selected details"; a suggestion that would replace something
 * you set yourself starts unticked. Needs a connection; the AI may take up to about two minutes.
 */
export function DescribeTask({
  timeZone,
  withProject,
  suggest,
  onApply,
  disabled,
}: {
  timeZone: string;
  /** The project can still be chosen: it may be suggested too. */
  withProject: boolean;
  /** What the form would take from the server's reading (weighed against the form when it arrives). */
  suggest: (d: AiTaskDraft) => TaskSuggestion[];
  onApply: (patch: Partial<DescribedFields>) => void;
  disabled?: boolean;
}) {
  const c = useColors();
  const parse = useParseTask();
  // The AI may take a while: its answer is weighed against the form as it is when it arrives.
  const latest = useRef(suggest);
  latest.current = suggest;
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [found, setFound] = useState<TaskSuggestion[] | null>(null);

  const read = () => {
    const t = text.trim();
    if (!t || parse.isPending) return;
    setProblem(null);
    setFound(null);
    parse.mutate(
      { text: t, today: companyTodayKey(new Date(), timeZone) },
      {
        onSuccess: (d) => setFound(latest.current(d)),
        onError: (e) => setProblem(describeFailure(e)),
      },
    );
  };

  return (
    <View style={[styles.card, { borderColor: c.brand, backgroundColor: c.brandWash }]}>
      <Text style={[styles.title, { color: c.brand }]} accessibilityRole="header">
        ✨ {DESCRIBE_TEXT.heading}
      </Text>
      <Text style={[styles.hint, { color: c.ink2 }]}>{describeHint(withProject)}</Text>
      <TextField
        accessibilityLabel={DESCRIBE_TEXT.heading}
        value={text}
        onChangeText={(v) => {
          setText(v);
          if (problem) setProblem(null);
        }}
        placeholder={DESCRIBE_TEXT.placeholder}
        multiline
        maxLength={AI_SENTENCE_MAX}
        editable={!disabled}
        style={styles.multiline}
      />
      <Button title={parse.isPending ? DESCRIBE_TEXT.reading : DESCRIBE_TEXT.read} variant="secondary" onPress={read} loading={parse.isPending} disabled={disabled || !text.trim()} />
      <SheetMessage text={problem} />
      {found && found.length === 0 ? <SheetMessage text={DESCRIBE_TEXT.nothingNew} tone="info" /> : null}
      {found && found.length > 0 ? (
        <View style={[styles.found, { borderColor: c.line, backgroundColor: c.surface }]} accessibilityLabel="Suggested details">
          <Text style={[styles.heading, { color: c.ink2 }]} accessibilityRole="header">
            {DESCRIBE_TEXT.found.toUpperCase()}
          </Text>
          {found.map((s) => (
            <View key={s.key}>
              <CheckRow
                label={`${s.label}: ${s.shown}`}
                checked={s.checked}
                onChange={() => setFound((f) => f?.map((x) => (x.key === s.key ? { ...x, checked: !x.checked } : x)) ?? f)}
              />
              {s.replaces ? <Text style={[styles.replaces, { color: c.ink2 }]}>Replaces {s.replaces}</Text> : null}
            </View>
          ))}
          <View style={styles.row}>
            <Button title={DESCRIBE_TEXT.dismiss} variant="ghost" onPress={() => setFound(null)} style={styles.flex} />
            <Button
              title={DESCRIBE_TEXT.use}
              onPress={() => {
                onApply(chosenTaskPatch(found));
                setFound(null);
              }}
              disabled={disabled || !found.some((s) => s.checked)}
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
