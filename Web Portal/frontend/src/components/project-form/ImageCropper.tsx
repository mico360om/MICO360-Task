import { useEffect, useMemo, useRef, useState } from 'react';
import { pictureFormat } from '../../lib/picture-format';

/** The crop frame on screen, and the size of the square picture that is saved. */
const FRAME = 240;
const OUTPUT = 512;
const MIN_SIDE = 16;

export interface CroppedImage {
  blob: Blob;
  previewUrl: string;
}

/** Encode the canvas as JPEG when it is fully opaque, else as PNG (see pictureFormat): both print in PDFs. */
function encode(canvas: HTMLCanvasElement): Promise<Blob> {
  let pixels: Uint8ClampedArray | null = null;
  try {
    pixels = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data ?? null;
  } catch {
    pixels = null; // can't be read: PNG is always right
  }
  const format = pictureFormat(pixels);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The picture couldn’t be prepared.'))),
      format.type,
      'quality' in format ? format.quality : undefined,
    );
  });
}

/**
 * Square crop of a chosen picture: drag (or use the arrow keys) to position it, zoom with the
 * slider (or + and −), or fit the whole picture — a logo keeps its proportions and the rest of the
 * square stays transparent. The result is a 512 × 512 JPEG, or a PNG when it has transparency.
 */
export function ImageCropper({ file, onCancel, onDone }: { file: File; onCancel: () => void; onDone: (image: CroppedImage) => void }) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const imgRef = useRef<HTMLImageElement>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const cover = natural ? Math.max(FRAME / natural.w, FRAME / natural.h) : 1;
  const contain = natural ? Math.min(FRAME / natural.w, FRAME / natural.h) : 1;
  const min = Math.min(contain, cover);
  const max = cover * 4;
  const shown = natural ? { w: natural.w * scale, h: natural.h * scale } : { w: 0, h: 0 };

  const clamp = (o: { x: number; y: number }, s = scale) => {
    if (!natural) return o;
    const mx = Math.max(0, (natural.w * s - FRAME) / 2);
    const my = Math.max(0, (natural.h * s - FRAME) / 2);
    return { x: Math.min(mx, Math.max(-mx, o.x)), y: Math.min(my, Math.max(-my, o.y)) };
  };
  const zoomTo = (s: number) => {
    const next = Math.min(max, Math.max(min, s));
    setScale(next);
    setOffset((o) => clamp(o, next));
  };

  function onLoad() {
    const img = imgRef.current;
    if (!img) return;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) return setProblem('This picture couldn’t be read. Try another file.');
    if (w < MIN_SIDE || h < MIN_SIDE) return setProblem(`This picture is too small — use one at least ${MIN_SIDE} × ${MIN_SIDE} pixels.`);
    setNatural({ w, h });
    setScale(Math.max(FRAME / w, FRAME / h));
    setOffset({ x: 0, y: 0 });
  }

  async function apply() {
    const img = imgRef.current;
    if (!img || !natural) return;
    setBusy(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = OUTPUT;
      canvas.height = OUTPUT;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('The picture couldn’t be prepared.');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      const k = OUTPUT / FRAME;
      const left = FRAME / 2 + offset.x - shown.w / 2;
      const top = FRAME / 2 + offset.y - shown.h / 2;
      ctx.clearRect(0, 0, OUTPUT, OUTPUT);
      ctx.drawImage(img, left * k, top * k, shown.w * k, shown.h * k);
      const blob = await encode(canvas);
      onDone({ blob, previewUrl: URL.createObjectURL(blob) });
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'The picture couldn’t be prepared.');
    } finally {
      setBusy(false);
    }
  }

  const onKey = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 32 : 8;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) {
      e.preventDefault();
      const [dx, dy] = moves[e.key]!;
      setOffset((o) => clamp({ x: o.x + dx, y: o.y + dy }));
    } else if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      zoomTo(scale * 1.1);
    } else if (e.key === '-') {
      e.preventDefault();
      zoomTo(scale / 1.1);
    }
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        role="group"
        aria-label="Drag to position the picture (arrow keys move it, + and − zoom)"
        tabIndex={0}
        onKeyDown={onKey}
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d) setOffset(clamp({ x: d.ox + e.clientX - d.x, y: d.oy + e.clientY - d.y }));
        }}
        onPointerUp={() => { drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}
        className="relative cursor-grab touch-none overflow-hidden rounded-2xl outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-brand active:cursor-grabbing"
        style={{
          width: FRAME,
          height: FRAME,
          // A checkerboard shows where a fitted picture leaves the square transparent.
          backgroundImage: 'conic-gradient(rgb(var(--c-line)) 25%, transparent 0 50%, rgb(var(--c-line)) 0 75%, transparent 0)',
          backgroundSize: '16px 16px',
        }}
      >
        <img
          ref={imgRef}
          src={url}
          alt="Picture to crop"
          onLoad={onLoad}
          onError={() => setProblem('This picture couldn’t be read. Try another file.')}
          draggable={false}
          className="pointer-events-none absolute max-w-none select-none"
          style={natural ? { width: shown.w, height: shown.h, left: FRAME / 2 + offset.x - shown.w / 2, top: FRAME / 2 + offset.y - shown.h / 2 } : { opacity: 0 }}
        />
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-black/10" />
      </div>
      {problem ? <p role="alert" className="text-center text-sm text-danger">{problem}</p> : null}
      <div className="flex w-full max-w-xs items-center gap-3">
        <span className="text-xs font-medium text-ink-2" aria-hidden="true">−</span>
        <input
          type="range"
          aria-label="Zoom"
          min={min}
          max={max}
          step={(max - min) / 100 || 0.01}
          value={scale}
          disabled={!natural}
          onChange={(e) => zoomTo(Number(e.target.value))}
          className="h-2 flex-1 accent-[rgb(var(--c-brand))]"
        />
        <span className="text-xs font-medium text-ink-2" aria-hidden="true">+</span>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <button type="button" onClick={() => { setScale(min); setOffset({ x: 0, y: 0 }); }} disabled={!natural} className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:border-brand disabled:opacity-50">
          Fit whole picture
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-ink-2 hover:bg-ground">
          Don’t use it
        </button>
        <button type="button" onClick={() => void apply()} disabled={!natural || busy} className="rounded-lg bg-brand px-3.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
          {busy ? 'Preparing…' : 'Use this picture'}
        </button>
      </div>
    </div>
  );
}
