import { useId } from 'react';
import { useInstallApp } from '../../lib/install-app';
import { Button } from '../ui/Button';
import { Logo } from '../ui/Logo';
import { TOUCH_TALL } from '../../lib/touch';

/**
 * The Dashboard's offer to install (installable website, 13 Nov 2026): "Install MICO360 Tasks on this
 * device", with Install and Not now. Chrome, Edge and Android: the browser's own install; iPhone and iPad:
 * the Add to Home Screen guide. Not shown where the browser can't install, once the site runs installed,
 * or for 90 days on this device after Not now (the account menu's Install App stays).
 */
export function InstallAppCard() {
  const { showCard, offer, install, notNow } = useInstallApp();
  const titleId = useId();
  if (!showCard) return null;
  return (
    <section aria-labelledby={titleId} data-install-card className="card flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3 animate-fade-in">
      <span aria-hidden="true" className="flex-none">
        <Logo size={40} />
      </span>
      <div className="min-w-0 flex-1 basis-56">
        <h2 id={titleId} className="text-sm font-semibold text-ink">
          Install MICO360 Tasks on this device
        </h2>
        <p className="mt-0.5 text-sm text-ink-2">
          {offer === 'ios' ? 'Add it to your Home Screen and open it like any app.' : 'Open it from your home screen or desktop like any app, in its own window.'}
        </p>
      </div>
      <div className="flex flex-none gap-2 max-sm:w-full">
        <Button size="sm" onClick={() => void install()} className={`max-sm:flex-1 ${TOUCH_TALL}`}>
          Install
        </Button>
        <Button size="sm" variant="secondary" onClick={notNow} className={`max-sm:flex-1 ${TOUCH_TALL}`}>
          Not now
        </Button>
      </div>
    </section>
  );
}
