import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useColors } from '../../core/theme';
import { DRAFT_DELAY_MS, ITEM_WORDS, allowedText, followUpLine, outsideText, readOnlyReading, readingDraft, readingError, readingKeyboard, readingLabel } from '../../lib/inspection-item';
import { effectiveResult, INSPECTION_LIMITS, parseReading, type FormItem, type ItemResult } from '../../lib/inspection-rules';
import type { AnswerView, FollowUpView } from '../../lib/inspection-types';
import type { IconName } from '../../lib/icons';
import { radius, spacing, type Palette } from '../../lib/theme';
import { toneStyle } from '../../lib/tone';
import { font, typeStyle } from '../../lib/typography';
import { Icon } from '../Icon';
import { Button, TextField } from '../ui';
import { ResultChip } from './ResultChip';

export interface ItemAnswer {
  result: ItemResult | null;
  reading: string | null;
  note: string | null;
}

const CHOICES: Array<{ value: ItemResult; label: string; icon: IconName | null }> = [
  { value: 'PASS', label: ITEM_WORDS.pass, icon: 'misc.check' },
  { value: 'FAIL', label: ITEM_WORDS.fail, icon: 'ui.close' },
  { value: 'NA', label: ITEM_WORDS.na, icon: null },
];

const choiceLook = (c: Palette, value: ItemResult) =>
  value === 'PASS' ? toneStyle(c, 'success') : value === 'FAIL' ? toneStyle(c, 'danger') : { bg: c.ground, fg: c.ink, border: c.ink3 };

/**
 * One checklist item, as the website's InspectionItem: Pass / Fail / N/A (a radio group), or a
 * reading with its unit and limits whose result is worked out as it is typed — outside the limits
 * it fails, in words, not by colour alone. Either may carry a note. A reading or note being typed
 * is saved a moment after the last key, and at once when the box is left. A failed item offers a
 * follow-up task (or names the one made).
 */
