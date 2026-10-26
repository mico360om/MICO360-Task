import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ConfirmBody, MicoAiProposal, ProposalChange } from '../../api/mico-ai';
import { cardHeading, changeLabel, confirmBody, countdown, initialTicks, remainingNeeds, resultSummary, undoLeft, undoSummary } from '../../lib/mico-ai-proposal';
import { useDateSettings } from '../../lib/useDatePrefs';
import { useSourceTarget } from './AnswerParts';
import { KindBadge, RowEditor, RowSummary, type Shown } from './proposal-rows';

/** What the card can ask the page to do. Each resolves with an error to show, or null once done. */
export interface ProposalActions {
  /** Carry out the ticked changes, with the person's edits (the server checks them again). */
  confirm: (body: ConfirmBody) => Promise<string | null>;
  /** Close the card without changing anything. */
  cancel: () => Promise<string | null>;
  /** Put the confirmed changes back (15 minutes, where nobody changed them since). */
  undo: () => Promise<string | null>;
  /** Tell a screen reader (the page's one live region). */
  announce: (text: string) => void;
  /** Read the card again (while another tab is making its changes). */
  refresh?: () => void;
}

/** The current time, ticking every second while `active` (the Undo countdown). */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

/** A change with the person's edits put in, and the names to show for them. */
function effective(item: ProposalChange, edits: Record<string, unknown> | undefined, shown: Shown | undefined): ProposalChange {
  if (!edits && !shown) return item;
  const e = edits ?? {};
  const s = shown ?? {};
  switch (item.type) {
    case 'create_task':
      return { ...item, fields: { ...item.fields, ...e }, labels: { project: 'project' in s ? (s.project ?? null) : item.labels.project, assignees: s.assignees ?? item.labels.assignees } };
    case 'update_task': {
      const fields = { ...item.fields, ...Object.fromEntries(Object.entries(e).filter(([k]) => k in item.fields)) };
      return { ...item, fields, labels: { ...item.labels, ...(s.column !== undefined ? { column: s.column } : {}), ...(s.assignees ? { assignees: s.assignees } : {}) } };
    }
    case 'draft_minutes':
      return e.content ? { ...item, fields: { content: e.content as typeof item.fields.content } } : item;
    case 'schedule_meeting':
      return { ...item, fields: { ...item.fields, ...e }, labels: { project: 'project' in s ? (s.project ?? null) : item.labels.project, attendees: s.attendees ?? item.labels.attendees } };
  }
}

const CheckIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);

/**
 * What happened to one change: done (with where to see it), being made, refused or failed (with
 * why), or skipped. `gone`: Undo deleted what it made, so there is nothing left to open.
 */
function ResultLine({ result, gone = false }: { result: NonNullable<ProposalChange['result']>; gone?: boolean }) {
  const target = useSourceTarget();
  if (result.status === 'started') return <p className="text-sm text-ink-2">Being made…</p>;
  if (result.status === 'done') {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-xs font-semibold text-success">
          <CheckIcon />
          Done
        </span>
        {result.link && !gone ? (
          <Link to={target(result.link.url)} className="tap font-semibold text-brand underline-offset-2 hover:underline">
            {`Open ${result.link.label}`}
          </Link>
        ) : null}
        {result.message ? <span dir="auto" className="text-ink-2">{result.message}</span> : null}
      </div>
    );
  }
  if (result.status === 'skipped') return <p className="text-sm text-ink-3">Skipped (not ticked).</p>;
  return (
    <p dir="auto" className="rounded-lg bg-danger-soft px-2.5 py-1.5 text-sm text-danger [overflow-wrap:anywhere]">
      {`${result.status === 'refused' ? 'Refused' : 'Failed'}: ${result.message ?? 'This change couldn’t be made.'}`}
    </p>
  );
}

function UndoLine({ undo }: { undo: NonNullable<ProposalChange['undo']> }) {
  if (undo.status === 'started') return <p className="text-sm text-ink-2">Being put back…</p>;
  return undo.status === 'undone' ? (
    <p dir="auto" className="text-sm text-ink-2">{`Undone: ${undo.message ?? 'put back as it was.'}`}</p>
  ) : (
    <p dir="auto" className="rounded-lg bg-warning-soft px-2.5 py-1.5 text-sm text-ink [overflow-wrap:anywhere]">{`Not undone: ${undo.message ?? 'it couldn’t be put back.'}`}</p>
  );
}

