import { COMPACT_MEDIA, useDensity, useSetDensity, type Density } from '../lib/density';
import { useMediaQuery } from '../lib/useMediaQuery';
import { ChoiceMenu } from './ui/ChoiceMenu';
import { DENSITY_OPTIONS, DENSITY_WORDS } from './settings/DensitySetting';

const ICON: Record<Density, JSX.Element> = {
  'compact': <path d="M4 5h16M4 9.67h16M4 14.33h16M4 19h16" />,
  comfortable: <path d="M4 6h16M4 12h16M4 18h16" />,
  // A line of words, and a fainter line under it, twice: more on each row.
  detailed: <path d="M4 5h16M4 9h10M4 14h16M4 18h10" />,
};
const Icon = ({ d, size = 16 }: { d: Density; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {ICON[d]}
  </svg>
);

/**
 * The quick "Rows" button (1.23.0; three modes 1.23.8) on the toolbars of tables and lists — beside the view
 * switch (components/data-table/ViewSwitch), on My Tasks and on the Notifications page. It opens a menu of
 * Compact · Comfortable · Detailed: the same choice as Settings → Appearance, saved on the person's account.
 * Detailed applies on every screen, so the button is on phones and touch screens too; there Compact says it
 * is for computers (those screens keep comfortable spacing).
 */
export function DensityButton({ className = '', size = 'md' }: { className?: string; /** 'sm': beside 34px controls (the Notifications tabs). */ size?: 'md' | 'sm' }) {
  const density = useDensity();
  const { change, failed } = useSetDensity();
  const canCompact = useMediaQuery(COMPACT_MEDIA, true);
  const shown = DENSITY_OPTIONS.find((o) => o.value === density)!;
  const label = `${DENSITY_WORDS.label}: ${shown.label}${density === 'compact' && !canCompact ? ' (comfortable on this screen)' : ''}`;
  return (
    <span data-density-button className={`relative inline-flex flex-none items-center ${className}`}>
      <span className="inline-flex items-center rounded-xl border border-line bg-surface p-0.5">
        <ChoiceMenu<Density>
          label={label}
          menuLabel={DENSITY_WORDS.label}
          value={density}
          size={size}
          icon={<Icon d={density === 'compact' && !canCompact ? 'comfortable' : density} />}
          choices={DENSITY_OPTIONS.map((o) => ({ value: o.value, label: o.label, icon: <Icon d={o.value} size={15} />, hint: o.value === 'compact' && !canCompact ? DENSITY_WORDS.computersOnly : undefined }))}
          onChoose={change}
        />
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
