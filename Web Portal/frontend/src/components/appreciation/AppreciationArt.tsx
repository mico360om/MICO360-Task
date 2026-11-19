import { useEffect, useRef, type ReactNode } from 'react';
import { CompanyLogo } from '../company/CompanyLogo';
import { Logo } from '../ui/Logo';
import { markPlayed, playedHere, prefersReducedMotion, type AppreciationAnimation, type AppreciationIcon } from '../../lib/appreciation';

/** Employee Appreciation (1.24.0): the template icons (twenty from 1.24.4), the confetti burst and the company mark. */
const PATHS: Record<AppreciationIcon, ReactNode> = {
  star: <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />,
  team: (
    <>
      <circle cx="9" cy="8" r="3" />
      <circle cx="17" cy="9" r="2.4" />
      <path d="M3.5 20a5.5 5.5 0 0 1 11 0M14.5 20a4.5 4.5 0 0 1 6.5-4" />
    </>
  ),
  trophy: (
    <>
      <path d="M8 4h8v5a4 4 0 0 1-8 0z" />
      <path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7M10 17h4" />
    </>
  ),
  bulb: (
    <>
      <path d="M9 17h6M10 20.5h4" />
      <path d="M12 3a6 6 0 0 0-3.6 10.8c.4.3.6.8.6 1.2v2h6v-2c0-.4.2-.9.6-1.2A6 6 0 0 0 12 3z" />
    </>
  ),
  heart: <path d="M12 20s-7.5-4.4-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.6-7.5 10-7.5 10z" />,
  medal: (
    <>
      <path d="M8 3l2.5 6M16 3l-2.5 6" />
      <circle cx="12" cy="14.5" r="5.5" />
      <path d="M12 12l.9 1.8 2 .3-1.4 1.4.3 2-1.8-.9-1.8.9.3-2-1.4-1.4 2-.3z" />
    </>
  ),
  // 1.24.4 (owner, 19 Nov): fourteen more, in the same 24-unit stroke style.
  shield: (
    <>
      <path d="M12 3l7 3v5c0 4.6-3 8.3-7 10-4-1.7-7-5.4-7-10V6z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  rocket: (
    <>
      <path d="M12 3c3 2 4.5 5.5 4.5 9.5L14.5 16h-5l-2-3.5C7.5 8.5 9 5 12 3z" />
      <circle cx="12" cy="9.5" r="1.6" />
      <path d="M7.8 12.8L5 15.5l2.8.6M16.2 12.8l2.8 2.7-2.8.6M10.5 18.5L12 21l1.5-2.5" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" />
    </>
  ),
  'thumbs-up': (
    <>
      <path d="M7 10.5v9.5H4.5v-9.5z" />
      <path d="M7 10.5l3.8-6.6c1.3 0 2.3 1.1 2.1 2.4l-.5 3.7h5.3a2 2 0 0 1 2 2.3l-1.1 6a2 2 0 0 1-2 1.7H7" />
    </>
  ),
  handshake: (
    <>
      <path d="M2.5 11.5L6 8l3.2.8L12 7.5l2.8 1.3L18 8l3.5 3.5" />
      <path d="M6 14.5l3.2 3.2a1.4 1.4 0 0 0 2-2M8.8 13.7l3.4 3.4a1.4 1.4 0 0 0 2-2l-2.4-2.4M11.4 11.6l2.8 2.8a1.4 1.4 0 0 0 2-2L12.4 8.6" />
      <path d="M2.5 11.5L6 14.5M21.5 11.5L18 14.5l-1.8-1.8" />
    </>
  ),
  crown: (
    <>
      <path d="M4 17.5L3 7.5l5 4 4-6 4 6 5-4-1 10z" />
      <path d="M5 20.5h14" />
    </>
  ),
  flag: (
    <>
      <path d="M5.5 21V3.5" />
      <path d="M5.5 4.5c3.5-2 6.5 2 10 0 1.5-.8 3-.8 3-.8v9.3s-1.5 0-3 .8c-3.5 2-6.5-2-10 0" />
    </>
  ),
  gift: (
    <>
      <rect x="3.5" y="8.5" width="17" height="4" rx="1" />
      <path d="M5 12.5v8h14v-8M12 8.5v12" />
      <path d="M12 8.5C11 5.5 6.5 4.5 6.5 7S10 8.5 12 8.5zM12 8.5c1-3 5.5-4 5.5-1.5S14 8.5 12 8.5z" />
    </>
  ),
  sparkles: (
    <>
      <path d="M10 4l1.6 4.4L16 10l-4.4 1.6L10 16l-1.6-4.4L4 10l4.4-1.6z" />
      <path d="M18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8z" />
      <path d="M18 3v3M16.5 4.5h3" />
    </>
  ),
  award: (
    <>
      <circle cx="12" cy="9" r="5.5" />
      <circle cx="12" cy="9" r="2" />
      <path d="M8.6 13.3L7 21l5-2.5 5 2.5-1.6-7.7" />
    </>
  ),
  lightning: <path d="M13.5 2.5L5 13.5h6.5l-1 8 8.5-11h-6.5z" />,
  smile: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 14a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </>
  ),
};

