/**
 * The signature pad's drawing, as plain functions: where a pointer is on the pad, which points a
 * stroke keeps, the smooth line through them, and the small picture that is stored. Points are kept
 * as fractions of the pad's width and height (0–1), so the drawing is redrawn at any size — a phone
 * turned on its side keeps the signature.
 */

/** A drawn signature or a typed one (the typed name is the signature), with the signer's name. */
export interface SignatureValue {
  method: 'DRAWN' | 'TYPED';
  name: string;
  /** A PNG data URL when drawn; null when typed. */
  image: string | null;
}

export interface PadPoint {
  x: number;
  y: number;
}

export interface Stroke {
  points: PadPoint[];
}

/** The ink: near-black, the same on paper in a light or a dark theme. */
export const INK = '#1C1A17';
/** The pad is white paper in both themes, so the ink always shows. */
export const PAPER = '#FFFFFF';
/** The stored picture fits inside this (CSS pixels at 1×): a signature stays a few kilobytes. */
export const EXPORT_MAX = { width: 600, height: 200 } as const;
/** The line on screen (CSS pixels). */
export const LINE_WIDTH = 2.5;

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/** A pointer's place on the pad, as fractions of its size (kept on the edge when it strays off). */
export function toPadPoint(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }): PadPoint {
  return { x: clamp01((clientX - rect.left) / (rect.width || 1)), y: clamp01((clientY - rect.top) / (rect.height || 1)) };
}

/** The stroke with `p` added — unless it is under half a pixel from the last point (hand jitter): then the same array. */
export function appendPoint(points: PadPoint[], p: PadPoint, size: { width: number; height: number }): PadPoint[] {
  const last = points[points.length - 1];
  if (!last) return [p];
  const moved = Math.hypot((p.x - last.x) * size.width, (p.y - last.y) * size.height);
  return moved < 0.5 ? points : [...points, p];
}

/** Anything drawn at all (a single tap leaves a dot). */
export function hasInk(strokes: ReadonlyArray<Stroke>): boolean {
  return strokes.some((s) => s.points.length > 0);
}

/** The stored picture's size: the pad's shape, at most 600×200. */
export function exportSize(width: number, height: number): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: EXPORT_MAX.width, height: EXPORT_MAX.height };
  const scale = Math.min(1, EXPORT_MAX.width / width, EXPORT_MAX.height / height);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export type InkPath =
  | { kind: 'dot'; x: number; y: number }
  | { kind: 'line'; start: { x: number; y: number }; segments: Array<{ cx: number; cy: number; x: number; y: number }> };

/** The line through a stroke's points at this size: curves through the midpoints (no corners), or a dot. */
export function pathOf(points: ReadonlyArray<PadPoint>, width: number, height: number): InkPath | null {
  const at = points.map((p) => ({ x: p.x * width, y: p.y * height }));
  if (at.length === 0) return null;
  if (at.length === 1) return { kind: 'dot', x: at[0]!.x, y: at[0]!.y };
  const segments: Array<{ cx: number; cy: number; x: number; y: number }> = [];
  for (let i = 0; i < at.length - 1; i++) {
    const a = at[i]!;
    const b = at[i + 1]!;
    segments.push({ cx: a.x, cy: a.y, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  }
  const end = at[at.length - 1]!;
  segments.push({ cx: end.x, cy: end.y, x: end.x, y: end.y });
  return { kind: 'line', start: at[0]!, segments };
}

/** The part of a 2D canvas context the pad draws with. */
export interface InkContext {
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  fillStyle: string | CanvasGradient | CanvasPattern;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void;
  stroke(): void;
  arc(x: number, y: number, r: number, start: number, end: number): void;
  fill(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
}

/** Draws every stroke on a fresh surface (white paper under it when `paper` is given). */
export function drawStrokes(ctx: InkContext, strokes: ReadonlyArray<Stroke>, o: { width: number; height: number; lineWidth: number; paper?: string }): void {
  if (o.paper) {
    ctx.fillStyle = o.paper;
    ctx.fillRect(0, 0, o.width, o.height);
  } else {
    ctx.clearRect(0, 0, o.width, o.height);
  }
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = o.lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const s of strokes) {
    const path = pathOf(s.points, o.width, o.height);
    if (!path) continue;
    ctx.beginPath();
    if (path.kind === 'dot') {
      ctx.arc(path.x, path.y, o.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.moveTo(path.start.x, path.start.y);
    for (const seg of path.segments) ctx.quadraticCurveTo(seg.cx, seg.cy, seg.x, seg.y);
    ctx.stroke();
  }
}

/** What the signer still has to do (null: nothing). */
export function signatureProblem(value: SignatureValue | null, required: boolean): string | null {
  const sign = 'Sign here, or tick “Type my name instead”.';
  if (!value) return required ? sign : null;
  if (value.method === 'DRAWN' && !value.image) return required ? sign : null;
  if (!value.name.trim()) return 'Type the signer’s name.';
  return null;
}
