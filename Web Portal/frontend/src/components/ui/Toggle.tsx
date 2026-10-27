/**
 * An on/off switch (role="switch"), named by `label` and, optionally, described by the element(s)
 * `describedBy` names. The drawn track is 24px tall; on touch screens the button around it is 44px
 * tall so a finger can hit it, while the track and thumb look the same.
 */
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
      className="inline-flex flex-none items-center justify-center rounded-full disabled:opacity-50 [@media(pointer:coarse)]:min-h-11"
    >
      <span data-switch-track className={`relative block h-6 w-11 rounded-full transition-colors ${on ? 'bg-brand' : 'bg-line'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-soft transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
      </span>
    </button>
  );
}
