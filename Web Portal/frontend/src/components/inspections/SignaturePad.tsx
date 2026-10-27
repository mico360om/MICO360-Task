import { useCallback, useEffect, useId, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Button } from '../ui/Button';
import { FieldError, FieldLabel, RequiredMark, fieldClass } from '../ui/Field';
import { appendPoint, drawStrokes, exportSize, hasInk, INK, LINE_WIDTH, PAPER, toPadPoint, type SignatureValue, type Stroke } from './signature-ink';

export type { SignatureValue } from './signature-ink';
export { signatureProblem } from './signature-ink';

export interface SignaturePadProps {
  /** "Inspector signature" — the visible label, and the drawing area's accessible name. */
  label: string;
  /** The typed name to start with (the inspector's own name, say). */
  defaultName?: string;
  required?: boolean;
  /** Controlled: the signature as last given by `onChange` (null to empty the pad). */
  value: SignatureValue | null;
  /** Called after each finished stroke, each name change, Clear and Undo; null when nothing usable is left. */
  onChange: (value: SignatureValue | null) => void;
  disabled?: boolean;
  /** What is still missing ("Sign here, or tick “Type my name instead”."), shown under it. */
  error?: string | null;
}

/** The line under the signature and its "×": a guide on the paper, never part of the stored picture. */
const GUIDE = '#C9C3BF';
const NAME_MAX = 120;

const sameValue = (a: SignatureValue | null, b: SignatureValue | null) =>
  a === b || (!!a && !!b && a.method === b.method && a.name === b.name && a.image === b.image);

/**
 * A signature, drawn on screen with a finger, a pen or a mouse (Pointer Events; the page doesn't
 * scroll while signing; only the first finger draws), or — the keyboard way, and for anyone who
 * can't draw — the typed name itself ("Type my name instead"). The signer's typed name always goes
 * with it. The pad is white paper with dark ink in either theme; the drawing is kept as strokes, so
 * it is redrawn when the pad changes size (a phone turned on its side), and given to the page as a
 * small PNG (at most 600×200, on white). Clear and Undo last stroke start again, and a screen reader
 * hears each change.
 */
