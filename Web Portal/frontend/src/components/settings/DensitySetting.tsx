import { COMPACT_MEDIA, useDensity, useSetDensity, type Density } from '../../lib/density';
import { useMediaQuery } from '../../lib/useMediaQuery';

/** The words of Compact / comfortable rows (Settings → Appearance and the quick buttons). */
export const DENSITY_WORDS = {
  label: 'Row spacing',
  hint: 'Compact fits more rows in lists, tables and boards. Saved to your account.',
  phones: 'Phones and touch screens always use comfortable spacing.',
  quick: 'Compact rows',
  quickOff: 'Compact rows: fit more on screen',
  quickOn: 'Compact rows are on: back to comfortable',
  failed: 'Couldn’t save that change. Please try again.',
} as const;

const OPTIONS: { value: Density; label: string }[] = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'compact', label: 'Compact' },
];

/**
 * Settings → Appearance, under Theme (1.23.0): Comfortable | Compact, the same choice as the quick
 * "Compact rows" buttons (lib/density.ts). On a phone or a touch screen it is still shown, and says
 * that those always use comfortable spacing.
 */
export function DensitySetting() {
  const density = useDensity();
  const { change, failed } = useSetDensity();
  const canShow = useMediaQuery(COMPACT_MEDIA, true);
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line pt-4">
      <div className="min-w-0">
        <div className="text-sm font-medium text-ink">{DENSITY_WORDS.label}</div>
        <div className="text-xs text-ink-2">{DENSITY_WORDS.hint}</div>
        {canShow ? null : <div className="mt-0.5 text-xs text-ink-2">{DENSITY_WORDS.phones}</div>}
        {failed ? <p role="alert" className="mt-1 text-xs font-medium text-danger">{DENSITY_WORDS.failed}</p> : null}
      </div>
      <div role="group" aria-label={DENSITY_WORDS.label} className="inline-flex rounded-lg border border-line p-0.5">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => change(o.value)}
            aria-pressed={density === o.value}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors [@media(pointer:coarse)]:!min-h-11 ${
              density === o.value ? 'bg-brand text-white shadow-brand' : 'text-ink-2 hover:text-ink'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
