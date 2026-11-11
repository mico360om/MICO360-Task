import { selectBoxName } from '../../lib/bulk-selection';

/** Was Shift held for this click (or key)? A Shift-click selects a range. */
export const shiftHeld = (e: Event): boolean => 'shiftKey' in e && Boolean((e as MouseEvent).shiftKey);

/**
 * A "Select all" box: ticked when every matching task is selected, half-ticked (indeterminate) when
 * some are. Its name is the caller's (a label around it, or `label`).
 */
export function SelectAllBox({ state, onChange, label, className = 'h-3.5 w-3.5 accent-brand' }: { state: 'all' | 'some' | 'none'; onChange: () => void; label?: string; className?: string }) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      ref={(el) => {
        if (el) el.indeterminate = state === 'some';
      }}
      checked={state === 'all'}
      onChange={onChange}
      className={className}
    />
  );
}

/**
 * A task's select box ("Select RIG-12 Pour the slab"): 16px, its label padding it to 28px (44px on
 * a touch screen); it sits above the row's own click area (`z-10`), never inside another control.
 */
export function TaskSelectBox({ task, checked, onChange, className = '' }: { task: { key: string; title: string }; checked: boolean; onChange: (shift: boolean) => void; className?: string }) {
  return (
    <label className={`relative z-10 grid h-7 w-7 flex-none cursor-pointer place-items-center [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 ${className}`}>
      <input type="checkbox" aria-label={selectBoxName(task)} checked={checked} onChange={(e) => onChange(shiftHeld(e.nativeEvent))} className="h-4 w-4 cursor-pointer accent-brand" />
    </label>
  );
}
