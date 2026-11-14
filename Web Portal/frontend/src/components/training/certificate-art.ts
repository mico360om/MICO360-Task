/**
 * The Learning Hub certificate's look (1.23.35, owner 14 Nov: "use similar design for the certificate"), shared by
 * the PDF (training-certificate-pdf.ts) and the website (components/training/certificate-art.ts is an exact copy,
 * kept by a drift test): one A4 landscape page measured in PDF points, with the red angled shapes and the laurel wreath
 * drawn as vector shapes here (our own drawing: nothing is copied from the owner's picture), where the words and the QR
 * code go, and which detail rows a certificate has. No imports, so the website can keep the same file.
 */

/** A4 landscape in points (the screen draws the same page in a viewBox of this size). */
export const CERT_PAGE = { width: 841.89, height: 595.28 } as const;

/** One millimetre in points. */
const MM = 72 / 25.4;

/** The brand red, and the tints the shapes are drawn in. */
export const CERT_COLORS = {
  red: '#8B1E1E',
  deep: '#6E1414',
  mid: '#B3262F',
  light: '#D94A55',
  ink: '#1C1917',
  /** Labels and the small lines (≥ 7:1 on white). */
  muted: '#44403C',
  paper: '#FFFFFF',
} as const;

export interface CertShape {
  /** Corner points, clockwise, in points from the page's top-left corner. */
  points: ReadonlyArray<readonly [number, number]>;
  color: string;
  opacity: number;
}

const W = CERT_PAGE.width;
const H = CERT_PAGE.height;
/** The red strip down the right side starts here. */
const STRIP = 768;

/**
 * The background: very faint paper facets, a cluster of angled red shapes in the top-left corner (clear of the logo),
 * translucent red panels and a red strip down the right side. Drawn in this order.
 */
export const CERT_SHAPES: readonly CertShape[] = [
  // Paper facets (barely there, like light on card).
  { points: [[0, H], [0, 372], [372, H]], color: '#000000', opacity: 0.022 },
  { points: [[236, H], [548, 282], [668, 282], [356, H]], color: '#000000', opacity: 0.018 },
  { points: [[470, 0], [700, 0], [420, 282], [300, 282]], color: '#000000', opacity: 0.014 },
  // Top-left corner (kept clear of the logo: a logo is printed on white).
  { points: [[0, 0], [124, 0], [0, 82]], color: CERT_COLORS.light, opacity: 0.16 },
  { points: [[0, 0], [80, 0], [0, 52]], color: CERT_COLORS.light, opacity: 0.22 },
  { points: [[0, 22], [44, 0], [44, 36], [0, 62]], color: CERT_COLORS.light, opacity: 0.55 },
  { points: [[0, 62], [44, 36], [44, 112], [0, 138]], color: CERT_COLORS.red, opacity: 0.94 },
  { points: [[0, 138], [44, 112], [44, 128], [0, 154]], color: CERT_COLORS.deep, opacity: 0.9 },
  { points: [[0, 154], [44, 128], [44, 176], [0, 202]], color: CERT_COLORS.light, opacity: 0.2 },
  // Translucent panels left of the strip.
  { points: [[574, 34], [STRIP, 146], [STRIP, 334], [574, 222]], color: CERT_COLORS.light, opacity: 0.17 },
  { points: [[652, 26], [STRIP, 93], [STRIP, 268], [652, 201]], color: CERT_COLORS.mid, opacity: 0.16 },
  { points: [[690, 236], [STRIP, 281], [STRIP, 566], [690, 521]], color: CERT_COLORS.light, opacity: 0.13 },
  // The strip and its bands.
  { points: [[STRIP, 0], [W, 0], [W, H], [STRIP, H]], color: CERT_COLORS.mid, opacity: 1 },
  { points: [[STRIP, 0], [W, 0], [W, 30], [STRIP, 0]], color: CERT_COLORS.light, opacity: 0.6 },
  { points: [[STRIP, 52], [W, 95], [W, 246], [STRIP, 203]], color: CERT_COLORS.deep, opacity: 0.55 },
  { points: [[STRIP, 300], [W, 343], [W, 470], [STRIP, 427]], color: CERT_COLORS.deep, opacity: 0.45 },
  { points: [[STRIP, 470], [W, 513], [W, H], [STRIP, H]], color: CERT_COLORS.red, opacity: 0.5 },
  { points: [[798, 120], [W, 145], [W, 330], [798, 305]], color: CERT_COLORS.light, opacity: 0.22 },
];

