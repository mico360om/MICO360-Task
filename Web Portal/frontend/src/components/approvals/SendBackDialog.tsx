import { useId, useRef, useState } from 'react';
import { useDialog } from '../../hooks/useDialog';
import { ModalPortal } from '../ui/ModalPortal';
import { Button } from '../ui/Button';

/** The longest reason the server keeps (it becomes a comment). */
export const REASON_MAX = 2000;

export interface SendBackDialogProps {
  /** The task, named in the title ("Send RIG-4 back?"). */
  taskKey: string;
  taskTitle: string;
  busy?: boolean;
  /** Why it couldn't be sent back (the dialog stays open, the reason kept). */
  error?: string | null;
  onSend: (reason: string) => void;
  onClose: () => void;
}

/**
 * Sending a waiting task back asks why (required): the reason becomes the approver's comment on the
 * task and goes to the people on it, and the task returns to In progress. Focus starts in the box;
 * Escape and Cancel keep things as they are; Ctrl+Enter (⌘+Enter) sends.
 */
export function SendBackDialog({ taskKey, taskTitle, busy = false, error, onSend, onClose }: SendBackDialogProps) {
  const dialogRef = useDialog(busy ? () => {} : onClose);
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const id = useId();
  const box = useRef<HTMLTextAreaElement>(null);
  const blank = reason.trim().length === 0;
  const send = () => {
    setTried(true);
    // Nothing written yet: back to the box (it says why), so the reason can be typed at once.
    if (blank) box.current?.focus();
    if (blank || busy) return;
    onSend(reason.trim());
  };
  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[60] grid place-items-center p-4">
        <div className="absolute inset-0 bg-ink/40 animate-fade-in" onClick={busy ? undefined : onClose} aria-hidden="true" />
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-note`} className="card relative w-full max-w-md animate-scale-in p-5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <h2 id={`${id}-title`} className="font-display text-lg font-semibold text-ink">
            Send {taskKey} back?
          </h2>
          <p id={`${id}-note`} className="mt-1 text-sm text-ink-2">
            <bdi className="font-medium text-ink">{taskTitle}</bdi> goes back to In progress. Your reason is added as a comment and sent to the people on it.
          </p>
          <label htmlFor={`${id}-reason`} className="mt-4 block text-sm font-semibold text-ink">
            Why are you sending it back?
          </label>
          <textarea
            ref={box}
            id={`${id}-reason`}
            dir="auto"
            rows={4}
            maxLength={REASON_MAX}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                send();
              }
            }}
            aria-invalid={tried && blank ? true : undefined}
            aria-describedby={tried && blank ? `${id}-need` : undefined}
            placeholder="For example: the pressure readings are missing."
            className="mt-1.5 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
          />
          {tried && blank ? (
            <p id={`${id}-need`} className="mt-1 text-xs font-medium text-danger">
              Write a reason first.
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </p>
          ) : null}
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy} shortcut="cancel" className="[@media(pointer:coarse)]:!min-h-11">
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={busy} className="[@media(pointer:coarse)]:!min-h-11">
              Send back
            </Button>
          </div>
        </form>
        </div>
      </div>
    </ModalPortal>
  );
}
