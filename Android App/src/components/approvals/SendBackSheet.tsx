import React, { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { TextField } from '../ui';
import { Sheet, SheetButtons, SheetMessage } from '../meeting/sheet-kit';
import { DECISION_WORDS, REASON_MAX, sendBackNote, sendBackTitle } from '../../lib/approvals';
import { sendBackCheck } from '../../lib/approval-section';
import { spacing } from '../../lib/theme';

/**
 * Sending a waiting task back asks why (the website's SendBackDialog): the reason is required, sent
 * trimmed, and becomes the approver's comment on the task, sent to the people on it; the task goes
 * back to In progress. The box stops at the server's 2000 characters. Nothing is sent until the
 * reason is there; a failure keeps the sheet open with the reason, saying why.
 */
export function SendBackSheet({
  visible,
  taskKey,
  taskTitle,
  busy,
  error,
  onSend,
  onClose,
}: {
  visible: boolean;
  taskKey: string;
  taskTitle: string;
  busy?: boolean;
  /** Why it couldn't be sent back (the sheet stays open, the reason kept). */
  error?: string | null;
  onSend(reason: string): void;
  onClose(): void;
}) {
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  // Each time it opens: an empty box.
  useEffect(() => {
    if (visible) {
      setReason('');
      setProblem(null);
    }
  }, [visible]);

  const send = () => {
    const check = sendBackCheck(reason);
    if (!check.ok) {
      setProblem(check.message);
      return;
    }
    if (busy) return;
    setProblem(null);
    onSend(check.reason);
  };

  return (
    <Sheet
      visible={visible}
      title={sendBackTitle(taskKey)}
      onClose={busy ? () => {} : onClose}
      footer={<SheetButtons cancel={DECISION_WORDS.cancel} onCancel={onClose} confirm={DECISION_WORDS.sendBack} onConfirm={send} busy={busy} />}
    >
      <SheetMessage tone="info" text={sendBackNote(taskTitle)} />
      <TextField
        label={DECISION_WORDS.reasonLabel}
        required
        value={reason}
        onChangeText={(text) => {
          setReason(text);
          if (problem) setProblem(null);
        }}
        placeholder={DECISION_WORDS.reasonPlaceholder}
        multiline
        maxLength={REASON_MAX}
        error={problem}
        autoFocus
        style={styles.box}
      />
      <SheetMessage text={error} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  box: { minHeight: 96, paddingTop: spacing.sm, textAlignVertical: 'top' },
});
