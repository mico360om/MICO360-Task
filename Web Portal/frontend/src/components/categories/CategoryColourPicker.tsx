import { useId } from 'react';
import { CATEGORY_COLOR_KEYS, CATEGORY_TONES } from '../../lib/task-categories';
import { categoryStyle } from '../CategoryChip';

/**
 * 1.24 The 12 category colours as one radio group (arrow keys move through it, each colour is named),
 * each a square swatch in its colour for the theme in use (`.cat-swatch`). Never a status colour.
 */
export function CategoryColourPicker({ value, onChange, label, disabled = false }: { value: string; onChange: (color: string) => void; label: string; disabled?: boolean }) {
  const name = useId();
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {CATEGORY_COLOR_KEYS.map((key) => {
        const tone = CATEGORY_TONES[key];
        return (
          <label key={key} title={tone.label} className="relative inline-grid h-8 w-8 cursor-pointer place-items-center [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11">
            <input type="radio" name={name} value={key} checked={value === key} disabled={disabled} onChange={() => onChange(key)} aria-label={tone.label} className="peer sr-only" />
            <span
              aria-hidden="true"
              style={categoryStyle(key)}
              className="cat-swatch block h-6 w-6 rounded-md ring-offset-2 ring-offset-surface transition-transform hover:scale-110 peer-checked:ring-2 peer-checked:ring-ink peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-brand peer-disabled:cursor-not-allowed peer-disabled:opacity-50"
            />
          </label>
        );
      })}
    </div>
  );
}
