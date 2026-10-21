import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useColors } from '../../core/theme';
import { useInvitePreview, useMinutesPreview, useSendInvites, useSendMinutes } from '../../core/meeting-mutations';
import { ActionRowButton, CardChoice, CheckRow, Sheet, SheetButtons, SheetMessage, useSheetStyles } from './sheet-kit';
import { inviteChoice, inviteFailure, inviteRequest, minutesChoice, sendFailure, sendSummary } from '../../lib/meeting-invites';
import { inviteTry, minutesTry, pendingKeys } from '../../lib/pending-keys';
import { meetingFailure, type ConfirmDialog, type MenuItem } from '../../lib/meeting-flow';
import { meetingWhen } from '../../lib/meeting-detail';
import { spacing, fontSize, radius } from '../../lib/theme';
import type { ApiMeeting, Recipient, SendReport, SeriesScope } from '../../lib/types';

/** "More": the meeting's other actions, the destructive pair last. */
export function ActionsSheet({ visible, items, onPick, onClose }: { visible: boolean; items: MenuItem[]; onPick: (item: MenuItem) => void; onClose: () => void }) {
  return (
    <Sheet visible={visible} title="Meeting actions" onClose={onClose} footer={<SheetButtons cancel="Close" onCancel={onClose} />}>
      {items.map((i) => (
        <ActionRowButton key={i.key} label={i.label} danger={i.danger} onPress={() => onPick(i)} />
      ))}
    </Sheet>
  );
}

