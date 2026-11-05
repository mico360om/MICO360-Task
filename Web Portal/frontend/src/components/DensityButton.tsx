import { useDensity, useSetDensity } from '../lib/density';
import { DENSITY_WORDS } from './settings/DensitySetting';

/**
 * The quick "Compact rows" button (1.23.0) on the toolbars of tables and lists — beside the view
 * switch (components/data-table/ViewSwitch), on My Tasks and on the Notifications page. A toggle
 * (aria-pressed) for the same choice as Settings → Appearance, saved on the person's account.
 * Shown only where compact can apply (from 768px with a mouse or trackpad): phones and touch screens
 * always keep comfortable rows, and Settings says so.
 */
export function DensityButton({ className = '', size = 'md' }: { className?: string; /** 'sm': beside 34px controls (the Notifications tabs). */ size?: 'md' | 'sm' }) {
  const density = useDensity();
  const { change, failed } = useSetDensity();
  const on = density === 'compact';
  return (
    <span data-density-button className={`relative inline-flex flex-none items-center max-md:hidden [@media(pointer:coarse)]:hidden ${className}`}>
      <span className="inline-flex items-center rounded-xl border border-line bg-surface p-0.5">
        <button
          type="button"
          aria-pressed={on}
          aria-label={DENSITY_WORDS.quick}
          title={on ? DENSITY_WORDS.quickOn : DENSITY_WORDS.quickOff}
          onClick={() => change(on ? 'comfortable' : 'compact')}
          className={`grid place-items-center rounded-lg transition-colors ${size === 'sm' ? 'h-7 w-7' : 'h-8 w-8'} ${on ? 'bg-brand text-white shadow-sm' : 'text-ink-2 hover:bg-ground hover:text-ink'}`}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 5h16M4 9.67h16M4 14.33h16M4 19h16" />
          </svg>
        </button>
      </span>
      {/* Under the button, out of the toolbar's flow: a toolbar that doesn't wrap never widens the page. */}
      {failed ? (
        <span role="alert" className="absolute end-0 top-full z-10 mt-1 whitespace-nowrap rounded-lg border border-danger/30 bg-danger-soft px-2 py-1 text-xs font-medium text-danger shadow-soft">
          {DENSITY_WORDS.failed}
        </span>
      ) : null}
    </span>
  );
}
