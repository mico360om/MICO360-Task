import type { SignatureInput } from './inspection-types';
import type { SignatureRole } from './inspection-rules';
import { PLEX_SEMIBOLD_ADVANCE, textWidthEm } from './font-metrics';

/**
 * The signature pad's drawing, as plain functions — the website's `signature-ink.ts` (where a
 * finger is on the pad, which points a stroke keeps, the smooth line through them, the stored
 * picture's size, what a signer still has to do), with the same results. The canvas drawing is not
 * copied: the phone draws with react-native-svg (`inkPathD`), and the ink and paper colours are
 * `SIGNATURE_COLORS` in lib/theme.ts. Points are fractions of the pad's size (0–1), so a phone
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

/** The stored picture fits inside this (dp at 1×): a signature stays a few kilobytes. */
export const EXPORT_MAX = { width: 600, height: 200 } as const;
/** The line on screen (dp). */
export const LINE_WIDTH = 2.5;

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/** A finger's place on the pad, as fractions of its size (kept on the edge when it strays off). */
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

/** What the signer still has to do (null: nothing). */
export function signatureProblem(value: SignatureValue | null, required: boolean): string | null {
  const sign = 'Sign here, or tick “Type my name instead”.';
  if (!value) return required ? sign : null;
  if (value.method === 'DRAWN' && !value.image) return required ? sign : null;
  if (!value.name.trim()) return 'Type the signer’s name.';
  return null;
}

/** A number in a path: at most two decimals, no trailing zeros. */
const num = (n: number) => String(Math.round(n * 100) / 100);

/** A stroke as an SVG path ('M x y Q cx cy x y …'); '' for a dot (drawn as a circle of LINE_WIDTH). */
export function inkPathD(path: InkPath): string {
  if (path.kind === 'dot') return '';
  return [`M${num(path.start.x)} ${num(path.start.y)}`, ...path.segments.map((s) => `Q${num(s.cx)} ${num(s.cy)} ${num(s.x)} ${num(s.y)}`)].join(' ');
}

/**
 * The PNG as the server reads it (`^data:image/png;base64,([A-Za-z0-9+/=]+)$`): Android's Base64
 * breaks its lines, so every space and line break is taken out.
 */
export function pngDataUrl(base64: string): string {
  return `data:image/png;base64,${base64.replace(/\s+/g, '')}`;
}

/**
 * The signatures to finish with, as the website's sign dialog makes them: the first pad with
 * something missing stops it (and says what); an empty optional pad is left out; names are trimmed;
 * a drawn one carries its picture; all of them get the same time.
 */
export function signatureInputs(
  pads: Array<{ role: SignatureRole; required: boolean; value: SignatureValue | null }>,
  signedAt: string,
): { ok: true; signatures: SignatureInput[] } | { ok: false; role: SignatureRole; problem: string } {
  for (const pad of pads) {
    const problem = signatureProblem(pad.value, pad.required);
    if (problem) return { ok: false, role: pad.role, problem };
  }
  const signatures: SignatureInput[] = [];
  for (const { role, value: v } of pads) {
    if (!v || (v.method === 'DRAWN' && !v.image)) continue;
    signatures.push({ role, name: v.name.trim(), method: v.method, ...(v.method === 'DRAWN' ? { image: v.image } : {}), signedAt });
  }
  return { ok: true, signatures };
}

/** The sign sheet's buttons row: page padding each side, the gap between, a button's padding and its label size (ui Button md). */
const SIGN_ROW = { pagePadding: 16, gap: 8, buttonPadding: 16, fontSize: 14, margin: 4 } as const;

/**
 * Whether the sign sheet's "Cancel" and "Sign and finish" fit side by side at this screen width and
 * font scale (Final I13): each label, at the button's size in Plex SemiBold, inside half the row.
 * When they don't, the buttons stack so neither word is cut.
 */
export function signButtonsSideBySide(width: number, fontScale: number): boolean {
  const r = SIGN_ROW;
  const half = (width - 2 * r.pagePadding - r.gap) / 2;
  const widest = Math.max(...[SIGN_WORDS.cancel, SIGN_WORDS.title].map((t) => textWidthEm(t, PLEX_SEMIBOLD_ADVANCE) * r.fontSize * Math.max(1, fontScale)));
  return widest + 2 * r.buttonPadding <= half - r.margin;
}

/** The pad's and the sign sheet's words, the website's ("finger", not "finger or mouse", on a phone). */
export const SIGN_WORDS = {
  padLabel: '{role} signature',
  optional: ' (optional)',
  signHere: 'Sign here',
  hint: 'Draw with your finger. Or type your name instead.',
  undo: 'Undo last stroke',
  clear: 'Clear',
  typeInstead: 'Type my name instead',
  signerName: 'Signer’s name',
  drawingArea: '{label}: drawing area',
  typedArea: '{label}: typed name, {name}',
  notTyped: 'not typed yet',
  drawn: 'Signature drawn',
  cleared: 'Signature cleared',
  undone: 'Last stroke undone',
  typing: 'Signing with the typed name',
  drawing: 'Signing with the drawing',
  drawIt: 'Draw the signature',
  title: 'Sign and finish',
  intro: 'Signing finishes the inspection: its answers can’t be changed after this, and the report is made from them.',
  offline: ' There’s no signal now: the signatures are saved on this phone, and it finishes when you’re back online.',
  cancel: 'Cancel',
} as const;
