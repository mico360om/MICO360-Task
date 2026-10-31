import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';
import { useColors } from '../../core/theme';
import { MAX_QUESTION } from '../../lib/mico-ai-chat';
import { radius, shadow, spacing, type Palette } from '../../lib/theme';
import { typeStyle } from '../../lib/typography';
import { Button, IconButton } from '../ui';

export interface ComposerHandle {
  /** Focus the box (unless it is off). */
  focus: () => void;
  /** Put a question back in the box (it couldn't be sent). */
  restore: (text: string) => void;
}

export interface ComposerProps {
  /** MICO AI is set up (else the box is off and says so). */
  ready: boolean;
  /** A question can be sent now (nothing is being written or sent). */
  canAsk: boolean;
  /** An answer is being written: Send turns into Stop. */
  pending: boolean;
  /** The question is on its way. */
  sending: boolean;
  error: string | null;
  onSend: (text: string) => void;
  onStop: () => void;
}

/**
 * The box at the bottom of MICO AI, as the website's Composer: what is typed (up to 4,000
 * characters), Send — or Stop while an answer is written — a hint line, and the note on what MICO AI
 * answers from. What is typed lives here, so typing never redraws the conversation.
 */
export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer({ ready, canAsk, pending, sending, error, onSend, onStop }, ref) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const [draft, setDraft] = useState('');
  const box = useRef<TextInput>(null);
  useImperativeHandle(ref, () => ({
    focus: () => {
      if (ready) box.current?.focus();
    },
    restore: (text: string) => setDraft(text),
  }));

  const submit = () => {
    if (!canAsk || !draft.trim()) return;
    const text = draft;
    setDraft('');
    onSend(text);
  };

  const hint = pending ? 'MICO AI is working…' : sending ? 'Sending…' : null;
  return (
    <View style={s.wrap}>
      {error ? (
        <Text style={s.error} accessibilityRole="alert" accessibilityLiveRegion="assertive">
          {error}
        </Text>
      ) : null}
      <View style={s.box}>
        <TextInput
          ref={box}
          multiline
          value={draft}
          onChangeText={setDraft}
          editable={ready}
          maxLength={MAX_QUESTION}
          placeholder={ready ? 'Ask MICO AI…' : 'MICO AI isn’t set up yet'}
          placeholderTextColor={c.ink3}
          accessibilityLabel="Ask MICO AI"
          style={s.input}
        />
        {pending ? (
          <Button title="Stop" variant="secondary" size="sm" onPress={onStop} />
        ) : sending ? (
          <View style={s.spinner} accessibilityLabel="Sending…">
            <ActivityIndicator color={c.brandText} />
          </View>
        ) : (
          <IconButton icon="ui.send" label="Send" onPress={submit} disabled={!canAsk || !draft.trim()} color={c.brandText} />
        )}
      </View>
      {/* Not a live region: the screen's own says once that MICO AI is working. */}
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
      <Text style={s.note}>MICO AI answers only from MICO360 data you can see, and links its sources. Check important figures before sharing.</Text>
    </View>
  );
});

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    wrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs, paddingBottom: spacing.sm, backgroundColor: c.surface, gap: 6 },
    error: { ...typeStyle('label'), color: c.dangerText, backgroundColor: c.dangerSoft, borderRadius: radius.button, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, overflow: 'hidden' },
    box: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, borderWidth: 1, borderColor: c.line, borderRadius: radius.sheet, backgroundColor: c.surface, paddingLeft: 14, paddingRight: 4, paddingVertical: 4, ...shadow.card },
    input: { ...typeStyle('body'), fontSize: 15, lineHeight: 22, color: c.ink, flex: 1, minHeight: 44, maxHeight: 200, paddingVertical: 10, textAlignVertical: 'center' },
    spinner: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    hint: { ...typeStyle('caption'), color: c.ink2 },
    note: { ...typeStyle('caption'), color: c.ink3, textAlign: 'center' },
  });
