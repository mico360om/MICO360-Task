/**
 * How far along, as a ring (13 Nov new look): an inline SVG — a track, and an arc (`stroke-dasharray`) for the share
 * done, brand red while under way and the Done green once full — with "done / total" in the middle. One image for
 * screen readers, named by `label` ("1 of 8 modules done"); its drawing and digits are not read again.
 */
export function ProgressRing({ done, total, size = 96, label }: { done: number; total: number; size?: number; label: string }) {
  const stroke = Math.max(4, Math.round(size / 10));
  const r = (size - stroke) / 2;
  const length = 2 * Math.PI * r;
  const share = total > 0 ? Math.min(1, Math.max(0, done / total)) : 0;
  const complete = total > 0 && share >= 1;
  const on = share * length;
  return (
    <div role="img" aria-label={label} data-complete={complete ? 'true' : undefined} className="relative inline-grid flex-none place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" focusable="false" className="-rotate-90">
        <circle data-ring-track data-length={length} cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-line" />
        {on > 0 ? (
          <circle
            data-ring-arc
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap={complete ? 'butt' : 'round'}
            strokeDasharray={`${on} ${length}`}
            className={`transition-[stroke-dasharray] duration-500 motion-reduce:transition-none ${complete ? 'stroke-status-done' : 'stroke-brand'}`}
          />
        ) : null}
      </svg>
      <span aria-hidden="true" className="absolute inset-0 grid place-items-center font-display font-bold tabular-nums text-ink" style={{ fontSize: Math.max(12, Math.round(size / 4.6)) }}>
        <span dir="ltr">{`${done} / ${total}`}</span>
      </span>
    </div>
  );
}
