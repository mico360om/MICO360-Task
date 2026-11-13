import { useInstallApp } from '../../lib/install-app';

/**
 * The account menu's "Install App" (installable website, 13 Nov 2026): while the site can be installed
 * here — the browser's own install (Chrome, Edge, Android) or the Add to Home Screen guide (iPhone, iPad).
 * Gone once it runs installed. Not now on the Dashboard card doesn't hide it.
 */
export function InstallAppMenuItem({ className, onDone }: { className: string; onDone: () => void }) {
  const { showMenu, install } = useInstallApp();
  if (!showMenu) return null;
  return (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        // The browser's install window must open within the click: install() asks for it at once.
        void install();
        onDone();
      }}
      className={`${className} w-full`}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
        <path d="M12 7.5v7M9 11.5l3 3 3-3M10.5 18.5h3" />
      </svg>
      Install App
    </button>
  );
}