const CANCELLED = 'Cancelled — nothing was changed.';

const primary =
  'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg bg-brand px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50 [@media(pointer:coarse)]:!min-h-[44px]';
const secondary =
  'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-line bg-surface px-4 text-sm font-semibold text-ink transition-colors hover:bg-ground disabled:cursor-not-allowed disabled:opacity-50 [@media(pointer:coarse)]:!min-h-[44px]';
const quiet = 'inline-flex min-h-8 items-center rounded-lg px-2.5 text-xs font-semibold text-brand transition-colors hover:bg-brand/5 [@media(pointer:coarse)]:!min-h-[44px]';

/**
 * MICO AI's review card: every change it proposes, each with a tick box (unticked when something
 * needs putting right; none when it can't go ahead) and an Edit that opens the app's own controls
 * in place. Confirm sends the ticked changes with the edits — nothing happens before — then each
 * change shows what happened, and Undo puts them back for 15 minutes.
 */
export function ProposalCard({ proposal, actions }: { proposal: MicoAiProposal; actions?: ProposalActions }) {
  const headingId = useId();
  const { companyTimeZone, timeZone } = useDateSettings();
  const when = { timeZone: companyTimeZone, otherZone: timeZone !== companyTimeZone };
  const [ticks, setTicks] = useState(() => initialTicks(proposal.items));
  const [edits, setEdits] = useState<Record<string, Record<string, unknown>>>({});
  const [shown, setShown] = useState<Record<string, Shown>>({});
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [invite, setInvite] = useState(proposal.sendInvites);
  const [busy, setBusy] = useState<null | 'confirm' | 'cancel' | 'undo'>(null);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  /** What this card asked for, so its outcome can take the focus and be announced once. */
  const acted = useRef<null | 'confirm' | 'undo' | 'cancel'>(null);
  const summaryRef = useRef<HTMLParagraphElement>(null);
  const latest = useRef({ proposal, actions });
  latest.current = { proposal, actions };
  const allRef = useRef<HTMLInputElement>(null);

  const status = proposal.status;
  const proposed = status === 'proposed';
  const items = proposed ? proposal.items.map((i) => effective(i, edits[i.id], shown[i.id])) : proposal.items;
  /** What each change still needs putting right (an edit to the field concerned clears it). */
  const needsOf = (id: string) => {
    const item = proposal.items.find((x) => x.id === id);
    return item ? remainingNeeds(item, edits[id]) : [];
  };
  // Only a change with nothing left to put right can be ticked (Select all and editing included).
  const eligible = items.filter((i) => !i.locked && needsOf(i.id).length === 0);
  const ticked = eligible.filter((i) => ticks[i.id]).length;

  // The card's state moved on (the page has the server's answer): the outcome takes the focus and is announced, once.
  useEffect(() => {
    const { proposal: p, actions: a } = latest.current;
    if (p.status === 'done' && acted.current === 'confirm') {
      acted.current = null;
      summaryRef.current?.focus();
      a?.announce(`Changes made: ${resultSummary(p.items)}.`);
    } else if (p.status === 'undone' && acted.current === 'undo') {
      acted.current = null;
      summaryRef.current?.focus();
      a?.announce(`Undo: ${undoSummary(p.items)}.`);
    } else if (p.status === 'cancelled' && acted.current === 'cancel') {
      acted.current = null;
      summaryRef.current?.focus();
      a?.announce(CANCELLED);
    }
    if (p.status !== 'proposed') {
      busyRef.current = false;
      setBusy(null);
    }
  }, [status]);

  // Another tab is making (or undoing) these changes: look again until it is done.
  useEffect(() => {
    if (status !== 'confirming' && status !== 'undoing') return;
    const t = setInterval(() => latest.current.actions?.refresh?.(), 2000);
    return () => clearInterval(t);
  }, [status]);

  useLayoutEffect(() => {
    if (allRef.current) allRef.current.indeterminate = ticked > 0 && ticked < eligible.length;
  });

  const canUndoNow = status === 'done' && proposal.canUndo && !!proposal.undoUntil;
  const now = useNow(canUndoNow);
  // The countdown follows the server's clock: the device's may be off (taken when this card arrived).
  const receivedAt = useMemo(() => Date.now(), [proposal]);
  const left = undoLeft(proposal.undoUntil, proposal.serverNow, receivedAt, now);

  async function run(kind: 'confirm' | 'cancel' | 'undo', call: (a: ProposalActions) => Promise<string | null>) {
    if (busyRef.current || !actions) return;
    busyRef.current = true;
    setBusy(kind);
    setError(null);
    acted.current = kind;
    const problem = await call(actions);
    busyRef.current = false;
    setBusy(null);
    if (problem) {
      acted.current = null;
      setError(problem);
    }
  }

  const edit = (item: ProposalChange) => (patch: Record<string, unknown>, show?: Shown) => {
    const next = { ...edits[item.id], ...patch };
    setEdits((e) => ({ ...e, [item.id]: { ...e[item.id], ...patch } }));
    if (show) setShown((s) => ({ ...s, [item.id]: { ...s[item.id], ...show } }));
    // Editing a change means it is wanted — once nothing on it is left to put right.
    setTicks((t) => ({ ...t, [item.id]: remainingNeeds(item, next).length === 0 }));
  };
  const toggleOpen = (id: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const confirm = () => run('confirm', (a) => a.confirm(confirmBody(proposal.items, ticks, edits, invite)));
  /** Nothing can be sent while a request is on its way, or where the card can't be acted on. */
  const off = !!busy || !actions;

  return (
    <section aria-labelledby={headingId} data-proposal-card="" className="min-w-0 overflow-hidden rounded-2xl border border-line bg-surface shadow-soft">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-ground/50 px-3.5 py-2.5 sm:px-4">
        <h3 id={headingId} className="font-display text-sm font-semibold text-ink">
          {cardHeading(proposal.items)}
        </h3>
        {proposed && eligible.length > 1 ? (
          <label className="inline-flex min-h-8 cursor-pointer items-center gap-2 text-xs font-semibold text-ink-2 [@media(pointer:coarse)]:!min-h-[44px]">
            <input
              ref={allRef}
              type="checkbox"
              className="h-4 w-4 accent-brand"
              checked={ticked === eligible.length}
              onChange={() => {
                const on = ticked !== eligible.length;
                setTicks((t) => ({ ...t, ...Object.fromEntries(eligible.map((i) => [i.id, on])) }));
              }}
              disabled={!!busy}
            />
            Select all
          </label>
        ) : null}
      </header>

      {proposal.note ? (
        <p role="note" dir="auto" className="mx-3.5 mt-3 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-ink sm:mx-4">
          {proposal.note}
        </p>
      ) : null}

      <ul className="divide-y divide-line">
        {items.map((item) => {
          const label = changeLabel(item);
          const editing = proposed && open.has(item.id) && !item.locked;
          const needs = proposed && !item.locked ? needsOf(item.id) : [];
          return (
            <li key={item.id} className={`px-3.5 py-3 sm:px-4 ${proposed && !item.locked && !ticks[item.id] ? 'bg-ground/30' : ''}`}>
              {/* The group is inside the list item, so the list stays a list for screen readers. */}
              <div role="group" aria-label={label} className="flex items-start gap-3">
                {proposed ? (
                  item.locked ? (
                    <span aria-hidden="true" className="mt-0.5 h-4 w-4 flex-none rounded border border-line bg-ground" />
                  ) : (
                    <label className="-m-1.5 flex flex-none cursor-pointer p-1.5 [@media(pointer:coarse)]:-m-2.5 [@media(pointer:coarse)]:p-2.5">
                      <input
                        type="checkbox"
                        aria-label={label}
                        className="mt-0.5 h-4 w-4 accent-brand disabled:cursor-not-allowed"
                        checked={!!ticks[item.id] && needs.length === 0}
                        onChange={(e) => setTicks((t) => ({ ...t, [item.id]: e.target.checked }))}
                        disabled={!!busy || needs.length > 0}
                      />
                    </label>
                  )
                ) : null}
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <KindBadge item={item} />
                    {proposed && !item.locked ? (
                      <button type="button" aria-label={`Edit ${label}`} aria-expanded={editing} onClick={() => toggleOpen(item.id)} disabled={!!busy} className={quiet}>
                        {editing ? 'Done editing' : 'Edit'}
                      </button>
                    ) : null}
                  </div>
                  <RowSummary item={item} when={when} />
                  {proposed && item.locked ? <p dir="auto" className="text-sm text-danger">{`Can’t do: ${item.problem ?? 'this change can’t be made.'}`}</p> : null}
                  {needs.length ? <p dir="auto" className="text-sm text-danger">{`Put right first: ${needs.map((n) => n.message).join(' ')}`}</p> : null}
                  {proposed && item.warning ? <p dir="auto" className="text-xs text-warning">{item.warning}</p> : null}
                  {editing ? (
                    <div className="rounded-xl border border-line bg-ground/50 p-3">
                      <RowEditor item={item} onEdit={edit(proposal.items.find((x) => x.id === item.id)!)} />
                    </div>
                  ) : null}
                  {!proposed && item.result ? <ResultLine result={item.result} gone={!!item.undo?.gone} /> : null}
                  {item.undo ? <UndoLine undo={item.undo} /> : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <footer className="space-y-2.5 border-t border-line px-3.5 py-3 sm:px-4">
        {proposed ? (
          <>
            {proposal.hasMeetings ? (
              <label className="inline-flex min-h-8 cursor-pointer items-center gap-2 text-sm text-ink [@media(pointer:coarse)]:!min-h-[44px]">
                <input type="checkbox" className="h-4 w-4 accent-brand" checked={invite} onChange={(e) => setInvite(e.target.checked)} disabled={!!busy} />
                Email the invitations
              </label>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={primary}
                onClick={() => void confirm()}
                disabled={off || ticked === 0}
                aria-label={busy === 'confirm' ? undefined : `Confirm ${ticked} ${ticked === 1 ? 'change' : 'changes'}`}
              >
                {busy === 'confirm' ? 'Making the changes…' : `Confirm (${ticked})`}
              </button>
              <button type="button" className={secondary} onClick={() => void run('cancel', (a) => a.cancel())} disabled={off}>
                Cancel
              </button>
              <p className="text-xs text-ink-3">Nothing changes until you confirm. You can undo for 15 minutes.</p>
            </div>
          </>
        ) : status === 'confirming' ? (
          <p className="text-sm text-ink-2">Making these changes…</p>
        ) : status === 'undoing' ? (
          <p className="text-sm text-ink-2">Putting these changes back…</p>
        ) : status === 'cancelled' || status === 'superseded' ? (
          <p ref={summaryRef} tabIndex={-1} className="rounded text-sm text-ink-2 outline-none focus-visible:ring-2 focus-visible:ring-brand/40">
            {status === 'cancelled' ? CANCELLED : 'Replaced by a newer answer — nothing was changed.'}
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <p ref={summaryRef} tabIndex={-1} className="rounded text-sm font-semibold text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand/40">
              {status === 'undone' ? undoSummary(proposal.items) : resultSummary(proposal.items)}
            </p>
            {status === 'done' && canUndoNow && left > 0 ? (
              <button type="button" className={secondary} onClick={() => void run('undo', (a) => a.undo())} disabled={off} aria-label="Undo these changes (open for 15 minutes)">
                {busy === 'undo' ? 'Undoing…' : `Undo (${countdown(left)})`}
              </button>
            ) : status === 'done' && proposal.undoUntil && proposal.items.some((i) => i.result?.status === 'done') ? (
              <p className="text-xs text-ink-3">Undo is no longer available.</p>
            ) : null}
          </div>
        )}
        {error ? (
          <p role="alert" dir="auto" className="rounded-lg border border-danger/25 bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
      </footer>
    </section>
  );
}
