import { useEffect, useRef } from 'react';

/**
 * Ambient physics field for the login hero: task-themed icons that fall under a
 * gentle gravity, bounce off the panel edges, drift, and scatter away from the
 * cursor. Pure canvas + requestAnimationFrame (no dependencies). Honors
 * prefers-reduced-motion (renders a single static frame). Decorative + aria-hidden.
 */
const ICONS = ['✅', '📋', '🚩', '🕒', '🏷️', '📅', '📌', '⚡', '⭐', '🔔', '🗂️', '✔️'];

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  icon: string;
  rot: number;
  vrot: number;
  op: number;
}

export function HeroField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    // getContext throws (not returns null) where 2D canvas is unsupported — jsdom
    // under test, or a headless browser. This field is decorative + aria-hidden, so
    // simply render nothing there rather than letting the throw escape the effect.
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas?.getContext('2d') ?? null;
    } catch {
      ctx = null;
    }
    if (!canvas || !parent || !ctx) return;

    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;

    function resize() {
      w = parent!.clientWidth;
      h = parent!.clientHeight;
      canvas!.width = Math.max(1, w * dpr);
      canvas!.height = Math.max(1, h * dpr);
      canvas!.style.width = `${w}px`;
      canvas!.style.height = `${h}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(parent);

    const count = Math.max(9, Math.min(18, Math.round((w * h) / 62000)) || 12);
    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    const parts: Particle[] = Array.from({ length: count }, () => ({
      x: rand(40, Math.max(60, w - 40)),
      y: rand(20, Math.max(40, h * 0.55)),
      vx: rand(-1.1, 1.1),
      vy: rand(-1.1, 0.6),
      size: rand(20, 44),
      icon: ICONS[Math.floor(Math.random() * ICONS.length)]!,
      rot: rand(0, Math.PI * 2),
      vrot: rand(-0.02, 0.02),
      op: rand(0.1, 0.3),
    }));

    const mouse = { x: -9999, y: -9999 };
    const onMove = (e: MouseEvent) => {
      const r = parent.getBoundingClientRect();
      mouse.x = e.clientX - r.left;
      mouse.y = e.clientY - r.top;
    };
    const onLeave = () => {
      mouse.x = -9999;
      mouse.y = -9999;
    };
    parent.addEventListener('mousemove', onMove);
    parent.addEventListener('mouseleave', onLeave);

    const GRAVITY = 0.045;
    const REPEL = 150;
    let raf = 0;

    function step() {
      if (w === 0 || h === 0) {
        raf = requestAnimationFrame(step);
        return;
      }
      ctx!.clearRect(0, 0, w, h);
      for (const p of parts) {
        p.vy += GRAVITY;

        // Cursor repulsion — icons scatter away from the mouse.
        const dx = p.x - mouse.x;
        const dy = p.y - mouse.y;
        const dist = Math.hypot(dx, dy) || 1;
        if (dist < REPEL) {
          const f = (1 - dist / REPEL) * 1.6;
          p.vx += (dx / dist) * f;
          p.vy += (dy / dist) * f;
          p.vrot += (Math.random() - 0.5) * 0.02;
        }

        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.99;
        p.vy *= 0.99;

        const r = p.size * 0.5;
        // Bounce off the walls with damping; a nudge on the floor keeps things lively.
        if (p.x < r) {
          p.x = r;
          p.vx = Math.abs(p.vx) * 0.72;
        } else if (p.x > w - r) {
          p.x = w - r;
          p.vx = -Math.abs(p.vx) * 0.72;
        }
        if (p.y < r) {
          p.y = r;
          p.vy = Math.abs(p.vy) * 0.72;
        } else if (p.y > h - r) {
          p.y = h - r;
          p.vy = -Math.abs(p.vy) * 0.62;
          p.vx += (Math.random() - 0.5) * 0.6;
        }

        p.rot += p.vrot;

        ctx!.save();
        ctx!.globalAlpha = p.op;
        ctx!.translate(p.x, p.y);
        ctx!.rotate(p.rot);
        ctx!.font = `${p.size}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", system-ui`;
        ctx!.textAlign = 'center';
        ctx!.textBaseline = 'middle';
        ctx!.fillText(p.icon, 0, 0);
        ctx!.restore();
      }
      raf = requestAnimationFrame(step);
    }

    if (reduce) {
      // One static frame — no motion, no rAF loop.
      if (w > 0 && h > 0) {
        for (const p of parts) {
          ctx.save();
          ctx.globalAlpha = p.op;
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.font = `${p.size}px "Segoe UI Emoji", "Apple Color Emoji", system-ui`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(p.icon, 0, 0);
          ctx.restore();
        }
      }
    } else {
      raf = requestAnimationFrame(step);
    }

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      parent.removeEventListener('mousemove', onMove);
      parent.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none absolute inset-0 z-0" />;
}
