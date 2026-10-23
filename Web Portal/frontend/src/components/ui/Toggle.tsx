/** An on/off switch (role="switch"), named by `label` and, optionally, described by the element(s) `describedBy` names. */
export function Toggle({ on, onChange, label, disabled = false, describedBy }: { on: boolean; onChange: () => void; label: string; disabled?: boolean; describedBy?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={onChange}
      className={`relative h-6 w-11 flex-none rounded-full transition-colors disabled:opacity-50 ${on ? 'bg-brand' : 'bg-line'}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-soft transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  );
}