/** Cancel or delete, after asking — in a series, this meeting only or all its upcoming ones. */
export function ConfirmScopeSheet({
  visible,
  dialog,
  scope,
  onScope,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  dialog: ConfirmDialog | null;
  scope: SeriesScope;
  onScope: (s: SeriesScope) => void;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const s = useSheetStyles();
  if (!dialog) return null;
  return (
    <Sheet
      visible={visible}
      title={dialog.title}
      onClose={busy ? () => {} : onClose}
      footer={<SheetButtons cancel={dialog.keep} onCancel={onClose} confirm={dialog.confirm} onConfirm={onConfirm} busy={busy} danger />}
    >
      <Text style={s.label}>{dialog.body}</Text>
      {dialog.scopes ? (
        <CardChoice<SeriesScope>
          legend="Which meetings?"
          value={scope}
          onChange={onScope}
          options={[
            { value: 'one', ...dialog.scopes.one },
            { value: 'series', ...dialog.scopes.series },
          ]}
        />
      ) : null}
      {dialog.hint ? <SheetMessage text={dialog.hint} tone="info" /> : null}
      <SheetMessage text={error} />
    </Sheet>
  );
}

/** What happened to each email of a send. */
function SendResults({ report, what }: { report: SendReport; what: string }) {
  const c = useColors();
  const summary = sendSummary(report, what);
  return (
    <View style={styles.gap}>
      <SheetMessage text={summary.text} tone={summary.failed ? 'error' : 'success'} />
      {(report.recipients ?? []).map((r) => (
        <View key={r.email} style={styles.person} accessible accessibilityLabel={`${r.name}, ${r.email}, ${r.ok ? 'delivered' : r.error ?? 'not delivered'}`}>
          <Text style={{ color: r.ok ? c.success : c.danger, fontWeight: '800' }}>{r.ok ? '✓' : '✕'}</Text>
          <View style={styles.flex}>
            <Text style={[styles.name, { color: c.ink }]}>{r.name}</Text>
            <Text style={[styles.small, { color: c.ink3 }]}>{r.email}</Text>
            {!r.ok ? <Text style={[styles.small, { color: c.danger }]}>{r.error ?? 'Not delivered.'}</Text> : null}
          </View>
        </View>
      ))}
      {report.skipped?.length ? <Text style={[styles.small, { color: c.ink2 }]}>Skipped (no email address): {report.skipped.map((x) => x.name).join(', ')}</Text> : null}
    </View>
  );
}

const KIND: Record<Recipient['kind'], string> = { organizer: 'Organizer', member: 'Team', guest: 'Guest' };

function RecipientRow({ r, dim }: { r: Recipient; dim?: boolean }) {
  const c = useColors();
  return (
    <View style={[styles.person, dim && styles.dim]} accessible accessibilityLabel={`${r.name}, ${r.email}, ${KIND[r.kind]}${r.alreadyInvited ? ', already invited' : ''}${dim ? ', not included' : ''}`}>
      <View style={styles.flex}>
        <Text style={[styles.name, { color: c.ink }]}>{r.name}</Text>
        <Text style={[styles.small, { color: c.ink3 }]}>{r.email}</Text>
      </View>
      <Text style={[styles.small, { color: c.ink3 }]}>{KIND[r.kind]}</Text>
      {r.alreadyInvited ? <Text style={[styles.tag, { color: c.ink2, backgroundColor: c.ground }]}>Already invited</Text> : null}
    </View>
  );
}

/**
 * Check the meeting and its recipients, then send calendar invitations (.ics). Once invitations
 * went out, the default is only the people added since; everyone again is an explicit choice. A
 * draft is scheduled as it is sent. Needs a connection.
 */
export function InviteSheet({ meeting, visible, onClose }: { meeting: ApiMeeting; visible: boolean; onClose: () => void }) {
  const c = useColors();
  const previewQ = useInvitePreview(meeting.id, visible);
  const send = useSendInvites(meeting);
  const [mode, setMode] = useState<'new' | 'all' | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!visible) {
      setMode(null);
      setError(null);
      send.reset();
    }
    // Only when the sheet opens or closes (send.reset stays the same for the mutation's life).
  }, [visible]);
  const preview = previewQ.data;
  const choice = preview ? inviteChoice(preview, meeting, mode) : null;
  const draft = meeting.status === 'DRAFT';

  const onSend = () => {
    if (!choice) return;
    setError(null);
    // A send that got no answer keeps its key until one comes — also after this sheet is closed —
    // so sending the same again can't email anyone twice (pending-keys).
    const opts = inviteRequest(choice);
    const what = inviteTry(meeting.id, opts, choice.targets.map((r) => r.email));
    send.mutate({ opts, idempotencyKey: pendingKeys.keyFor(what) }, {
      onSuccess: () => pendingKeys.settle(what),
      onError: (e) => {
        pendingKeys.settle(what, e);
        const f = inviteFailure(e);
        setError(f.text);
        if (f.reload) void previewQ.refetch();
      },
    });
  };

  return (
    <Sheet
      visible={visible}
      title="Send invitations"
      subtitle={`A calendar invitation (.ics) for “${meeting.title}”.${draft ? ' Sending also moves this draft to Scheduled.' : ''}`}
      onClose={send.isPending ? () => {} : onClose}
      footer={
        send.isSuccess ? (
          <SheetButtons cancel="Done" onCancel={onClose} />
        ) : (
          <SheetButtons onCancel={onClose} confirm={choice?.sendLabel ?? 'Send'} onConfirm={onSend} busy={send.isPending} disabled={!choice || choice.blocked || choice.targets.length === 0} />
        )
      }
    >
      {send.isSuccess && send.data ? (
        <SendResults report={send.data} what="Invitation" />
      ) : previewQ.isLoading ? (
        <ActivityIndicator />
      ) : !preview ? (
        <>
          <SheetMessage text={meetingFailure(previewQ.error, 'Couldn’t check the invitation.')} />
          <ActionRowButton label="Retry" onPress={() => void previewQ.refetch()} busy={previewQ.isFetching} />
        </>
      ) : (
        <>
          {preview.problems.length ? (
            preview.problems.map((p) => <SheetMessage key={p.message} text={`${p.level === 'error' ? 'Fix first: ' : 'Check: '}${p.message}`} tone={p.level === 'error' ? 'error' : 'info'} />)
          ) : (
            <SheetMessage text="Everything needed for the invitation is in place." tone="success" />
          )}
          {choice?.sentBefore ? (
            <CardChoice<'new' | 'all'>
              legend={`Invitations already went out on ${meetingWhen({ startAt: choice.sentBefore, endAt: null }).day}. Send to:`}
              value={choice.effective}
              onChange={setMode}
              options={[
                { value: 'new', label: `Only people not invited yet (${choice.fresh.length})`, hint: 'The others already have it.', disabled: choice.fresh.length === 0 },
                { value: 'all', label: `Everyone again (${preview.recipients.length})`, hint: 'An updated invitation for everyone.' },
              ]}
            />
          ) : null}
          <Text style={[styles.section, { color: c.ink2 }]}>RECIPIENTS ({choice?.targets.length ?? 0})</Text>
          {preview.recipients.map((r) => (
            <RecipientRow key={r.email} r={r} dim={!choice?.targets.includes(r)} />
          ))}
          {preview.missingEmail.length ? <SheetMessage text={`No email address, so no invitation: ${preview.missingEmail.map((x) => x.name).join(', ')}.`} tone="info" /> : null}
          <SheetMessage text={error} />
        </>
      )}
    </Sheet>
  );
}

/**
 * Email the minutes PDF: the email as it will arrive (its subject, attachment and words) and who
 * gets it — anyone can be left out before sending. Needs a connection.
 */
