import type { DraftView } from '../../lib/inspection-outbox';
import { useEffect, useRef, useState } from 'react';
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
  onDismiss,
}: {
  view: DraftView | null;
  sync: SyncState;
  online: boolean;
  onRetry: () => void;
  onDiscard: () => void;
  onLookAgain: () => void;
  /** The person read a note (a refused follow-up request): clear it. */
  onDismiss: () => void;
}) {
  if (!view) return null;
  const { pending, problem } = view;
  const waiting = pending.answers > 0 || pending.followUps > 0 || pending.finish;

  // A refused finish or follow-up request: a note to read. It holds nothing else back.
  const note =
    problem && problem.stage !== 'answers' ? (
      <div role="alert" className="mb-2 flex flex-col gap-2 rounded-xl border border-warning/40 bg-warning-soft px-3 py-2.5 text-sm text-warning sm:flex-row sm:items-start sm:justify-between">
        <p className="flex items-start gap-2">
          <span className="mt-0.5 flex-none">{InspectIcon.alert}</span>
          <span>{problem.message}</span>
        </p>
        <button type="button" onClick={problem.stage === 'finish' ? onLookAgain : onDismiss} className="min-h-9 flex-none rounded-lg bg-surface px-3 text-xs font-semibold text-ink hover:bg-ground">
          {problem.stage === 'finish' ? 'Look again' : 'OK'}
        </button>
      </div>
    ) : null;

  if (problem && problem.stage === 'answers') {
    const gone = problem.code === 'INSPECTION_GONE' || problem.code === 'NOT_FOUND';
    return (
      <div role="alert" className="flex flex-col gap-2 rounded-xl border border-danger/30 bg-danger-soft px-3 py-2.5 text-sm text-danger sm:flex-row sm:items-start sm:justify-between">
        <p className="flex items-start gap-2">
          <span className="mt-0.5 flex-none">{InspectIcon.alert}</span>
          <span>
            {problem.message}
            {waiting ? <span className="block text-xs text-danger/80">Still on this phone: {waitingWords(pending)}.</span> : null}
          </span>
        </p>
        <div className="flex flex-none flex-wrap gap-2">
          {!gone ? (
            <button type="button" onClick={onRetry} className="min-h-9 rounded-lg bg-surface px-3 text-xs font-semibold text-ink hover:bg-ground">
              Try again
            </button>
          ) : null}
          <button type="button" onClick={onDiscard} className="min-h-9 rounded-lg bg-danger px-3 text-xs font-semibold text-white hover:brightness-95">
            Throw away what’s on this phone
          </button>
        </div>
      </div>
    );
  }

  let tone = 'border-line bg-surface text-ink-2';
  let icon = InspectIcon.cloud;
  let text: string;
  let action: { label: string; run: () => void } | null = null;
  const state = syncWord(view, sync, online);
  if (state === 'memory') {
    tone = 'border-warning/40 bg-warning-soft text-warning';
    icon = InspectIcon.alert;
    text = 'This phone’s storage is full, so your changes are only in this page. Keep it open until they’re sent.';
  } else if (state === 'sent') {
    text = view.sentAt ? 'All changes sent.' : 'Saved.';
  } else if (state === 'sending') {
    text = `Sending ${waitingWords(pending)}…`;
  } else if (state === 'signed-out') {
    tone = 'border-warning/40 bg-warning-soft text-warning';
    icon = InspectIcon.phone;
    text = `Saved on this phone: ${waitingWords(pending)}. Sign in again to send them.`;
  } else if (state === 'unreachable') {
    tone = 'border-info/30 bg-info-soft text-info';
    icon = InspectIcon.phone;
    text = `Can’t reach the server, will keep trying. Saved on this phone: ${waitingWords(pending)}.`;
    action = { label: 'Try now', run: onRetry };
  } else if (state === 'retry') {
    tone = 'border-info/30 bg-info-soft text-info';
    icon = InspectIcon.phone;
    text = `The server had a problem, will keep trying. Saved on this phone: ${waitingWords(pending)}.`;
    action = { label: 'Try now', run: onRetry };
  } else if (state === 'offline') {
    tone = 'border-info/30 bg-info-soft text-info';
    icon = InspectIcon.phone;
    text = `Saved on this phone, will send when online: ${waitingWords(pending)}.`;
  } else {
    icon = InspectIcon.phone;
    text = `Saved on this phone: ${waitingWords(pending)}. Sending soon.`;
  }

  return (
    <>
      {note}
      <div data-testid="sync-state" data-sync={state} className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm ${tone}`}>
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
    </>
  );
}

export type SyncWord = 'memory' | 'sent' | 'sending' | 'signed-out' | 'unreachable' | 'retry' | 'offline' | 'soon';

/** Where the changes are, in one word (what the banner shows, and what a screen reader is told when it changes). */
export function syncWord(view: DraftView, sync: SyncState, online: boolean): SyncWord {
  const waiting = view.pending.answers > 0 || view.pending.followUps > 0 || view.pending.finish;
  if (!view.persisted) return 'memory';
  if (!waiting) return 'sent';
  if (sync === 'sending') return 'sending';
  if (sync === 'signed-out') return 'signed-out';
  // A failure the page saw just now, or the one the device remembers (after a reload).
  const failure = sync === 'offline' || sync === 'unreachable' || sync === 'retry' ? sync : view.lastFailure;
  if (!online || failure === 'offline') return 'offline';
  if (failure === 'unreachable') return 'unreachable';
  if (failure === 'retry') return 'retry';
  return 'soon';
}

const ANNOUNCE: Partial<Record<SyncWord, string>> = {
  offline: 'No signal. Changes are saved on this phone and sent when you’re back online.',
  unreachable: 'Can’t reach the server. Changes are saved on this phone; it keeps trying.',
  retry: 'The server had a problem. Changes are saved on this phone; it keeps trying.',
  memory: 'This phone’s storage is full: changes are only in this page.',
  'signed-out': 'Signed out. Changes are saved on this phone; sign in again to send them.',
};
const AWAY = new Set<SyncWord>(['offline', 'unreachable', 'retry', 'signed-out', 'memory']);

/**
 * What a screen reader hears: only when it matters — the changes can't be sent (and why), or they
 * all went once that was over. Not every "Sending…" after every tap.
 */
export function SyncAnnouncer({ view, sync, online }: { view: DraftView | null; sync: SyncState; online: boolean }) {
  const word = view ? syncWord(view, sync, online) : null;
  const last = useRef<SyncWord | null>(null);
  const [said, setSaid] = useState('');
  useEffect(() => {
    if (!word || word === 'sending' || word === 'soon' || word === last.current) return;
    const before = last.current;
    last.current = word;
    if (AWAY.has(word)) setSaid(ANNOUNCE[word]!);
    else if (word === 'sent' && before && AWAY.has(before)) setSaid('Back online: all changes sent.');
  }, [word]);
  return (
    <p role="status" aria-live="polite" className="sr-only">
      {said}
    </p>
  );
}
