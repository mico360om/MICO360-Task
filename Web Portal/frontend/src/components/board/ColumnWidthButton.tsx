import { BOARD_COLUMN_WIDTHS, useBoardColumnWidth, useSetAppearance, useSidebarCollapsed, type BoardColumnWidth } from '../../lib/appearance';
import { ChoiceMenu } from '../ui/ChoiceMenu';

/** 1.23.8 The words of the board's column width (the board's button and Settings → Appearance). */
export const COLUMN_WIDTH_WORDS = {
  label: 'Column width',
  hint: 'How wide the board’s columns are: narrow fits more side by side, wide gives each card more room. Saved to your account.',
  failed: 'Couldn’t save that change. Please try again.',
  names: { narrow: 'Narrow', normal: 'Normal', wide: 'Wide' } as Record<BoardColumnWidth, string>,
} as const;

/** 1.23.8 The words of the side menu's fold (Settings → Appearance; the menu's own « button says the same). */
export const SIDEBAR_WORDS = {
  label: 'Side menu',
  hint: 'Icons only gives the page more room; each icon names itself when you point at it. On computers (tablets always show icons). Saved to your account.',
  full: 'Full',
  icons: 'Icons only',
  failed: 'Couldn’t save that change. Please try again.',
} as const;

/** Three columns, narrow to wide. */
const Icon = ({ w, size = 16 }: { w: BoardColumnWidth; size?: number }) => {
  const bars = w === 'narrow' ? [3, 8.5, 14, 19.5] : w === 'normal' ? [3, 10.5, 18] : [3, 13.5];
  const width = w === 'narrow' ? 3.5 : w === 'normal' ? 5 : 7.5;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
      {bars.map((x) => <rect key={x} x={x} y="4" width={width} height="16" rx="1.2" />)}
    </svg>
  );
};

/**
 * The board's "Column width" button (beside the view switch, board view only): Narrow · Normal · Wide, the
 * person's own, saved on their account (lib/appearance). A column is at least that wide; columns still
 * share any room left over, so a board with few columns fills the window whatever the choice.
 */
export function ColumnWidthButton() {
  const width = useBoardColumnWidth();
  const { change, failed } = useSetAppearance();
  return (
    <span data-column-width-button className="relative inline-flex flex-none items-center">
      <span className="inline-flex items-center rounded-xl border border-line bg-surface p-0.5">
        <ChoiceMenu<BoardColumnWidth>
          label={`${COLUMN_WIDTH_WORDS.label}: ${COLUMN_WIDTH_WORDS.names[width]}`}
          menuLabel={COLUMN_WIDTH_WORDS.label}
          value={width}
          icon={<Icon w={width} />}
          choices={BOARD_COLUMN_WIDTHS.map((w) => ({ value: w, label: COLUMN_WIDTH_WORDS.names[w], icon: <Icon w={w} size={15} /> }))}
          onChoose={(w) => change({ boardColumnWidth: w })}
        />
      </span>
      {failed ? (
        <span role="alert" className="absolute end-0 top-full z-10 mt-1 whitespace-nowrap rounded-lg border border-danger/30 bg-danger-soft px-2 py-1 text-xs font-medium text-danger shadow-soft">
          {COLUMN_WIDTH_WORDS.failed}
        </span>
      ) : null}
    </span>
  );
}

function Segmented<T extends string>({ label, value, options, onPick }: { label: string; value: T; options: { value: T; label: string }[]; onPick: (v: T) => void }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg border border-line p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onPick(o.value)}
          aria-pressed={value === o.value}
          className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors [@media(pointer:coarse)]:!min-h-11 ${value === o.value ? 'bg-brand text-white shadow-brand' : 'text-ink-2 hover:text-ink'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Settings → Appearance: Column width (the board's button says the same). */
export function ColumnWidthSetting() {
  const width = useBoardColumnWidth();
  const { change, failed } = useSetAppearance();
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line pt-4">
      <div className="min-w-0 max-w-xl">
        <div className="text-sm font-medium text-ink">{COLUMN_WIDTH_WORDS.label}</div>
        <div className="text-xs text-ink-2">{COLUMN_WIDTH_WORDS.hint}</div>
        {failed ? <p role="alert" className="mt-1 text-xs font-medium text-danger">{COLUMN_WIDTH_WORDS.failed}</p> : null}
      </div>
      <Segmented label={COLUMN_WIDTH_WORDS.label} value={width} options={BOARD_COLUMN_WIDTHS.map((w) => ({ value: w, label: COLUMN_WIDTH_WORDS.names[w] }))} onPick={(w) => change({ boardColumnWidth: w })} />
    </div>
  );
}

/** Settings → Appearance: the side menu, Full or Icons only (the menu's « / » button says the same). */
export function SidebarSetting() {
  const folded = useSidebarCollapsed();
  const { change, failed } = useSetAppearance();
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line pt-4">
      <div className="min-w-0 max-w-xl">
        <div className="text-sm font-medium text-ink">{SIDEBAR_WORDS.label}</div>
        <div className="text-xs text-ink-2">{SIDEBAR_WORDS.hint}</div>
        {failed ? <p role="alert" className="mt-1 text-xs font-medium text-danger">{SIDEBAR_WORDS.failed}</p> : null}
      </div>
      <Segmented
        label={SIDEBAR_WORDS.label}
        value={folded ? 'icons' : 'full'}
        options={[
          { value: 'full', label: SIDEBAR_WORDS.full },
          { value: 'icons', label: SIDEBAR_WORDS.icons },
        ]}
        onPick={(v) => change({ sidebarCollapsed: v === 'icons' })}
      />
    </div>
  );
}
