import { describe, it, expect } from 'vitest';
import { appendPoint, drawStrokes, exportSize, hasInk, INK, pathOf, signatureProblem, toPadPoint, type InkContext, type Stroke } from './signature-ink';

describe('toPadPoint: where on the pad a pointer is (0–1 across and down)', () => {
  const rect = { left: 10, top: 20, width: 200, height: 100 };
  it('measures from the pad’s corner', () => {
    expect(toPadPoint(110, 70, rect)).toEqual({ x: 0.5, y: 0.5 });
    expect(toPadPoint(10, 20, rect)).toEqual({ x: 0, y: 0 });
  });
  it('keeps a point dragged off the pad on its edge', () => {
    expect(toPadPoint(-50, 500, rect)).toEqual({ x: 0, y: 1 });
  });
  it('never divides by a zero size (a pad not laid out yet)', () => {
    expect(toPadPoint(5, 5, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 1, y: 1 });
  });
});

describe('appendPoint', () => {
  const size = { width: 300, height: 150 };
  it('adds a point that moved far enough', () => {
    expect(appendPoint([{ x: 0, y: 0 }], { x: 0.1, y: 0 }, size)).toEqual([{ x: 0, y: 0 }, { x: 0.1, y: 0 }]);
  });
  it('skips a point less than half a pixel from the last one (jitter)', () => {
    const pts = [{ x: 0.5, y: 0.5 }];
    expect(appendPoint(pts, { x: 0.5 + 0.1 / 300, y: 0.5 }, size)).toBe(pts);
  });
  it('starts a stroke from nothing', () => {
    expect(appendPoint([], { x: 0.2, y: 0.3 }, size)).toEqual([{ x: 0.2, y: 0.3 }]);
  });
});

describe('hasInk', () => {
  it('is false for no strokes or only empty ones, true once a point is drawn (a tap is a dot)', () => {
    expect(hasInk([])).toBe(false);
    expect(hasInk([{ points: [] }])).toBe(false);
    expect(hasInk([{ points: [{ x: 0.1, y: 0.1 }] }])).toBe(true);
  });
});

describe('exportSize: the stored picture stays small', () => {
  it('fits inside 600×200, keeping the pad’s shape', () => {
    expect(exportSize(343, 176)).toEqual({ width: 343, height: 176 });
    expect(exportSize(900, 180)).toEqual({ width: 600, height: 120 });
    expect(exportSize(300, 300)).toEqual({ width: 200, height: 200 });
  });
  it('has a sane size before the pad is laid out', () => {
    expect(exportSize(0, 0)).toEqual({ width: 600, height: 200 });
  });
});

describe('pathOf: a smooth line through the points', () => {
  it('is a dot for a single point', () => {
    expect(pathOf([{ x: 0.5, y: 0.5 }], 100, 50)).toEqual({ kind: 'dot', x: 50, y: 25 });
  });
  it('is a straight line for two points, curves through the midpoints for more', () => {
    expect(pathOf([{ x: 0, y: 0 }, { x: 1, y: 1 }], 100, 50)).toEqual({ kind: 'line', start: { x: 0, y: 0 }, segments: [{ cx: 0, cy: 0, x: 50, y: 25 }, { cx: 100, cy: 50, x: 100, y: 50 }] });
    const p = pathOf([{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 1, y: 1 }], 100, 100);
    expect(p).toEqual({
      kind: 'line',
      start: { x: 0, y: 0 },
      segments: [
        { cx: 0, cy: 0, x: 25, y: 0 },
        { cx: 50, cy: 0, x: 75, y: 50 },
        { cx: 100, cy: 100, x: 100, y: 100 },
      ],
    });
  });
});

function fakeContext() {
  const calls: string[] = [];
  const ctx: InkContext = {
    lineWidth: 0,
    lineCap: 'butt',
    lineJoin: 'miter',
    strokeStyle: '',
    fillStyle: '',
    beginPath: () => void calls.push('beginPath'),
    moveTo: (x, y) => void calls.push(`moveTo ${x},${y}`),
    quadraticCurveTo: (cx, cy, x, y) => void calls.push(`quad ${cx},${cy} ${x},${y}`),
    stroke: () => void calls.push('stroke'),
    arc: (x, y, r) => void calls.push(`arc ${x},${y} r${r}`),
    fill: () => void calls.push('fill'),
    fillRect: (x, y, w, h) => void calls.push(`fillRect ${x},${y},${w},${h}`),
    clearRect: (x, y, w, h) => void calls.push(`clearRect ${x},${y},${w},${h}`),
  };
  return { ctx, calls };
}

describe('drawStrokes', () => {
  const strokes: Stroke[] = [{ points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }, { points: [{ x: 0.5, y: 0.5 }] }];
  it('draws every stroke in dark ink, with round ends, at the given width', () => {
    const { ctx, calls } = fakeContext();
    drawStrokes(ctx, strokes, { width: 200, height: 100, lineWidth: 2.5 });
    expect(ctx.strokeStyle).toBe(INK);
    expect(ctx.lineWidth).toBe(2.5);
    expect(ctx.lineCap).toBe('round');
    expect(calls).toEqual(['clearRect 0,0,200,100', 'beginPath', 'moveTo 0,0', 'quad 0,0 100,50', 'quad 200,100 200,100', 'stroke', 'beginPath', 'arc 100,50 r1.25', 'fill']);
  });
  it('lays white paper under the ink when asked (the stored picture)', () => {
    const { ctx, calls } = fakeContext();
    drawStrokes(ctx, [], { width: 60, height: 20, lineWidth: 2, paper: '#FFFFFF' });
    expect(calls).toEqual(['fillRect 0,0,60,20']);
  });
});

describe('signatureProblem: what to tell the signer', () => {
  it('asks for a signature when one is needed, and for the name', () => {
    expect(signatureProblem(null, true)).toBe('Sign here, or tick “Type my name instead”.');
    expect(signatureProblem(null, false)).toBeNull();
    expect(signatureProblem({ method: 'DRAWN', name: '  ', image: 'data:image/png;base64,x' }, false)).toBe('Type the signer’s name.');
    expect(signatureProblem({ method: 'TYPED', name: '', image: null }, true)).toBe('Type the signer’s name.');
    expect(signatureProblem({ method: 'DRAWN', name: 'Ivan', image: null }, true)).toBe('Sign here, or tick “Type my name instead”.');
    expect(signatureProblem({ method: 'DRAWN', name: 'Ivan', image: 'data:image/png;base64,x' }, true)).toBeNull();
    expect(signatureProblem({ method: 'TYPED', name: 'Ivan', image: null }, true)).toBeNull();
  });
});
