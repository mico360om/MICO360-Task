import { useId, useRef, useState } from 'react';
import { useDialog } from '../../hooks/useDialog';
import { ModalPortal } from '../ui/ModalPortal';
import { Button } from '../ui/Button';
import { dialogLayer, dialogPanel } from '../ui/dialog-size';
import { TOUCH } from './portal-ui';

/** The longest reason the server keeps (it becomes the client's comment). */
export const SEND_BACK_MAX = 2000;

/**
 * 1.23 A client sends a finished task back: why is required (it becomes their comment on the task,
 * and the team is told), and the task goes back to In progress. Escape and Cancel keep things as
 * they are.
 */
export function PortalSendBackDialog({ taskKey, taskTitle, busy = false, error, onSend, onClose }: {
  taskKey: string;
  taskTitle: string;
  busy?: boolean;
  error?: string | null;
  onSend: (reason: string) => void;
  onClose: () => void;
}) {
  const dialogRef = useDialog(busy ? () => {} : onClose);
  const id = useId();
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const blank = reason.trim().length === 0;
  const send = () => {
    setTried(true);
    if (blank) box.current?.focus();
    if (blank || busy) return;
    onSend(reason.trim());
  };
  return (
    <ModalPortal>
      <div className={dialogLayer('small')}>
        <div className="absolute inset-0 bg-scrim animate-fade-in" onClick={busy ? undefined : onClose} aria-hidden="true" />
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-note`} className={`card relative ${dialogPanel('small')} animate-scale-in overflow-y-auto p-5`}>
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <h2 id={`${id}-title`} className="font-display text-lg font-semibold text-ink">Send {taskKey} back?</h2>
            <p id={`${id}-note`} className="mt-1 text-sm text-ink-2">
              <bdi className="font-medium text-ink">{taskTitle}</bdi> goes back to In progress. Your reason is added as your comment, and the project team is told.
            </p>
            <label htmlFor={`${id}-reason`} className="mt-4 block text-sm font-semibold text-ink">
              Why are you sending it back?
              <span aria-hidden="true" className="ml-0.5 text-danger">*</span>
            </label>
            <textarea
              ref={box}
              id={`${id}-reason`}
              dir="auto"
              rows={4}
              maxLength={SEND_BACK_MAX}
              value={reason}
              aria-required="true"
              onChange={(e) => setReason(e.target.value)}
              aria-invalid={tried && blank ? true : undefined}
              aria-describedby={tried && blank ? `${id}-need` : undefined}
              placeholder="What still needs doing?"
              className="mt-1.5 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            />
            {tried && blank ? (
              <p id={`${id}-need`} className="mt-1 text-xs font-medium text-danger">
                Say why you are sending it back.
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
                {error}
              </p>
            ) : null}
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="secondary" onClick={onClose} disabled={busy} className={TOUCH}>
                Cancel
              </Button>
              <Button type="submit" variant="danger" loading={busy} className={TOUCH}>
                Send back
              </Button>
            </div>
          </form>
        </div>
      </div>
    </ModalPortal>
  );
}
