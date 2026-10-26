import { useId, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { clientSharesApi } from '../../api/client-shares';
import { highlightNames } from '../../lib/name-highlight';
import { useDialog } from '../../hooks/useDialog';
import { ModalPortal } from '../ui/ModalPortal';
import { Button } from '../ui/Button';

/** Text with the names of the project's people and the meeting's attendees marked. */
function Marked({ text, names }: { text: string; names: string[] }) {
  return (
    <>
      {highlightNames(text, names).map((p, i) =>
        p.name ? (
          <mark key={i} className="rounded bg-warning-soft px-0.5 font-semibold text-ink">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <div className="mt-1">{children}</div>
    </div>
  );
}

/**
 * Before approved minutes go on the project's client page: exactly what the client will see (the
 * PDF has the same), with every name of a project member or attendee highlighted. The owners are
 * already off the next steps; "Risks & open issues" are left out unless ticked here.
 */
export function MinutesClientDialog({
  meetingId,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  meetingId: string;
  busy: boolean;
  error: string | null;
  onConfirm: (includeRisks: boolean) => void;
  onClose: () => void;
}) {
  const ids = { title: useId(), intro: useId(), risks: useId() };
  const dialogRef = useDialog(busy ? () => {} : onClose);
  const q = useQuery({ queryKey: ['meeting', meetingId, 'client-preview'], queryFn: () => clientSharesApi(apiClient).minutesPreview(meetingId), staleTime: 0 });
  const [includeRisks, setIncludeRisks] = useState(false);
  const p = q.data;
  const c = p?.content;
  const names = p?.names ?? [];
  const list = (items: string[]) => (
    <ul className="list-disc space-y-0.5 ps-5 text-sm text-ink">
      {items.map((t, i) => (
        <li key={i} dir="auto">
          <Marked text={t} names={names} />
        </li>
      ))}
    </ul>
  );

  return (
    <ModalPortal>
      <div className="above-keyboard fixed inset-0 z-50 grid place-items-center p-4">
        <div className="absolute inset-0 bg-ink/40 animate-fade-in" onClick={busy ? undefined : onClose} aria-hidden="true" />
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={ids.title}
          aria-describedby={ids.intro}
          className="keyboard-flow-cramped card relative flex max-h-[calc(var(--visible-height,100vh)-2rem)] w-full max-w-xl animate-scale-in flex-col overflow-hidden"
        >
          <div className="border-b border-line px-5 pb-3 pt-4">
            <h2 id={ids.title} className="font-display text-lg font-semibold text-ink">Show these minutes to the client?</h2>
            <p id={ids.intro} className="mt-1 text-sm leading-relaxed text-ink-2">
              This is exactly what the client will see on their page. The PDF the client can download has the same. Owners are left off the next steps.
            </p>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
            {q.isLoading ? <p className="text-sm text-ink-2">Loading…</p> : null}
            {q.isError ? <p role="alert" className="text-sm text-danger">Couldn’t load the minutes. Close this and try again.</p> : null}
            {c ? (
              <>
                {names.length ? (
                  <p className="rounded-lg bg-ground px-3 py-2 text-xs leading-relaxed text-ink-2">
                    <span className="rounded bg-warning-soft px-0.5 font-semibold text-ink">Highlighted</span>: names of people on the project or at the meeting. If the client
                    shouldn’t see them, cancel, reopen the minutes and edit them.
                  </p>
                ) : null}
                <div className="flex flex-col gap-3 rounded-xl border border-line p-4">
                  {c.summary ? (
                    <p dir="auto" className="whitespace-pre-line text-sm text-ink">
                      <Marked text={c.summary} names={names} />
                    </p>
                  ) : null}
                  {c.discussion.length ? (
                    <Part title="Discussion">
                      <dl className="space-y-2">
                        {c.discussion.map((d, i) => (
                          <div key={i}>
                            <dt dir="auto" className="text-sm font-medium text-ink"><Marked text={d.topic} names={names} /></dt>
                            <dd dir="auto" className="whitespace-pre-line text-sm text-ink-2"><Marked text={d.text} names={names} /></dd>
                          </div>
                        ))}
                      </dl>
                    </Part>
                  ) : null}
                  {c.decisions.length ? <Part title="Decisions">{list(c.decisions)}</Part> : null}
                  {includeRisks && c.risks.length ? <Part title="Risks & open issues">{list(c.risks)}</Part> : null}
                  {c.nextSteps.length ? <Part title="Next steps">{list(c.nextSteps)}</Part> : null}
                </div>
                {c.risks.length ? (
                  <div className="flex items-start gap-2 text-sm text-ink">
                    <input
                      id={ids.risks}
                      type="checkbox"
                      aria-describedby={`${ids.risks}-hint`}
                      className="mt-0.5 h-4 w-4 accent-[rgb(var(--c-brand))]"
                      checked={includeRisks}
                      onChange={(e) => setIncludeRisks(e.target.checked)}
                    />
                    <div>
                      <label htmlFor={ids.risks}>Include risks and open issues</label>
                      <p id={`${ids.risks}-hint`} className="text-xs text-ink-2">Left out unless ticked: they are often internal.</p>
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}
            {error ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p> : null}
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-line px-5 py-3 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button onClick={() => onConfirm(includeRisks)} loading={busy} disabled={!c}>Show to client</Button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
