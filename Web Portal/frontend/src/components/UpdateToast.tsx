import { useState, useSyncExternalStore } from 'react';
import { Button } from './ui/Button';
import { TOUCH_TALL } from '../lib/touch';
import { markPageGoing, pageUpdateWatcher, type createUpdateWatcher } from '../lib/update-recovery';

type Watcher = Pick<ReturnType<typeof createUpdateWatcher>, 'subscribe' | 'newer'>;

const noSubscribe = () => () => {};
const idOf = (b: { version: string; builtAt: string }) => `${b.version}|${b.builtAt}`;

function reloadPage() {
  markPageGoing();
  window.location.reload();
}

/**
 * The update notice (installable website, 13 Nov 2026): once a newer version is live (the update check
 * in lib/update-recovery — on focus, on coming back and every 10 minutes, or a new service worker), "A
 * new version of MICO360 Tasks is ready" with Refresh and Later. Refresh reloads (changes waiting to be
 * sent are kept on this device, as always); Later puts it away for that version. The quiet full page load
 * at the next move to another page still happens. An installed app has no reload button: this is how
 * people there update. Replaces the footer's "available — Reload" banner.
 */
export function UpdateToast({ watcher = pageUpdateWatcher(), reload = reloadPage }: { watcher?: Watcher | null; reload?: () => void } = {}) {
  const newer = useSyncExternalStore(
    typeof watcher?.subscribe === 'function' ? watcher.subscribe : noSubscribe,
    () => watcher?.newer ?? null,
    () => null,
  );
  const [laterFor, setLaterFor] = useState<string | null>(null);
  if (!newer || idOf(newer) === laterFor) return null;
  return (
    // Under open dialogs (z-50): a form being filled in covers it, so Refresh is never tapped mid-form.
    <div className="pointer-events-none fixed inset-x-0 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[45] flex justify-center px-3">
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-auto flex max-w-full flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-surface px-4 py-2.5 text-sm text-ink shadow-lift animate-fade-in-up"
      >
        <span className="min-w-0">A new version of MICO360 Tasks is ready.</span>
        <span className="flex items-center gap-2">
          <Button size="sm" onClick={reload} className={TOUCH_TALL}>
            Refresh
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setLaterFor(idOf(newer))} className={TOUCH_TALL}>
            Later
          </Button>
        </span>
      </div>
    </div>
  );
}