export function SignaturePad({ label, defaultName = '', required = false, value, onChange, disabled = false, error }: SignaturePadProps) {
  const ids = { label: useId(), hint: useId(), name: useId(), error: useId(), typed: useId() };
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Stroke[]>([]);
  const active = useRef<{ id: number; stroke: Stroke } | null>(null);
  /** The PNG of the strokes as they are (made once per change, not per keystroke in the name). */
  const image = useRef<string | null>(null);
  const size = useRef({ width: 0, height: 0 });
  const lastGiven = useRef<SignatureValue | null>(value);
  const [strokeCount, setStrokeCount] = useState(0);
  // A drawn signature handed in from outside (kept on the device, say): shown until it is cleared or drawn over.
  const [restored, setRestored] = useState<string | null>(value?.method === 'DRAWN' ? value.image : null);
  const [typed, setTyped] = useState(value?.method === 'TYPED');
  const [name, setName] = useState(value?.name ?? defaultName);
  const [announcement, setAnnouncement] = useState('');

  const give = useCallback(
    (next: SignatureValue | null) => {
      lastGiven.current = next;
      onChange(next);
    },
    [onChange],
  );

  /** Sizes the canvas to the pad (sharp on any screen) and draws every stroke again. */
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    size.current = { width: rect.width, height: rect.height };
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const all = active.current ? [...strokes.current, active.current.stroke] : strokes.current;
    drawStrokes(ctx, all, { width: rect.width, height: rect.height, lineWidth: LINE_WIDTH });
  }, []);

  /** The strokes as a small PNG on white (null when there are none, or no canvas to draw on). */
  const exportPng = useCallback((): string | null => {
    if (!hasInk(strokes.current)) return null;
    const { width, height } = size.current;
    const out = exportSize(width, height);
    const c = document.createElement('canvas');
    c.width = out.width;
    c.height = out.height;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    const scale = width > 0 ? out.width / width : 1;
    drawStrokes(ctx, strokes.current, { width: out.width, height: out.height, lineWidth: Math.max(1.5, LINE_WIDTH * scale), paper: PAPER });
    try {
      return c.toDataURL('image/png');
    } catch {
      return null;
    }
  }, []);

  const drawnValue = (signer: string, picture = image.current ?? restored): SignatureValue | null => (picture ? { method: 'DRAWN', name: signer.trim(), image: picture } : null);
  const typedValue = (signer: string): SignatureValue | null => (signer.trim() ? { method: 'TYPED', name: signer.trim(), image: null } : null);

  useEffect(() => {
    redraw();
    const onResize = () => redraw();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    const canvas = canvasRef.current;
    const observer = typeof ResizeObserver !== 'undefined' && canvas ? new ResizeObserver(onResize) : null;
    if (observer && canvas) observer.observe(canvas);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      observer?.disconnect();
    };
  }, [redraw]);

  // The page emptied (or replaced) the signature: follow it.
  useEffect(() => {
    if (sameValue(value, lastGiven.current)) return;
    lastGiven.current = value;
    strokes.current = [];
    active.current = null;
    image.current = null;
    setStrokeCount(0);
    setRestored(value?.method === 'DRAWN' ? value.image : null);
    if (value) {
      setTyped(value.method === 'TYPED');
      setName(value.name);
    }
    redraw();
  }, [value, redraw]);

  const drawable = !disabled && !typed;

  function onPointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawable || active.current) return; // only the first finger draws
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    const canvas = e.currentTarget;
    try {
      canvas.setPointerCapture?.(e.pointerId);
    } catch {
      /* the pointer is already gone */
    }
    // Drawing over a signature handed in from outside starts a new one.
    if (restored) setRestored(null);
    active.current = { id: e.pointerId, stroke: { points: [toPadPoint(e.clientX, e.clientY, canvas.getBoundingClientRect())] } };
    redraw();
  }

  function onPointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    const a = active.current;
    if (!a || a.id !== e.pointerId) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    // Every point the browser saw since the last event (a fast stroke stays smooth).
    const native = e.nativeEvent as PointerEvent & { getCoalescedEvents?: () => PointerEvent[] };
    const seen = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
    for (const ev of seen.length ? seen : [{ clientX: e.clientX, clientY: e.clientY }]) a.stroke.points = appendPoint(a.stroke.points, toPadPoint(ev.clientX, ev.clientY, rect), rect);
    redraw();
  }

  /** The stroke is done (lifted, or taken away by the browser): keep it. */
  function onPointerEnd(e: ReactPointerEvent<HTMLCanvasElement>) {
    const a = active.current;
    if (!a || a.id !== e.pointerId) return;
    active.current = null;
    const wasEmpty = !hasInk(strokes.current);
    strokes.current = [...strokes.current, a.stroke];
    setStrokeCount(strokes.current.length);
    redraw();
    image.current = exportPng();
    if (wasEmpty) setAnnouncement('Signature drawn');
    give(drawnValue(name, image.current));
  }

  function clear() {
    strokes.current = [];
    image.current = null;
    setStrokeCount(0);
    setRestored(null);
    redraw();
    setAnnouncement('Signature cleared');
    give(null);
  }

  function undo() {
    if (!hasInk(strokes.current)) return clear();
    strokes.current = strokes.current.slice(0, -1);
    setStrokeCount(strokes.current.length);
    redraw();
    if (!hasInk(strokes.current)) return clear();
    image.current = exportPng();
    setAnnouncement('Last stroke undone');
    give(drawnValue(name, image.current));
  }

  function onTypedChange(e: ChangeEvent<HTMLInputElement>) {
    const next = e.target.checked;
    setTyped(next);
    if (next) {
      setAnnouncement('Signing with the typed name');
      give(typedValue(name));
    } else {
      setAnnouncement(hasInk(strokes.current) || restored ? 'Signing with the drawing' : 'Draw the signature');
      give(drawnValue(name));
    }
  }

  function onNameChange(e: ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    setName(next);
    give(typed ? typedValue(next) : drawnValue(next));
  }

  const hasDrawing = strokeCount > 0 || !!restored;
  const describedBy = [ids.hint, error ? ids.error : null].filter(Boolean).join(' ');
  const signer = name.trim();

  return (
    <div role="group" aria-labelledby={ids.label} className="min-w-0">
      <p id={ids.label} className="text-sm font-semibold text-ink">
        {label}
        {required ? <RequiredMark /> : null}
      </p>
      <div
        className={`relative mt-1.5 h-44 w-full overflow-hidden rounded-xl border ${error ? 'border-danger ring-2 ring-danger/30' : 'border-line'} ${disabled ? 'opacity-60' : ''}`}
        style={{ background: PAPER }}
      >
        {restored && !typed ? <img src={restored} alt="" aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full object-contain" /> : null}
        {/* The guide: a line to sign on and its "×" (on the paper, never in the picture). */}
        <span aria-hidden="true" className="pointer-events-none absolute inset-x-5 bottom-9 border-b border-dashed" style={{ borderColor: GUIDE }} />
        <span aria-hidden="true" className="pointer-events-none absolute bottom-10 left-5 text-lg leading-none" style={{ color: GUIDE }}>
          ×
        </span>
        {!hasDrawing && !typed ? (
          <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1/3 text-center text-sm" style={{ color: '#8A817C' }}>
            Sign here
          </span>
        ) : null}
        <canvas
          ref={canvasRef}
          role={typed ? undefined : 'img'}
          aria-hidden={typed ? true : undefined}
          aria-label={typed ? undefined : `${label}: drawing area`}
          aria-describedby={typed ? undefined : describedBy}
          className={`absolute inset-0 h-full w-full touch-none select-none ${drawable ? 'cursor-crosshair' : 'cursor-not-allowed'}`}
          style={{ touchAction: 'none' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onLostPointerCapture={onPointerEnd}
        />
        {typed ? (
          <div
            role="img"
            aria-label={`${label}: typed name, ${signer || 'not typed yet'}`}
            aria-describedby={describedBy}
            className="absolute inset-0 grid place-items-center px-4 pb-6"
            style={{ background: PAPER, color: INK }}
          >
            <span dir="auto" className="max-w-full truncate font-serif text-3xl italic">
              {signer}
            </span>
          </div>
        ) : null}
      </div>
      <p id={ids.hint} className="mt-1 text-xs text-ink-2">
        Draw with your finger or mouse. Or type your name instead.
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="secondary" onClick={undo} disabled={disabled || typed || strokeCount === 0}>
          Undo last stroke
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={clear} disabled={disabled || typed || !hasDrawing}>
          Clear
        </Button>
        <label htmlFor={ids.typed} className={`ms-auto inline-flex min-h-[2.75rem] items-center gap-2 text-sm text-ink ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
          <input
            id={ids.typed}
            type="checkbox"
            checked={typed}
            onChange={onTypedChange}
            disabled={disabled}
            className="h-4 w-4 accent-[rgb(var(--c-brand))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          />
          Type my name instead
        </label>
      </div>

      <div className="mt-2 flex flex-col gap-1">
        <FieldLabel htmlFor={ids.name} required>
          Signer’s name
        </FieldLabel>
        <input
          id={ids.name}
          type="text"
          value={name}
          onChange={onNameChange}
          required
          aria-required="true"
          aria-invalid={error && !signer ? true : undefined}
          autoComplete="name"
          maxLength={NAME_MAX}
          dir="auto"
          disabled={disabled}
          className={fieldClass(!!error && !signer, 'w-full')}
        />
      </div>
      <FieldError id={ids.error}>{error}</FieldError>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
