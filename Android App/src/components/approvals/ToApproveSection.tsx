import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useColors } from '../../core/theme';
import { useApprovalActions, useApprovals } from '../../core/approval-queries';
import { Button, Card, ErrorNote } from '../ui';
import { Icon } from '../Icon';
import { ProjectAvatar } from '../ProjectAvatar';
import { SendBackSheet } from './SendBackSheet';
import { notice } from '../notice';
import { DECISION_WORDS, approvedNotice, sentBackNotice } from '../../lib/approvals';
import { APPROVAL_SECTION_TEXT, TO_APPROVE_SUB, toApproveRows, toApproveTitle, type ToApproveRow } from '../../lib/approval-section';
import { failureText } from '../../lib/task-detail';
import { appTimeZone } from '../../lib/due-date';
import { fontSize, radius, spacing, type Palette } from '../../lib/theme';
import { font, typeStyle } from '../../lib/typography';
import type { ApprovalTask } from '../../lib/types';

/**
 * My Tasks' "To approve" (the website's ToApproveSection): the tasks finished by others that wait for
 * this person's OK (they run the project, or are an administrator), the longest waiting first, each
 * with Approve and Send back. Shown only while something waits. A decision goes to the server at once
 * (online only); a failure stays on its row, in words, and the row stays.
 */
export function ToApproveSection({ onOpen }: { onOpen(taskId: string): void }) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const q = useApprovals();
  const actions = useApprovalActions();
  const rows = toApproveRows(q.data, Date.now(), appTimeZone());
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ id: string; text: string } | null>(null);
  const [sending, setSending] = useState<ApprovalTask | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  async function approve(row: ToApproveRow) {
    setBusy(row.task.id);
    setProblem(null);
    try {
      await actions.approve(row.task);
      notice(approvedNotice(row.task.key));
    } catch (e) {
      setProblem({ id: row.task.id, text: failureText(e, APPROVAL_SECTION_TEXT.approveFailed) });
    } finally {
      setBusy(null);
    }
  }

  function sendBack(t: ApprovalTask, reason: string) {
    setBusy(t.id);
    setSendError(null);
    actions
      .sendBack(t, reason)
      .then(
        () => {
          setSending(null);
          notice(sentBackNotice(t.key));
        },
        (e: unknown) => setSendError(failureText(e, APPROVAL_SECTION_TEXT.sendBackFailed)),
      )
      .finally(() => setBusy(null));
  }

  if (rows.length === 0) return null;

  return (
    <View style={s.wrap}>
      <View style={s.headRow}>
        <Icon name="misc.waiting" size={16} color={c.warningText} />
        <Text style={s.title} accessibilityRole="header">
          {toApproveTitle(rows.length)}
        </Text>
      </View>
      <Text style={s.sub}>{TO_APPROVE_SUB}</Text>
      {rows.map((row) => (
        <Card key={row.task.id} style={s.card}>
          <Pressable
            onPress={() => onOpen(row.task.id)}
            accessibilityRole="button"
            accessibilityLabel={`Open ${row.task.key}: ${row.task.title}`}
            style={({ pressed }) => [s.open, pressed && s.pressed]}
          >
            <Text style={s.key}>{row.task.key}</Text>
            <Text style={s.taskTitle} numberOfLines={2}>
              {row.task.title}
            </Text>
          </Pressable>
          <View style={s.meta}>
            <View style={s.project}>
              <ProjectAvatar project={row.task.project} size="xs" />
              <Text style={s.small} numberOfLines={1}>
                {row.task.project.name}
              </Text>
            </View>
            {row.finishedLine ? <Text style={s.small}>{row.finishedLine}</Text> : null}
          </View>
          {problem?.id === row.task.id ? <ErrorNote message={problem.text} /> : null}
          <View style={s.buttons}>
            <Button
              title={DECISION_WORDS.approve}
              accessibilityLabel={row.approveLabel}
              size="sm"
              onPress={() => void approve(row)}
              loading={busy === row.task.id && sending === null}
              disabled={busy !== null}
            />
            <Button
              title={DECISION_WORDS.sendBack}
              accessibilityLabel={row.sendBackLabel}
              variant="secondary"
              size="sm"
              onPress={() => {
                setProblem(null);
                setSendError(null);
                setSending(row.task);
              }}
              disabled={busy !== null}
            />
          </View>
        </Card>
      ))}
      <SendBackSheet
        visible={sending !== null}
        taskKey={sending?.key ?? ''}
        taskTitle={sending?.title ?? ''}
        busy={sending !== null && busy === sending.id}
        error={sendError}
        onSend={(reason) => {
          if (sending) sendBack(sending, reason);
        }}
        onClose={() => setSending(null)}
      />
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    wrap: { gap: spacing.sm, marginBottom: spacing.xs },
    headRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    title: { fontSize: fontSize.md, ...font('600', 'display'), color: c.ink },
    sub: { ...typeStyle('caption'), color: c.ink2 },
    card: { gap: spacing.xs },
    open: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    pressed: { opacity: 0.6 },
    key: { fontSize: fontSize.xs, color: c.ink2, fontFamily: 'monospace', backgroundColor: c.ground, borderRadius: radius.badge, paddingHorizontal: 6, paddingVertical: 2 },
    taskTitle: { flex: 1, fontSize: fontSize.sm, ...font('500'), color: c.ink },
    meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: spacing.sm, rowGap: 2 },
    project: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
    small: { ...typeStyle('caption'), color: c.ink2, flexShrink: 1 },
    buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  });
