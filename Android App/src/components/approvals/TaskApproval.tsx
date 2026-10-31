import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useColors } from '../../core/theme';
import { useApprovalActions } from '../../core/approval-queries';
import { ApprovalChip, Button, ErrorNote, Muted, Toggle } from '../ui';
import { SectionCard } from '../task-detail/kit';
import { Sheet, SheetButtons, SheetMessage } from '../meeting/sheet-kit';
import { SendBackSheet } from './SendBackSheet';
import { notice } from '../notice';
import { DECISION_WORDS, approveLabel, approvedNotice, sendBackLabel, sentBackNotice } from '../../lib/approvals';
import { APPROVAL_SECTION_TEXT, approvalView } from '../../lib/approval-section';
import { failureText } from '../../lib/task-detail';
import { appTimeZone } from '../../lib/due-date';
import { hexToRgba, radius, spacing, type Palette } from '../../lib/theme';
import { typeStyle } from '../../lib/typography';
import type { ApiTask } from '../../lib/types';

/**
 * The task's "Approval" section (the website's TaskApproval): while it waits, the badge and who
 * finished it, then Approve / Send back for the people who run its project — everyone else reads
 * whose approval it waits for; once done, who approved it. Then the "Needs approval" switch: anyone
 * may turn it on, only the project's managers (and administrators) may turn it off — for anyone
 * else it stays on and says why. Turning it off while it waits asks first: the task is then done.
 * Every change goes to the server at once (online only); a refusal is said in the server's words.
 */
export function TaskApproval({ task }: { task: ApiTask }) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const actions = useApprovalActions();
  const view = approvalView(task, Date.now(), appTimeZone());
  const [busy, setBusy] = useState<'tick' | 'approve' | 'send' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);

  /** Turns the switch on or off; false when it failed (the reason is shown). */
  async function setTick(next: boolean): Promise<boolean> {
    setBusy('tick');
    setError(null);
    try {
      await actions.setNeedsApproval(task, next);
      return true;
    } catch (e) {
      setError(failureText(e, APPROVAL_SECTION_TEXT.setFailed));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function approve() {
    setBusy('approve');
    setError(null);
    try {
      await actions.approve(task);
      notice(approvedNotice(task.key));
    } catch (e) {
      setError(failureText(e, APPROVAL_SECTION_TEXT.approveFailed));
    } finally {
      setBusy(null);
    }
  }

  function sendBack(reason: string) {
    setBusy('send');
    setSendError(null);
    actions
      .sendBack(task, reason)
      .then(
        () => {
          setSending(false);
          notice(sentBackNotice(task.key));
        },
        (e: unknown) => setSendError(failureText(e, APPROVAL_SECTION_TEXT.sendBackFailed)),
      )
      .finally(() => setBusy(null));
  }

  const tickHint = view.tick.lockNote ? `${view.tick.hint} ${view.tick.lockNote}` : view.tick.hint;

  return (
    <SectionCard title={APPROVAL_SECTION_TEXT.title}>
      {view.waiting ? (
        <View style={s.waitBox}>
          <View style={s.waitRow}>
            <ApprovalChip size="sm" />
            {view.finishedLine ? <Text style={s.small}>{view.finishedLine}</Text> : null}
          </View>
          {view.decide ? (
            <View style={s.buttons}>
              <Button
                title={DECISION_WORDS.approve}
                accessibilityLabel={approveLabel(task.key)}
                size="sm"
                onPress={() => void approve()}
                loading={busy === 'approve'}
                disabled={busy !== null}
              />
              <Button
                title={DECISION_WORDS.sendBack}
                accessibilityLabel={sendBackLabel(task.key)}
                variant="secondary"
                size="sm"
                onPress={() => {
                  setSendError(null);
                  setSending(true);
                }}
                disabled={busy !== null}
              />
            </View>
          ) : view.waitingFor ? (
            <Text style={s.waitingFor}>{view.waitingFor}</Text>
          ) : null}
        </View>
      ) : view.approvedLine ? (
        <Text style={s.small}>{view.approvedLine}</Text>
      ) : null}

      <Toggle
        label={APPROVAL_SECTION_TEXT.tick}
        on={view.tick.on}
        disabled={view.tick.locked || busy !== null}
        hint={tickHint}
        onChange={(next) => {
          // Off while it waits marks it done: asked first.
          if (view.waiting && !next) setConfirmOff(true);
          else void setTick(next);
        }}
      />
      {/* Said with the switch to TalkBack (its hint); shown here for everyone else. */}
      <Text style={s.small} importantForAccessibility="no">
        {view.tick.hint}
      </Text>
      {view.tick.lockNote ? (
        <Text style={s.small} importantForAccessibility="no">
          {view.tick.lockNote}
        </Text>
      ) : null}
      {error ? <ErrorNote message={error} /> : null}

      <SendBackSheet
        visible={sending}
        taskKey={task.key}
        taskTitle={task.title}
        busy={busy === 'send'}
        error={sendError}
        onSend={sendBack}
        onClose={() => setSending(false)}
      />
      <Sheet
        visible={confirmOff}
        title={APPROVAL_SECTION_TEXT.offTitle}
        onClose={() => {
          if (busy !== 'tick') setConfirmOff(false);
        }}
        footer={
          <SheetButtons
            cancel={APPROVAL_SECTION_TEXT.offKeep}
            onCancel={() => setConfirmOff(false)}
            confirm={APPROVAL_SECTION_TEXT.offConfirm}
            onConfirm={() => {
              void (async () => {
                // Closed once it is done; a failure keeps the question open, saying why.
                if (await setTick(false)) setConfirmOff(false);
              })();
            }}
            busy={busy === 'tick'}
          />
        }
      >
        <Muted>{APPROVAL_SECTION_TEXT.offBody}</Muted>
        <SheetMessage text={error} />
      </Sheet>
    </SectionCard>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    waitBox: { gap: spacing.sm, padding: spacing.sm, borderRadius: radius.input, borderWidth: 1, borderColor: hexToRgba(c.warning, 0.3), backgroundColor: c.warningSoft },
    waitRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
    buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    waitingFor: { ...typeStyle('body'), color: c.ink },
    small: { ...typeStyle('caption'), color: c.ink2 },
  });
