/** A ring's arc colour other than its own (brand red under way, the Done green when full): a quiz result's. */
const TONE_ARC = { success: 'stroke-success', danger: 'stroke-danger' } as const;

/**
 * How far along, as a ring (13 Nov new look): an inline SVG — a track, and an arc (`stroke-dasharray`) for the share
 * done, brand red while under way and the Done green once full — with "done / total" in the middle. One image for
 * screen readers, named by `label` ("1 of 8 modules done"); its drawing and digits are not read again.
 *
 * A quiz's score gives its own middle (`text`: "75%") and the result's colour (`tone`). 1.23.36: no pass-mark notch —
 * the owner read it as a stray black mark; the pass mark is said in words beside the ring.
 */
export function ProgressRing({
  done,
  total,
  size = 96,
  label,
  text,
  tone,
}: {
  done: number;
  total: number;
  size?: number;
  label: string;
  text?: string;
  tone?: keyof typeof TONE_ARC;
}) {
  const stroke = Math.max(4, Math.round(size / 10));
  const r = (size - stroke) / 2;
  const length = 2 * Math.PI * r;
  const share = total > 0 ? Math.min(1, Math.max(0, done / total)) : 0;
  const complete = total > 0 && share >= 1;
  const on = share * length;
  const c = size / 2;
  const arcClass = tone ? TONE_ARC[tone] : complete ? 'stroke-status-done' : 'stroke-brand';
  return (
    <div role="img" aria-label={label} data-complete={complete ? 'true' : undefined} className="relative inline-grid flex-none place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" focusable="false" className="-rotate-90">
        <circle data-ring-track data-length={length} cx={c} cy={c} r={r} fill="none" strokeWidth={stroke} className="stroke-line" />
        {on > 0 ? (
          <circle
            data-ring-arc
            cx={c}
            cy={c}
            r={r}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap={complete ? 'butt' : 'round'}
            strokeDasharray={`${on} ${length}`}
            className={`transition-[stroke-dasharray] duration-500 motion-reduce:transition-none ${arcClass}`}
          />
        ) : null}
      </svg>
      <span aria-hidden="true" className="absolute inset-0 grid place-items-center font-display font-bold tabular-nums text-ink" style={{ fontSize: Math.max(12, Math.round(size / 4.6)) }}>
        <span dir="ltr">{text ?? `${done} / ${total}`}</span>
      </span>
    </div>
  );
}