export function InspectionItemRow({
  item,
  number,
  answer,
  readOnly,
  onAnswer,
  followUp,
  canMakeFollowUp,
  onMakeFollowUp,
  onOpenTask,
}: {
  item: FormItem;
  /** Its number through the whole inspection (as the report numbers it). */
  number: number;
  answer: AnswerView | undefined;
  readOnly: boolean;
  onAnswer: (value: ItemAnswer) => void;
  /** Its follow-up task as the server has it, and whether one waits on this phone. */
  followUp?: { view: FollowUpView | undefined; queued: boolean } | null;
  canMakeFollowUp?: boolean;
  onMakeFollowUp?: () => void;
  onOpenTask?: (taskId: string) => void;
}) {
  const c = useColors();
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState(answer?.note ?? '');
  const [typedReading, setTypedReading] = useState(answer?.reading ?? '');
  const [readingProblem, setReadingProblem] = useState<string | null>(null);
  const editingReading = useRef(false);
  const editingNote = useRef(false);
  // The newest answer and callback, for a save that runs a moment after typing stops.
  const answerRef = useRef(answer);
  answerRef.current = answer;
  const onAnswerRef = useRef(onAnswer);
  onAnswerRef.current = onAnswer;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const drafts = useRef<Record<'note' | 'reading', { timer: ReturnType<typeof setTimeout>; run: () => void } | undefined>>({ note: undefined, reading: undefined });
  const later = (which: 'note' | 'reading', run: () => void) => {
    const was = drafts.current[which];
    if (was) clearTimeout(was.timer);
    drafts.current[which] = {
      run,
      timer: setTimeout(() => {
        drafts.current[which] = undefined;
        // Signed or finished meanwhile: nothing more to save.
        if (!readOnlyRef.current) run();
      }, DRAFT_DELAY_MS),
    };
  };
  const cancel = (which: 'note' | 'reading') => {
    const was = drafts.current[which];
    if (was) clearTimeout(was.timer);
    drafts.current[which] = undefined;
  };
  // Leaving the screen (or the item going) saves what was being typed.
  useEffect(
    () => () => {
      for (const which of ['note', 'reading'] as const) {
        const was = drafts.current[which];
        if (!was) continue;
        clearTimeout(was.timer);
        drafts.current[which] = undefined;
        if (!readOnlyRef.current) was.run();
      }
    },
    [],
  );

  // A newer answer (from another device, or sent back by the server) shows unless it is being typed.
  useEffect(() => {
    if (!editingReading.current) setTypedReading(answer?.reading ?? '');
  }, [answer?.reading]);
  useEffect(() => {
    if (!editingNote.current) setNoteText(answer?.note ?? '');
  }, [answer?.note]);

  const note = answer?.note ?? null;
  const save = (next: Partial<ItemAnswer>) => {
    const a = answerRef.current;
    onAnswerRef.current({ result: a?.result ?? null, reading: a?.reading ?? null, note: a?.note ?? null, ...next });
  };
  const saveNoteText = (value: string) => {
    const text = value.trim();
    if ((text || null) !== (answerRef.current?.note ?? null)) save({ note: text || null });
  };
  const saveReadingText = (value: string) => {
    const v = value.trim() ? parseReading(value.trim()) : null;
    if (v !== null && v !== answerRef.current?.reading) save({ reading: v, result: null });
  };

  // A reading's result as it stands while typed (the server works it out the same way).
  const draft = item.kind === 'READING' ? readingDraft(item, typedReading) : null;
  const liveResult: ItemResult | null = item.kind === 'READING' && typedReading.trim() ? draft!.result : effectiveResult(item, answer ?? null);
  const failed = liveResult === 'FAIL';
  const allowed = item.kind === 'READING' ? allowedText(item) : '';

  const commitReading = () => {
    cancel('reading');
    editingReading.current = false;
    if (item.kind !== 'READING') return;
    const text = typedReading.trim();
    if (!text) {
      setReadingProblem(null);
      if (answer?.reading) save({ reading: null, result: null });
      return;
    }
    const problem = readingError(text);
    setReadingProblem(problem);
    if (problem) return;
    const value = parseReading(text);
    if (value !== answer?.reading) save({ reading: value, result: null });
  };
  const commitNote = () => {
    cancel('note');
    editingNote.current = false;
    saveNoteText(noteText);
  };
  const noReading = (result: 'NA' | 'FAIL') => {
    cancel('reading');
    setTypedReading('');
    setReadingProblem(null);
    save({ reading: null, result });
  };

  const line = failed ? followUpLine(followUp?.view, { queued: !!followUp?.queued, canMake: !!canMakeFollowUp && !!onMakeFollowUp }) : null;
  const naOn = !answer?.reading && answer?.result === 'NA';
  const cantOn = !answer?.reading && answer?.result === 'FAIL';

  return (
    <View style={[s.row, { borderTopColor: c.line }]}>
      <Text style={[s.number, { color: c.ink3 }]} importantForAccessibility="no">
        {number}
      </Text>
      <View style={s.body}>
        <View style={s.head}>
          <Text style={[typeStyle('bodyStrong'), s.label, { color: c.ink }]}>{item.label}</Text>
          {readOnly || item.kind === 'READING' ? <ResultChip result={liveResult} /> : null}
        </View>
        {item.help ? <Text style={[typeStyle('caption'), { color: c.ink2 }]}>{item.help}</Text> : null}

        {item.kind === 'CHECK' && !readOnly ? (
          <View style={s.choices} accessibilityRole="radiogroup" accessibilityLabel={item.label}>
            {CHOICES.map((choice) => {
              const on = answer?.result === choice.value;
              const look = choiceLook(c, choice.value);
              return (
                <Pressable
                  key={choice.value}
                  onPress={() => save({ result: choice.value })}
                  accessibilityRole="radio"
                  accessibilityLabel={choice.label}
                  accessibilityState={{ checked: on }}
                  style={({ pressed }) => [s.choice, { borderColor: on ? look.border : c.line, backgroundColor: on ? look.bg : c.surface }, pressed && s.pressed]}
                >
                  {on && choice.icon ? <Icon name={choice.icon} size={14} color={look.fg} /> : null}
                  <Text style={[s.choiceText, { color: on ? look.fg : c.ink2 }]}>{choice.label}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {item.kind === 'READING' ? (
          <View style={s.reading}>
            {allowed ? <Text style={[typeStyle('caption'), { color: c.ink2 }]}>{allowed}</Text> : null}
            {readOnly ? (
              <Text style={[typeStyle('body'), { color: c.ink }]}>{readOnlyReading(item, answer)}</Text>
            ) : (
              <View style={s.readingRow}>
                <View style={s.readingBox}>
                  <TextField
                    value={typedReading}
                    onChangeText={(value) => {
                      editingReading.current = true;
                      setTypedReading(value);
                      if (readingProblem) setReadingProblem(null);
                      later('reading', () => saveReadingText(value));
                    }}
                    onBlur={commitReading}
                    onSubmitEditing={commitReading}
                    keyboardType={readingKeyboard(item)}
                    autoComplete="off"
                    maxLength={INSPECTION_LIMITS.readingMax}
                    placeholder={ITEM_WORDS.readingPlaceholder}
                    accessibilityLabel={readingLabel(item)}
                    error={readingProblem}
                    style={s.readingInput}
                  />
                </View>
                {item.unit ? <Text style={[typeStyle('body'), { color: c.ink2 }]}>{item.unit}</Text> : null}
                <Pressable
                  onPress={() => noReading('NA')}
                  accessibilityRole="button"
                  accessibilityLabel={ITEM_WORDS.naLabel.replace('{label}', item.label)}
                  accessibilityState={{ selected: naOn }}
                  style={({ pressed }) => [s.small, { borderColor: naOn ? c.ink3 : c.line, backgroundColor: naOn ? c.ground : c.surface }, pressed && s.pressed]}
                >
                  <Text style={[s.smallText, { color: naOn ? c.ink : c.ink2 }]}>{ITEM_WORDS.na}</Text>
                </Pressable>
                <Pressable
                  onPress={() => noReading('FAIL')}
                  accessibilityRole="button"
                  accessibilityLabel={ITEM_WORDS.cantTakeLabel.replace('{label}', item.label)}
                  accessibilityState={{ selected: cantOn }}
                  style={({ pressed }) => [s.small, { borderColor: cantOn ? c.danger : c.line, backgroundColor: cantOn ? c.dangerSoft : c.surface }, pressed && s.pressed]}
                >
                  <Text style={[s.smallText, { color: cantOn ? c.dangerText : c.ink2 }]}>{ITEM_WORDS.cantTake}</Text>
                </Pressable>
              </View>
            )}
            {failed && allowed && (draft?.reading || answer?.reading) ? <Text style={[typeStyle('caption'), font('600'), { color: c.dangerText }]}>{outsideText(item)}</Text> : null}
          </View>
        ) : null}

        {readOnly ? (
          note ? <Text style={[typeStyle('body'), s.readNote, { color: c.ink, backgroundColor: c.ground }]}>{note}</Text> : null
        ) : noteOpen || note ? (
          <TextField
            label={ITEM_WORDS.note}
            accessibilityLabel={ITEM_WORDS.noteLabel.replace('{label}', item.label)}
            value={noteText}
            onChangeText={(value) => {
              editingNote.current = true;
              setNoteText(value);
              later('note', () => saveNoteText(value));
            }}
            onBlur={commitNote}
            multiline
            numberOfLines={2}
            maxLength={INSPECTION_LIMITS.noteMax}
            style={s.noteInput}
          />
        ) : (
          <View style={s.noteButton}>
            <Button title={ITEM_WORDS.note} icon="ui.plus" variant="ghost" size="sm" onPress={() => setNoteOpen(true)} accessibilityLabel={ITEM_WORDS.addNoteLabel.replace('{label}', item.label)} />
          </View>
        )}

        {line?.kind === 'task' ? (
          <Pressable onPress={onOpenTask ? () => onOpenTask(line.taskId) : undefined} disabled={!onOpenTask} accessibilityRole="link" style={s.follow}>
            <Text style={[typeStyle('label'), { color: c.brandText }]}>{line.text}</Text>
          </Pressable>
        ) : line?.kind === 'text' ? (
          <Text style={[typeStyle('caption'), s.follow, { color: c.ink2 }]}>{line.text}</Text>
        ) : line?.kind === 'make' ? (
          <View style={s.noteButton}>
            <Button title={ITEM_WORDS.makeFollowUp} variant="ghost" size="sm" onPress={onMakeFollowUp!} accessibilityLabel={ITEM_WORDS.makeFollowUpLabel.replace('{label}', item.label)} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  number: { width: 22, textAlign: 'right', ...font('500'), fontSize: 12, lineHeight: 20, fontVariant: ['tabular-nums'] },
  body: { flex: 1, gap: spacing.xs },
  head: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
  label: { flexShrink: 1 },
  choices: { flexDirection: 'row', gap: 6, marginTop: spacing.xs },
  choice: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, borderWidth: 1, borderRadius: radius.input },
  choiceText: { ...font('600'), fontSize: 14 },
  pressed: { opacity: 0.85 },
  reading: { gap: spacing.xs, marginTop: spacing.xs },
  readingRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  readingBox: { width: 128 },
  readingInput: { minHeight: 44 },
  small: { minHeight: 44, minWidth: 44, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: radius.input },
  smallText: { ...font('600'), fontSize: 12 },
  readNote: { borderRadius: radius.input, paddingHorizontal: 10, paddingVertical: 6, marginTop: spacing.xs },
  noteInput: { minHeight: 64, textAlignVertical: 'top' },
  noteButton: { alignSelf: 'flex-start' },
  follow: { minHeight: 44, justifyContent: 'center' },
});