export function MinutesEmailSheet({
  meeting,
  visible,
  onClose,
  onDownload,
  downloading,
}: {
  meeting: ApiMeeting;
  visible: boolean;
  onClose: () => void;
  /** Opens the minutes PDF to check; resolves with why it couldn't, or null. */
  onDownload: () => Promise<string | null>;
  downloading: boolean;
}) {
  const c = useColors();
  const previewQ = useMinutesPreview(meeting.id, visible);
  const send = useSendMinutes(meeting.id);
  // Someone left out or put back is another send, with its own key (pending-keys).
  const [left, setLeft] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  useEffect(() => {
    if (!visible) {
      setLeft(new Set());
      setError(null);
      setDownloadError(null);
      send.reset();
    }
  }, [visible]);
  const preview = previewQ.data;
  const choice = preview ? minutesChoice(preview, left) : null;
  const onSend = () => {
    if (!choice) return;
    setError(null);
    // A send that got no answer keeps its key until one comes — also after this sheet is closed and
    // opened again — so "nobody gets it twice" holds (the server has no other guard on it).
    const what = minutesTry(meeting.id, choice.chosen.map((r) => r.email));
    send.mutate(
      { recipients: choice.recipients, idempotencyKey: pendingKeys.keyFor(what) },
      {
        onSuccess: () => pendingKeys.settle(what),
        onError: (e) => {
          pendingKeys.settle(what, e);
          setError(sendFailure(e, 'Couldn’t email the minutes.'));
        },
      },
    );
  };
  const toggle = (email: string) =>
    setLeft((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });

  return (
    <Sheet
      visible={visible}
      title="Email the minutes"
      subtitle="The minutes go as a PDF attachment. Check the email and choose who gets it."
      onClose={send.isPending ? () => {} : onClose}
      footer={
        send.isSuccess ? (
          <SheetButtons cancel="Done" onCancel={onClose} />
        ) : (
          <SheetButtons onCancel={onClose} confirm={choice?.sendLabel ?? 'Send'} onConfirm={onSend} busy={send.isPending} disabled={!choice?.canSend} />
        )
      }
    >
      {send.isSuccess && send.data ? (
        <SendResults report={send.data} what="Minutes" />
      ) : previewQ.isLoading ? (
        <ActivityIndicator />
      ) : !preview ? (
        <>
          <SheetMessage text={meetingFailure(previewQ.error, 'Couldn’t prepare the email.')} />
          <ActionRowButton label="Retry" onPress={() => void previewQ.refetch()} busy={previewQ.isFetching} />
        </>
      ) : (
        <>
          <Text style={[styles.small, { color: c.ink3 }]}>Subject</Text>
          <Text style={[styles.name, { color: c.ink }]}>{preview.subject}</Text>
          <Text style={[styles.small, { color: c.ink3 }]}>Attached</Text>
          <Text style={[styles.name, { color: c.ink }]}>{preview.attachmentName}</Text>
          <ActionRowButton
            label="Download to check"
            onPress={() => {
              setDownloadError(null);
              void onDownload().then(setDownloadError);
            }}
            busy={downloading}
            hint="Opens the minutes PDF to share or save"
          />
          <SheetMessage text={downloadError} />
          {preview.text ? (
            <View style={[styles.preview, { borderColor: c.line, backgroundColor: c.ground }]}>
              <Text style={[styles.small, { color: c.ink2 }]} numberOfLines={14}>
                {preview.text}
              </Text>
            </View>
          ) : null}
          <Text style={[styles.section, { color: c.ink2 }]}>
            SEND TO ({choice?.chosen.length ?? 0} OF {preview.recipients.length})
          </Text>
          <View style={styles.row}>
            <ActionRowButton label="All" onPress={() => setLeft(new Set())} />
            <ActionRowButton label="None" onPress={() => setLeft(new Set(preview.recipients.map((r) => r.email)))} />
          </View>
          {preview.recipients.map((r) => (
            <CheckRow key={r.email} label={`${r.name} — ${r.email}`} checked={!left.has(r.email)} onChange={() => toggle(r.email)} />
          ))}
          {preview.missingEmail.length ? <SheetMessage text={`No email address: ${preview.missingEmail.map((x) => x.name).join(', ')}.`} tone="info" /> : null}
          <SheetMessage text={error} />
        </>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  gap: { gap: spacing.sm },
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: spacing.md },
  person: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs, minHeight: 44 },
  dim: { opacity: 0.5 },
  name: { fontSize: fontSize.md, fontWeight: '600', textAlign: 'auto' },
  small: { fontSize: fontSize.xs },
  tag: { fontSize: fontSize.xs, borderRadius: radius.sm, paddingHorizontal: spacing.xs, overflow: 'hidden' },
  section: { fontSize: fontSize.xs, fontWeight: '800', letterSpacing: 0.8, marginTop: spacing.sm, opacity: 0.7 },
  preview: { borderWidth: 1, borderRadius: radius.md, padding: spacing.sm },
});
