import type { DraftView } from '../../lib/inspection-outbox';
import type { SyncState } from '../../lib/inspection-sync';
import { InspectIcon } from './inspection-ui';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function waitingWords(p: DraftView['pending']): string {
  return [p.answers ? plural(p.answers, 'answer') : '', p.followUps ? plural(p.followUps, 'follow-up task request') : '', p.finish ? 'the signatures' : ''].filter(Boolean).join(', ');
}

/**
 * Where this inspection's changes are: on this phone and waiting for a signal, being sent, all sent,
 * or — the phone's storage being full — only in this page. A refusal the server won't change its mind
 * about is said in plain words, with what can be done.
 */
export function SyncBanner({
  view,
  sync,
  online,
  onRetry,
  onDiscard,
  onLookAgain,
}: {
  view: DraftView | null;
  sync: SyncState;
  online: boolean;
  onRetry: () => void;
  onDiscard: () => void;
  onLookAgain: () => void;
}) {
  if (!view) return null;
  const { pending, problem } = view;
  const waiting = pending.answers > 0 || pending.followUps > 0 || pending.finish;

  if (problem) {
    const gone = problem.code === 'INSPECTION_GONE' || problem.code === 'NOT_FOUND';
    const signAgain = problem.stage === 'finish';
    return (
      <div role="alert" className="flex flex-col gap-2 rounded-xl border border-danger/30 bg-danger-soft px-3 py-2.5 text-sm text-danger sm:flex-row sm:items-start sm:justify-between">
        <p className="flex items-start gap-2">
          <span className="mt-0.5 flex-none">{InspectIcon.alert}</span>
          <span>
            {problem.message}
            {waiting && !signAgain ? <span className="block text-xs text-danger/80">Still on this phone: {waitingWords(pending)}.</span> : null}
          </span>
        </p>
        <div className="flex flex-none flex-wrap gap-2">
          {signAgain ? (
            <button type="button" onClick={onLookAgain} className="min-h-9 rounded-lg bg-surface px-3 text-xs font-semibold text-ink hover:bg-ground">
              Look again
            </button>
          ) : (
            <>
              {!gone ? (
                <button type="button" onClick={onRetry} className="min-h-9 rounded-lg bg-surface px-3 text-xs font-semibold text-ink hover:bg-ground">
                  Try again
                </button>
              ) : null}
              <button type="button" onClick={onDiscard} className="min-h-9 rounded-lg bg-danger px-3 text-xs font-semibold text-white hover:brightness-95">
                Throw away what’s on this phone
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  let tone = 'border-line bg-surface text-ink-2';
  let icon = InspectIcon.cloud;
  let text: string;
  let action: { label: string; run: () => void } | null = null;
  if (!view.persisted) {
    tone = 'border-warning/40 bg-warning-soft text-warning';
    icon = InspectIcon.alert;
    text = 'This phone’s storage is full, so your changes are only in this page. Keep it open until they’re sent.';
  } else if (!waiting) {
    text = view.sentAt ? 'All changes sent.' : 'Saved.';
  } else if (sync === 'sending') {
    text = `Sending ${waitingWords(pending)}…`;
  } else if (sync === 'signed-out') {
    tone = 'border-warning/40 bg-warning-soft text-warning';
    icon = InspectIcon.phone;
    text = `Saved on this phone: ${waitingWords(pending)}. Sign in again to send them.`;
  } else if (sync === 'retry') {
    icon = InspectIcon.phone;
    text = `Saved on this phone: ${waitingWords(pending)}. The server didn’t answer; trying again shortly.`;
    action = { label: 'Try now', run: onRetry };
  } else if (!online || sync === 'offline') {
    tone = 'border-info/30 bg-info-soft text-info';
    icon = InspectIcon.phone;
    text = `Saved on this phone, will send when online: ${waitingWords(pending)}.`;
  } else {
    icon = InspectIcon.phone;
    text = `Saved on this phone: ${waitingWords(pending)}. Sending soon.`;
  }

  return (
    <div role="status" aria-live="polite" data-sync={!view.persisted ? 'memory' : waiting ? (online && sync !== 'offline' ? sync : 'offline') : 'sent'} className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm ${tone}`}>
      <p className="flex items-start gap-2">
        <span className="mt-0.5 flex-none">{icon}</span>
        <span>{text}</span>
      </p>
      {action ? (
        <button type="button" onClick={action.run} className="min-h-9 flex-none rounded-lg px-2.5 text-xs font-semibold underline">
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