/** A shape as an SVG path ("M x y L … Z"). */
export function shapePath(shape: CertShape): string {
  return `${shape.points.map(([x, y], i) => `${i ? 'L' : 'M'}${r2(x)} ${r2(y)}`).join(' ')} Z`;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** The wreath's centre, the stems' radius, and the white square of the QR code in its middle. */
export const CERT_WREATH_AT = { cx: 642, cy: 430, radius: 104 } as const;

/**
 * The QR code's white square (its quiet zone included), centred in the wreath: 118 pt on a side, so even the smallest
 * QR code (21 modules + 4 a side of quiet zone) prints its modules over 30 mm wide.
 */
export function certQrBox(modules: number): { x: number; y: number; size: number; unit: number } {
  const size = Math.max(118, (30 * MM * (modules + 8)) / Math.max(1, modules));
  const unit = size / (modules + 8);
  return { x: CERT_WREATH_AT.cx - size / 2, y: CERT_WREATH_AT.cy - size / 2, size, unit };
}

/** "Scan to verify", centred under the wreath. */
export const CERT_SCAN = { cx: CERT_WREATH_AT.cx, baseline: 572, size: 12 } as const;

interface Vec {
  x: number;
  y: number;
}

/** A leaf: a pointed oval from `base` along `dir`, `length` long and `width` wide, curving slightly. */
function leafPath(base: Vec, dir: Vec, length: number, width: number, bend: number): string {
  const side: Vec = { x: -dir.y, y: dir.x };
  const at = (u: number, v: number) => `${r2(base.x + dir.x * u + side.x * v)} ${r2(base.y + dir.y * u + side.y * v)}`;
  const L = length;
  const w = width;
  return `M${at(0, 0)} C${at(L * 0.3, -w * 0.62 + bend)} ${at(L * 0.72, -w * 0.62 + bend)} ${at(L, bend * 1.6)} C${at(L * 0.7, w * 0.6 + bend)} ${at(L * 0.28, w * 0.58)} ${at(0, 0)} Z`;
}

/** The left branch's point at angle `deg` (0: the bottom of the circle, 90: its left side, more: up towards the top). */
function onStem(deg: number, radius: number): Vec {
  const t = (deg * Math.PI) / 180;
  return { x: CERT_WREATH_AT.cx - radius * Math.sin(t), y: CERT_WREATH_AT.cy + radius * Math.cos(t) };
}

const norm = (v: Vec): Vec => {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
};
const turn = (a: Vec, b: Vec, deg: number): Vec => {
  const t = (deg * Math.PI) / 180;
  return norm({ x: a.x * Math.cos(t) + b.x * Math.sin(t), y: a.y * Math.cos(t) + b.y * Math.sin(t) });
};

/** The left half of the wreath: the stem (a tapering band) and its leaves, as SVG paths. */
function leftBranch(): { stem: string; leaves: string[] } {
  const R = CERT_WREATH_AT.radius;
  const from = -16;
  const to = 146;
  // The stem: a band from 3.8 pt at the bottom to 1.4 pt at the top.
  const outer: Vec[] = [];
  const inner: Vec[] = [];
  for (let d = from; d <= to; d += 2) {
    const k = (d - from) / (to - from);
    const half = (3.8 - 2.4 * k) / 2;
    outer.push(onStem(d, R + half));
    inner.push(onStem(d, R - half));
  }
  const pts = [...outer, ...inner.reverse()];
  const stem = `${pts.map((p, i) => `${i ? 'L' : 'M'}${r2(p.x)} ${r2(p.y)}`).join(' ')} Z`;

  const leaves: string[] = [];
  const pairs = 9;
  const first = 11;
  const step = 15.2;
  for (let i = 0; i < pairs; i++) {
    const k = i / (pairs - 1);
    const size = 30 - 9 * k;
    // Outside the circle, leaning up and out.
    const d = first + i * step;
    const p = onStem(d, R);
    const t = (d * Math.PI) / 180;
    const along = norm({ x: -Math.cos(t), y: -Math.sin(t) });
    const out = norm({ x: -Math.sin(t), y: Math.cos(t) });
    leaves.push(leafPath(p, turn(along, out, 40), size, size * 0.48, -0.8));
    // Inside, half a step further up and shorter (they must stay clear of the QR code's square).
    const di = d + step / 2;
    const q = onStem(di, R);
    const ti = (di * Math.PI) / 180;
    const alongI = norm({ x: -Math.cos(ti), y: -Math.sin(ti) });
    const outI = norm({ x: -Math.sin(ti), y: Math.cos(ti) });
    leaves.push(leafPath(q, turn(alongI, { x: -outI.x, y: -outI.y }, 36), size * 0.8, size * 0.42, 0.6));
  }
  // The tip: one leaf along the stem.
  const tip = onStem(to, R);
  const tt = (to * Math.PI) / 180;
  leaves.push(leafPath(tip, norm({ x: -Math.cos(tt), y: -Math.sin(tt) }), 22, 8.4, 0));
  return { stem, leaves };
}

/** The same path mirrored across the wreath's centre line (the right branch). */
function mirror(path: string): string {
  return path.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_m, x: string, y: string) => `${r2(2 * CERT_WREATH_AT.cx - Number(x))} ${y}`);
}

