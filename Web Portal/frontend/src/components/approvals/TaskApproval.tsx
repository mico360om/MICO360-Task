import { useId, useState } from 'react';
import type { ApiTask } from '../../api/tasks';
import { Toggle } from '../ui/Toggle';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { ApprovalChip } from './ApprovalChip';
import { SendBackDialog } from './SendBackDialog';
import { APPROVAL_HINT, isWaitingForApproval, waitingForText } from '../../lib/approvals';
import { relativeTime } from '../../lib/relative-time';

export interface TaskApprovalProps {
  task: ApiTask;
  /** Tick or untick "Needs approval"; rejects with the reason to show. Left out: shown, not changeable. */
  onSetNeedsApproval?: (on: boolean) => Promise<void>;
  /** Approve the waiting task (it is done then); rejects with the reason to show. */
  onApprove?: () => Promise<void>;
  /** Send it back with a reason (it is in progress again); rejects with the reason to show. */
  onSendBack?: (reason: string) => Promise<void>;
}

const messageOf = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

/**
 * The task panel's "Approval" section: the "Needs approval" tick (anyone who can edit the task), and
 * — while the task waits — the badge, who finished it, and Approve / Send back for the people who run
 * its project (everyone else reads whose approval it waits for). Turning approval off while it waits
 * is only for them, and asks first: the task is then marked done.
 */
export function TaskApproval({ task, onSetNeedsApproval, onApprove, onSendBack }: TaskApprovalProps) {
  const id = useId();
  const waiting = isWaitingForApproval(task);
  const info = task.approval;
  const canApprove = Boolean(info?.canApprove);
  const needs = Boolean(task.needsApproval);
  const [busy, setBusy] = useState<'tick' | 'approve' | 'send' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const lockedOn = waiting && !canApprove;

  async function run(kind: 'tick' | 'approve', action: () => Promise<void>, fallback: string) {
    setBusy(kind);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(messageOf(e, fallback));
    } finally {
      setBusy(null);
    }
  }
  const setTick = (on: boolean) => (onSetNeedsApproval ? run('tick', () => onSetNeedsApproval(on), 'Couldn’t change it. Please try again.') : undefined);

  return (
    <section aria-labelledby={`${id}-heading`} data-testid="task-approval" className="min-w-0">
      <h3 id={`${id}-heading`} className="eyebrow mb-2">
        Approval
      </h3>

      {waiting ? (
        <div className="mb-3 rounded-xl border border-warning/30 bg-warning-soft/50 p-3">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <ApprovalChip size="sm" />
            {info?.requestedBy ? (
              <span className="text-xs text-ink-2">
                Finished by <bdi className="font-medium text-ink">{info.requestedBy.name}</bdi>
                {task.approvalRequestedAt ? ` · ${relativeTime(task.approvalRequestedAt)}` : ''}
              </span>
            ) : null}
          </div>
          {canApprove && (onApprove || onSendBack) ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {onApprove ? (
                <Button size="sm" loading={busy === 'approve'} disabled={busy !== null} onClick={() => void run('approve', onApprove, 'Couldn’t approve it. Please try again.')} className="[@media(pointer:coarse)]:!min-h-11">
                  Approve
                </Button>
              ) : null}
              {onSendBack ? (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy !== null}
                  onClick={() => {
                    setSendError(null);
                    setSending(true);
                  }}
                  className="[@media(pointer:coarse)]:!min-h-11"
                >
                  Send back
                </Button>
              ) : null}
            </div>
          ) : (
            <p className="mt-2 text-sm text-ink">{waitingForText(info?.approverName ?? null)}</p>
          )}
        </div>
      ) : task.completedAt && info?.approvedBy ? (
        <p className="mb-3 text-xs text-ink-2">
          Approved by <bdi className="font-medium text-ink">{info.approvedBy.name}</bdi>
          {task.approvedAt ? ` · ${relativeTime(task.approvedAt)}` : ''}
        </p>
      ) : null}

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="block text-sm font-medium text-ink">Needs approval</span>
          <p id={`${id}-hint`} className="text-xs text-ink-2">
            {APPROVAL_HINT}
          </p>
          {lockedOn && onSetNeedsApproval ? <p className="mt-0.5 text-xs text-ink-3">Only a project manager can turn this off while it waits.</p> : null}
        </div>
        <Toggle
          on={needs}
          label="Needs approval"
          describedBy={`${id}-hint`}
          disabled={!onSetNeedsApproval || lockedOn || busy !== null}
          onChange={() => {
            if (needs && waiting) setConfirmOff(true);
            else void setTick(!needs);
          }}
        />
      </div>
      {error ? (
        <p role="alert" className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}

      {sending && onSendBack ? (
        <SendBackDialog
          taskKey={task.key}
          taskTitle={task.title}
          busy={busy === 'send'}
          error={sendError}
          onClose={() => setSending(false)}
          onSend={(reason) => {
            setBusy('send');
            setSendError(null);
            onSendBack(reason)
              .then(() => setSending(false))
              .catch((e: unknown) => setSendError(messageOf(e, 'Couldn’t send it back. Please try again.')))
              .finally(() => setBusy(null));
          }}
        />
      ) : null}
      {confirmOff ? (
        <ConfirmDialog
          title="Turn off approval?"
          confirmLabel="Turn off and mark done"
          keepLabel="Keep waiting"
          tone="primary"
          busy={busy === 'tick'}
          error={error}
          onClose={() => setConfirmOff(false)}
          onConfirm={() => {
            void (async () => {
              await setTick(false);
              setConfirmOff(false);
            })();
          }}
        >
          It is waiting for approval. Turning approval off marks it done now.
        </ConfirmDialog>
      ) : null}
    </section>
  );
}
