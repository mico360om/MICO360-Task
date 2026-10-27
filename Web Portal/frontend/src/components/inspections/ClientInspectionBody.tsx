import type { ClientInspection, ClientInspectionSummary } from '../../api/inspections';
import { highlightNames } from '../../lib/name-highlight';

/** Text with the names of the project's people marked (only the staff preview passes names). */
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

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-10-27" → "27 Oct 2026" (the day as given, never shifted by the device's zone). */
function dayKeyText(key: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(key);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : '';
}

/** "Revision 2 · reopened on 27 Oct 2026" for a report reopened and signed again; null for a first signing. */
export function revisionLine(x: Pick<ClientInspectionSummary, 'revisionNumber' | 'reopenedOn'>): string | null {
  if (!x.revisionNumber || x.revisionNumber < 2) return null;
  return `Revision ${x.revisionNumber}${x.reopenedOn ? ` · reopened on ${dayKeyText(x.reopenedOn)}` : ''}`;
}

/**
 * A finished inspection's client copy, as the client's page shows it and as the staff preview shows it
 * before ticking "Show to client": the result, the failed items, every section's items, the
 * signatures with the signers' names (and "Not signed" for one asked for but not given). Names of
 * the project's people are highlighted in the notes when `names` are given (the staff preview).
 * No staff API here: the client's page uses it too.
 */
export function ClientInspectionBody({ inspection: x, names = [], showRevision = true }: { inspection: ClientInspection; names?: string[]; /** False where the heading above already says it. */ showRevision?: boolean }) {
  const failed = x.sections.flatMap((s) => s.items.filter((i) => i.result === 'Fail').map((i) => ({ ...i, section: s.title })));
  const revision = showRevision ? revisionLine(x) : null;
  return (
    <div className="flex flex-col gap-3">
      {revision ? <p className="text-xs font-semibold text-ink-2">{revision}</p> : null}
      <p className="text-sm text-ink">
        <span className={`font-semibold ${x.counts.failed ? 'text-danger' : 'text-success'}`}>{x.result}</span>
        {/* The result already says how many failed: the rest of the count, without saying it twice. */}
        <span className="text-ink-2"> · {x.counts.total} {x.counts.total === 1 ? 'item' : 'items'}: {x.counts.passed} passed{x.counts.failed ? '' : `, ${x.counts.failed} failed`}, {x.counts.na} N/A</span>
      </p>
      {failed.length ? (
        <div>
          <h4 className="text-sm font-semibold text-ink">Failed items</h4>
          <ul className="mt-1 list-disc space-y-0.5 ps-5 text-sm text-ink">
            {failed.map((i, k) => (
              <li key={k} dir="auto">
                {i.label}
                {i.reading ? ` — ${i.reading}${i.limits ? ` (allowed ${i.limits})` : ''}` : ''}
                {i.note ? (
                  <>
                    {' — '}
                    <Marked text={i.note} names={names} />
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {x.sections.map((s, si) => (
        <div key={si}>
          <h4 dir="auto" className="text-sm font-semibold text-ink">{s.title}</h4>
          <ul className="mt-1 divide-y divide-line rounded-lg border border-line">
            {s.items.map((i, ii) => (
              <li key={ii} className="flex items-start justify-between gap-3 px-3 py-1.5 text-sm">
                <span className="min-w-0">
                  <span dir="auto" className="block break-words text-ink">{i.label}</span>
                  {i.reading || i.limits ? <span className="block text-xs text-ink-2">{[i.reading, i.limits ? `allowed ${i.limits}` : null].filter(Boolean).join(' · ')}</span> : null}
                  {i.note ? (
                    <span dir="auto" className="block whitespace-pre-line text-xs text-ink-2">
                      <Marked text={i.note} names={names} />
                    </span>
                  ) : null}
                </span>
                <span className={`flex-none text-xs font-bold uppercase ${i.result === 'Fail' ? 'text-danger' : i.result === 'Pass' ? 'text-success' : 'text-ink-2'}`}>
                  {i.result === 'Fail' ? '✕ Fail' : i.result === 'Pass' ? '✓ Pass' : i.result ?? '—'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div>
        <h4 className="text-sm font-semibold text-ink">Signatures</h4>
        <ul className="mt-1 grid gap-2 sm:grid-cols-2">
          {x.signatures.map((s, k) => (
            <li key={k} className="rounded-lg border border-line p-2">
              <div className="grid h-16 place-items-center rounded-md bg-white">
                {s.image ? <img src={s.image} alt={`${s.role} signature of ${s.name}`} className="max-h-14 max-w-full object-contain" /> : <span aria-hidden="true" className="font-serif text-lg italic text-[#1C1A17]" dir="auto">{s.name}</span>}
              </div>
              <p className="mt-1 text-xs text-ink">
                <span className="font-semibold">{s.role}:</span> <span dir="auto">{s.name}</span>
              </p>
              <p className="text-xs text-ink-2">Signed {s.signedOn || when(s.signedAt)}{s.typed ? ' · typed name' : ''}</p>
            </li>
          ))}
          {x.unsigned.map((role) => (
            <li key={role} className="rounded-lg border border-dashed border-line p-2 text-xs text-ink-2">
              <span className="font-semibold">{role}:</span> Not signed
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Whether any note of the report names one of these people (the preview says so only then). */
export function notesNameSomeone(x: ClientInspection, names: string[]): boolean {
  return x.sections.some((s) => s.items.some((i) => !!i.note && highlightNames(i.note, names).some((p) => p.name)));
}
