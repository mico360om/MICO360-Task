import { useDialog } from '../../hooks/useDialog';
import { useInstallApp } from '../../lib/install-app';
import { Button } from '../ui/Button';
import { ModalPortal } from '../ui/ModalPortal';
import { dialogLayer, dialogPanel } from '../ui/dialog-size';
import { TOUCH_TALL } from '../../lib/touch';

const ICON = 'inline-block h-5 w-5 flex-none align-[-4px] text-brand';

/** Safari's Share button: a square with an arrow up. */
function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" className={ICON} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v12M8 7l4-4 4 4" />
      <path d="M8 10H6.5A1.5 1.5 0 0 0 5 11.5v8A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-8a1.5 1.5 0 0 0-1.5-1.5H16" />
    </svg>
  );
}

/** "Add to Home Screen": a rounded square with a plus. */
function AddIcon() {
  return (
    <svg viewBox="0 0 24 24" className={ICON} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  );
}

const STEP_NUMBER = 'grid h-7 w-7 flex-none place-items-center rounded-full bg-brand/10 text-sm font-bold text-brand';

/**
 * iPhone and iPad (Safari has no install button of its own to call): the three steps to add MICO360
 * Tasks to the Home Screen. One for the page (AppShell renders it); the Dashboard card and the account
 * menu's Install App open it. The installed app keeps its own sign-in, apart from Safari: it asks once.
 */
export function AddToHomeScreenGuide() {
  const { guideOpen, closeGuide } = useInstallApp();
  if (!guideOpen) return null;
  return <Guide onClose={closeGuide} />;
}

function Guide({ onClose }: { onClose: () => void }) {
  const dialogRef = useDialog(onClose);
  return (
    <ModalPortal>
      <div className={dialogLayer('small')}>
        <div className="absolute inset-0 bg-scrim animate-fade-in" onClick={onClose} aria-hidden="true" />
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="a2hs-title" className={`card relative ${dialogPanel('small')} animate-scale-in overflow-y-auto p-5`}>
          <h2 id="a2hs-title" className="font-display text-lg font-semibold text-ink">
            Add MICO360 Tasks to your Home Screen
          </h2>
          <ol className="mt-4 grid gap-3 text-sm text-ink">
            <li className="flex items-start gap-3">
              <span className={STEP_NUMBER} aria-hidden="true">1</span>
              <span className="pt-1">
                Tap <strong>Share</strong> <ShareIcon /> in Safari’s toolbar. Don’t see it? Tap <strong>•••</strong> first.
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className={STEP_NUMBER} aria-hidden="true">2</span>
              <span className="pt-1">
                Scroll down and tap <strong>Add to Home Screen</strong> <AddIcon />.
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className={STEP_NUMBER} aria-hidden="true">3</span>
              <span className="pt-1">
                Tap <strong>Add</strong>. MICO360 Tasks is now on your Home Screen.
              </span>
            </li>
          </ol>
          <p className="mt-4 rounded-lg bg-ground px-3 py-2 text-sm text-ink-2">The app asks you to sign in once — it keeps its own sign-in, apart from Safari.</p>
          <div className="mt-5 flex justify-end">
            <Button onClick={onClose} className={`w-full sm:w-auto ${TOUCH_TALL}`}>
              Done
            </Button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
