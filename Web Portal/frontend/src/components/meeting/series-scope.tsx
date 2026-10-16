import type { SeriesScope } from '../../api/meetings';

export interface ScopeOption {
  label: string;
  hint: string;
}

/**
 * "This meeting" or "All upcoming meetings in the series" — asked before changing, cancelling or
 * deleting a meeting of a repeating series. `oneDisabled` explains why only the series can change.
 */
export function SeriesScopeChoice({
  value,
  onChange,
  one,
  series,
  oneDisabled,
  legend = 'Which meetings?',
}: {
  value: SeriesScope;
  onChange: (scope: SeriesScope) => void;
  one: ScopeOption;
  series: ScopeOption;
  oneDisabled?: string | null;
  legend?: string;
}) {
  const options: Array<{ v: SeriesScope; o: ScopeOption; disabled?: boolean }> = [
    { v: 'one', o: oneDisabled ? { ...one, hint: oneDisabled } : one, disabled: !!oneDisabled },
    { v: 'series', o: series },
  ];
  return (
    <fieldset className="mt-3 flex flex-col gap-2">
      <legend className="mb-1 text-sm font-semibold text-ink">{legend}</legend>
      {options.map(({ v, o, disabled }) => (
        <label
          key={v}
          className={`flex items-start gap-3 rounded-xl border p-3 transition-colors ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'} ${value === v ? 'border-brand bg-brand/5' : 'border-line hover:border-brand/50'}`}
        >
          <input
            type="radio"
            name="series-scope"
            value={v}
            checked={value === v}
            disabled={disabled}
            onChange={() => onChange(v)}
            className="mt-1 accent-[rgb(var(--c-brand))]"
          />
          <span>
            <span className="block text-sm font-medium text-ink">{o.label}</span>
            <span className="block text-xs text-ink-2">{o.hint}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