/** The laurel wreath in brand red: two branches, each a tapering stem with leaves on both sides, meeting at the bottom. */
export const CERT_WREATH: { color: string; paths: readonly string[] } = (() => {
  const left = leftBranch();
  const paths = [left.stem, ...left.leaves];
  return { color: CERT_COLORS.red, paths: [...paths, ...paths.map(mirror)] };
})();

/**
 * Where the words go (points; baselines from the top of the page). The column on the left starts at `x`; everything
 * under the heading moves up and shrinks together when a certificate has more to say than fits (see the PDF's fitting).
 */
export const CERT_TEXT = {
  x: 63,
  /** Words on the left end before the wreath and the panels. */
  right: 505,
  logo: { x: 72, top: 40, width: 150, height: 58 },
  heading: { baseline: 151, size: 60 },
  subheading: { baseline: 191, size: 35, spacing: 2.2 },
  certifies: { baseline: 228, size: 12, spacing: 4.5 },
  name: { baseline: 293, size: 66, x: 58 },
  completed: { baseline: 331, size: 15, spacing: 0.9 },
  course: { baseline: 375, size: 31, min: 20 },
  company: { gap: 41, size: 15 },
  through: { gap: 18, size: 12 },
  rule: { gap: 19, width: 400 },
  rows: { gap: 30, pitch: 23.5, size: 12.5, valueX: 240 },
  /** The last line's baseline stays above this. */
  bottom: 566,
} as const;

/** A detail row: what it is and its value. */
export interface CertRow {
  key: 'completed' | 'issued' | 'score' | 'expires' | 'revoked' | 'reason' | 'code' | 'issuer';
  label: string;
  value: string;
}

export type CertStatus = 'VALID' | 'EXPIRED' | 'REVOKED';

/** What the detail rows are made from (dates as the caller keeps them; `day` turns one into "3 Nov 2026"). */
export interface CertFacts<D> {
  code: string;
  completedAt: D;
  issuedAt: D;
  expiresAt: D | null;
  scorePct: number | null;
  issuerName: string | null;
  issuerTitle: string | null;
  status: CertStatus;
  revokedAt?: D | null;
  revokedReason?: string | null;
}

/**
 * The detail rows, in order: Completed and issued (or Completed, then Issued when that was another day); Quiz score when
 * the course has quizzes; Expires (a day, or Never; Expired on once it has); Revoked on and Reason when revoked; the
 * Certificate ID; Issued by (name, title) when a course has an issuer.
 */
export function certificateRows<D>(c: CertFacts<D>, day: (at: D) => string): CertRow[] {
  const rows: CertRow[] = [];
  const completed = day(c.completedAt);
  const issued = day(c.issuedAt);
  if (completed === issued) rows.push({ key: 'completed', label: 'Completed and issued', value: completed });
  else rows.push({ key: 'completed', label: 'Completed', value: completed }, { key: 'issued', label: 'Issued', value: issued });
  if (c.scorePct !== null && c.scorePct !== undefined) rows.push({ key: 'score', label: 'Quiz score', value: `${c.scorePct}%` });
  if (c.status === 'EXPIRED' && c.expiresAt) rows.push({ key: 'expires', label: 'Expired on', value: day(c.expiresAt) });
  else rows.push({ key: 'expires', label: 'Expires', value: c.expiresAt ? day(c.expiresAt) : 'Never' });
  if (c.status === 'REVOKED') {
    if (c.revokedAt) rows.push({ key: 'revoked', label: 'Revoked on', value: day(c.revokedAt) });
    const reason = c.revokedReason?.trim();
    if (reason) rows.push({ key: 'reason', label: 'Reason', value: reason });
  }
  rows.push({ key: 'code', label: 'Certificate ID', value: c.code });
  const issuer = c.issuerName?.trim();
  if (issuer) rows.push({ key: 'issuer', label: 'Issued by', value: c.issuerTitle?.trim() ? `${issuer}, ${c.issuerTitle.trim()}` : issuer });
  return rows;
}

/** The large faint stamp across an expired or revoked certificate (null while it is valid). */
export function certificateStamp(status: CertStatus): { text: string; color: string } | null {
  if (status === 'REVOKED') return { text: 'REVOKED', color: CERT_COLORS.red };
  if (status === 'EXPIRED') return { text: 'EXPIRED', color: '#57534E' };
  return null;
}

/** The stamp's place: centred on the words, turned 18° (rising to the right). */
export const CERT_STAMP = { cx: 330, cy: 372, angle: -18, size: 92, opacity: 0.13 } as const;

/** Arabic letters in a name: it is set in Noto Naskh Arabic (a script font has none). */
export function hasArabicLetters(text: string): boolean {
  return /[؀-ۿݐ-ݿࡰ-ࣿﭐ-﷿ﹰ-﻿]/.test(text);
}