/**
 * An icon, drawn in the current text colour. Decorative by default (the words beside it say what it is); `label`
 * gives it an accessible name where it stands alone. An unknown name (from a newer version) draws the star.
 */
export function AppreciationIconSvg({ icon, size = 24, className = '', label }: { icon: AppreciationIcon; size?: number; className?: string; label?: string }) {
  const known = Object.prototype.hasOwnProperty.call(PATHS, icon);
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      data-icon={known ? icon : 'star'}
      className={className}
    >
      {known ? PATHS[icon] : PATHS.star}
    </svg>
  );
}

/** The company's logo on a white tile (the site's own mark when the company has none). */
export function CompanyMark({ company }: { company: { name: string; logoUrl: string | null } }) {
  return (
    <span className="grid h-12 w-12 flex-none place-items-center overflow-hidden rounded-xl bg-white p-1.5 shadow-soft">
      {company.logoUrl ? <CompanyLogo company={company} size={32} alt={`${company.name} logo`} /> : <Logo size={32} title={company.name} />}
    </span>
  );
}

const COLOURS = ['#FDE68A', '#FCA5A5', '#A7F3D0', '#BFDBFE', '#DDD6FE', '#FFFFFF'];

/**
 * A confetti burst over its parent (about 2 seconds, once per device per appreciation): a small canvas, no package.
 * Nothing at all when the person prefers reduced motion. `play` false: nothing (the shimmer is CSS).
 * 1.24.2 `replay`: the Send page's preview plays it each time it mounts and never marks it played on this device.
 */
export function ConfettiBurst({ id, animation, replay = false }: { id: string; animation: AppreciationAnimation; replay?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const play = animation === 'confetti';
  useEffect(() => {
    if (!play || prefersReducedMotion() || (!replay && playedHere(id))) return;
    const canvas = ref.current;
    const ctx = canvas?.getContext?.('2d');
    if (!canvas || !ctx) return;
    if (!replay) markPlayed(id);
    const { width, height } = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    const bits = Array.from({ length: 90 }, () => ({
      x: width / 2,
      y: height * 0.35,
      vx: (Math.random() - 0.5) * 9,
      vy: -Math.random() * 7 - 2,
      size: 4 + Math.random() * 4,
      spin: Math.random() * Math.PI,
      colour: COLOURS[Math.floor(Math.random() * COLOURS.length)]!,
    }));
    const start = performance.now();
    let frame = 0;
    const draw = (t: number) => {
      const age = t - start;
      ctx.clearRect(0, 0, width, height);
      ctx.globalAlpha = Math.max(0, 1 - age / 2000);
      for (const b of bits) {
        b.vy += 0.22;
        b.x += b.vx;
        b.y += b.vy;
        b.spin += 0.2;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.spin);
        ctx.fillStyle = b.colour;
        ctx.fillRect(-b.size / 2, -b.size / 4, b.size, b.size / 2);
        ctx.restore();
      }
      if (age < 2000) frame = requestAnimationFrame(draw);
      else ctx.clearRect(0, 0, width, height);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [id, play, replay]);
  if (!play) return null;
  return <canvas ref={ref} data-confetti aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" />;
}
