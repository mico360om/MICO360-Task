import type { ReaderChipKey, Understood as UnderstoodRead } from '../../lib/search-everything';

const chipClass = 'inline-flex items-center gap-1 rounded-full border border-brand/30 bg-brand/10 py-0.5 pe-1 ps-2.5 text-xs font-medium text-brand [@media(pointer:coarse)]:min-h-11';
const linkClass = 'inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium text-brand underline-offset-2 hover:underline focus-visible:underline [@media(pointer:coarse)]:!min-h-11';

/**
 * 1.23.6 "Understood as:" — what the built-in reader read in the words (a chip per filter, each
 * removable), the words left to search, and "Search the words instead" (every word as typed, no chips).
 * Searching the words as typed, it offers to read them again. Chips taken off can be brought back.
 */
export function Understood({
  understood,
  plain,
  onRemove,
  onPlain,
  onRead,
  onRestore,
}: {
  understood: UnderstoodRead | null | undefined;
  /** The words are searched as typed ("Search the words instead"). */
  plain: boolean;
  onRemove: (key: ReaderChipKey) => void;
  onPlain: () => void;
  onRead: () => void;
  onRestore: () => void;
}) {
  if (plain) {
    return (
      <p className="flex flex-wrap items-center gap-x-1 gap-y-1 text-xs text-ink-2" data-understood="plain">
        Searching every word as typed.
        <button type="button" onClick={onRead} className={linkClass}>
          Read them as filters
        </button>
      </p>
    );
  }
  if (!understood || (understood.chips.length === 0 && understood.removed.length === 0)) return null;
  const hidden = understood.removed.length;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-2" data-understood="chips">
      {understood.chips.length ? (
        <>
          <span id="understood-label" className="font-medium text-ink-2">
            Understood as:
          </span>
          <ul aria-labelledby="understood-label" className="flex flex-wrap items-center gap-1.5">
            {understood.chips.map((c) => (
              <li key={c.key} className={chipClass} title={`Read from “${c.text}”`}>
                <span dir="auto">{c.label}</span>
                <button type="button" aria-label={`Remove the filter ${c.label}`} onClick={() => onRemove(c.key)} className="grid h-5 w-5 place-items-center rounded-full text-brand hover:bg-brand/15 focus-visible:bg-brand/15 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11">
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                    <path d="M6 6l12 12M18 6 6 18" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
          {understood.words ? (
            <span>
              and the words “<span dir="auto" className="font-medium text-ink">{understood.words}</span>”
            </span>
          ) : null}
        </>
      ) : null}
      <button type="button" onClick={onPlain} className={linkClass}>
        Search the words instead
      </button>
      {hidden ? (
        <button type="button" onClick={onRestore} className={linkClass}>
          {hidden === 1 ? 'Bring back 1 removed filter' : `Bring back ${hidden} removed filters`}
        </button>
      ) : null}
    </div>
  );
}
