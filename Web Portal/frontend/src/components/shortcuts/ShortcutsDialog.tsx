import { useDialog } from '../../hooks/useDialog';
import { ModalPortal } from '../ui/ModalPortal';
import { SHORTCUTS, shortcutKeys, type Platform, type ShortcutGroup } from '../../lib/shortcuts';

const GROUPS: ShortcutGroup[] = ['Anywhere', 'Forms and dialogs', 'On a page'];

/**
 * The list of keyboard shortcuts (Ctrl+/ or ?), grouped by where they work, with the keys as this
 * keyboard has them, and the switch for single-key shortcuts.
 */
export function ShortcutsDialog({
  platform,
  singleKeys,
  onSingleKeys,
  onClose,
}: {
  platform: Platform;
  singleKeys: boolean;
  onSingleKeys: (on: boolean) => void;
  onClose: () => void;
}) {
  const dialogRef = useDialog<HTMLDivElement>(onClose, { initialFocus: 'container' });
  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[60] grid place-items-center p-4">
        <div className="absolute inset-0 bg-ink/40 animate-fade-in" onClick={onClose} aria-hidden="true" />
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="shortcuts-title"
          tabIndex={-1}
          className="card relative flex max-h-[calc(var(--visible-height,100vh)-2rem)] w-full max-w-lg animate-scale-in flex-col overflow-hidden outline-none"
        >
          <div className="flex items-center gap-3 border-b border-line px-5 py-4">
            <h2 id="shortcuts-title" className="flex-1 font-display text-lg font-semibold text-ink">
              Keyboard shortcuts
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="grid h-9 w-9 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-ground hover:text-ink"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {GROUPS.map((group) => (
              <section key={group} aria-labelledby={`shortcuts-${group}`} className="mb-4 last:mb-0">
                <h3 id={`shortcuts-${group}`} className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3">
                  {group}
                  {group === 'On a page' && !singleKeys ? <span className="ms-2 normal-case tracking-normal text-ink-3">(switched off)</span> : null}
                </h3>
                <ul className="divide-y divide-line">
                  {SHORTCUTS.filter((s) => s.group === group).map((s) => (
                    <li key={s.action} className={`flex items-center gap-3 py-2 ${s.single && !singleKeys ? 'opacity-50' : ''}`}>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-ink">{s.label}</p>
                        <p className="text-xs text-ink-2">{s.description}</p>
                      </div>
                      <div className="flex flex-none flex-wrap items-center justify-end gap-1.5 text-xs text-ink-3">
                        {shortcutKeys(s.action, platform).map((combo, i) => (
                          <span key={combo.join('+')} className="inline-flex items-center gap-1">
                            {i > 0 ? <span>or</span> : null}
                            {combo.map((k) => (
                              <kbd key={k} className="min-w-[1.75rem] rounded-md border border-line bg-ground px-1.5 py-0.5 text-center font-sans text-xs font-semibold text-ink">
                                {k}
                              </kbd>
                            ))}
                          </span>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          <div className="flex items-start gap-3 border-t border-line bg-ground/60 px-5 py-3">
            <button
              type="button"
              role="switch"
              aria-checked={singleKeys}
              aria-describedby="shortcuts-single-help"
              onClick={() => onSingleKeys(!singleKeys)}
              className={`relative mt-0.5 h-6 w-11 flex-none rounded-full transition-colors ${singleKeys ? 'bg-brand' : 'bg-line'}`}
            >
              <span className="sr-only">Single-key shortcuts</span>
              <span aria-hidden="true" className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${singleKeys ? 'start-[1.375rem]' : 'start-0.5'}`} />
            </button>
            <div className="min-w-0 text-xs text-ink-2">
              <p className="font-semibold text-ink">Single-key shortcuts</p>
              <p id="shortcuts-single-help">
                N, E, Delete, R, / and ? work when you’re not typing in a box. Switch them off if they get in your way (for
                example with a screen reader).
              </p>
            </div>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
