import { describe, it, expect } from 'vitest';
import { hasWeb, loadWebTs, readWeb } from '../testing/web-source';
import { websiteSays } from '../testing/phone-words';
import {
  EXPORT_MAX,
  LINE_WIDTH,
  SIGN_WORDS,
  appendPoint,
  exportSize,
  hasInk,
  inkPathD,
  pathOf,
  pngDataUrl,
  signatureInputs,
  signatureProblem,
  toPadPoint,
  type PadPoint,
  type SignatureValue,
} from './signature-ink';
import { SIGNATURE_COLORS } from './theme';

/** Finger signatures (Stage 4 Task 8, Review Focus 4). */

const POINTS: Array<[number, number, { left: number; top: number; width: number; height: number }]> = [
  [10, 20, { left: 0, top: 0, width: 300, height: 120 }],
  [-5, 500, { left: 0, top: 0, width: 300, height: 120 }],
  [150, 60, { left: 10, top: 10, width: 0, height: 0 }],
  [Number.NaN, 3, { left: 0, top: 0, width: 300, height: 120 }],
];
const STROKES: PadPoint[][] = [[], [{ x: 0.5, y: 0.5 }], [{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }, { x: 0.6, y: 0.5 }]];
const VALUES: Array<[SignatureValue | null, boolean]> = [
  [null, true],
  [null, false],
  [{ method: 'DRAWN', name: 'Ann', image: null }, true],
  [{ method: 'DRAWN', name: 'Ann', image: null }, false],
  [{ method: 'DRAWN', name: ' ', image: 'data:image/png;base64,AA==' }, true],
  [{ method: 'TYPED', name: 'Ann', image: null }, true],
  [{ method: 'TYPED', name: '', image: null }, false],
];

describe.skipIf(!hasWeb('frontend/src/components/inspections/signature-ink.ts', 'frontend/src/components/inspections/SignaturePad.tsx', 'frontend/src/components/inspections/SignFinishDialog.tsx'))('the website’s signature ink', () => {
  it('works points, strokes, sizes and problems out the same way', () => {
    type Fn = (...a: never[]) => unknown;
    const web = loadWebTs('frontend/src/components/inspections/signature-ink.ts') as { toPadPoint: Fn; exportSize: Fn; pathOf: Fn; hasInk: Fn; appendPoint: Fn; signatureProblem: Fn; EXPORT_MAX: unknown; LINE_WIDTH: number; INK: string; PAPER: string };
    expect(EXPORT_MAX).toEqual(web.EXPORT_MAX);
    expect(LINE_WIDTH).toBe(web.LINE_WIDTH);
    expect([SIGNATURE_COLORS.ink, SIGNATURE_COLORS.paper]).toEqual([web.INK, web.PAPER]);
    for (const [a, b, r] of POINTS) expect(toPadPoint(a, b, r)).toEqual(web.toPadPoint(a as never, b as never, r as never));
    for (const [w, h] of [[300, 120], [1200, 300], [0, 0]]) expect(exportSize(w!, h!)).toEqual(web.exportSize(w as never, h as never));
    for (const s of STROKES) expect(pathOf(s, 300, 100)).toEqual(web.pathOf(s as never, 300 as never, 100 as never));
    for (const s of STROKES) expect(hasInk([{ points: s }])).toBe(web.hasInk([{ points: s }] as never));
    const size = { width: 300, height: 100 };
    expect(appendPoint([{ x: 0.1, y: 0.1 }], { x: 0.1005, y: 0.1 }, size)).toEqual(web.appendPoint([{ x: 0.1, y: 0.1 }] as never, { x: 0.1005, y: 0.1 } as never, size as never));
    expect(appendPoint([{ x: 0.1, y: 0.1 }], { x: 0.2, y: 0.1 }, size)).toEqual(web.appendPoint([{ x: 0.1, y: 0.1 }] as never, { x: 0.2, y: 0.1 } as never, size as never));
    for (const [v, req] of VALUES) expect(signatureProblem(v, req)).toBe(web.signatureProblem(v as never, req as never));
  });
  it('the pad’s guide and hint colours are the website’s', () => {
    const pad = readWeb('frontend/src/components/inspections/SignaturePad.tsx');
    expect(pad).toContain(`const GUIDE = '${SIGNATURE_COLORS.guide}';`);
    expect(pad).toContain(`color: '${SIGNATURE_COLORS.hint}'`);
  });
  it('every word is the website’s (the phone says “finger”, not “mouse”)', () => {
    const web = ['SignaturePad.tsx', 'SignFinishDialog.tsx'].map((f) => readWeb(`frontend/src/components/inspections/${f}`));
    for (const [k, w] of Object.entries(SIGN_WORDS)) expect(websiteSays(web, w), k).toBe(true);
    expect(SIGN_WORDS.hint).toBe('Draw with your finger. Or type your name instead.');
  });
});

it('a drawn signature becomes the PNG data URL the server reads, Android’s line breaks removed (Review Focus 4)', () => {
  expect(pngDataUrl('iVBORw0K\nGgoAAAA\r\nNSUhEUg==')).toBe('data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==');
  expect(pngDataUrl('iVBORw0KGgo=')).toMatch(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/);
  expect(pngDataUrl(' iVBO RwKG\tgo= \n')).toBe('data:image/png;base64,iVBORwKGgo=');
});

describe.skipIf(!hasWeb('backend/src/modules/inspections/inspection-service.ts'))('the server', () => {
  it('reads drawn signatures with that pattern', () => expect(readWeb('backend/src/modules/inspections/inspection-service.ts')).toContain(String.raw`/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/`));
});

it('signing: the inspector always, the others when the form asks; one time for all', () => {
  const at = '2026-10-30T08:00:00.000Z';
  expect(signatureInputs([{ role: 'INSPECTOR', required: true, value: null }], at)).toEqual({ ok: false, role: 'INSPECTOR', problem: 'Sign here, or tick “Type my name instead”.' });
  expect(signatureInputs([{ role: 'INSPECTOR', required: true, value: { method: 'TYPED', name: ' Ann Lee ', image: null } }, { role: 'CLIENT', required: false, value: null }], at)).toEqual({ ok: true, signatures: [{ role: 'INSPECTOR', name: 'Ann Lee', method: 'TYPED', signedAt: at }] });
  expect(
    signatureInputs(
      [
        { role: 'INSPECTOR', required: true, value: { method: 'DRAWN', name: 'Ann Lee', image: 'data:image/png;base64,AA==' } },
        { role: 'SUPERVISOR', required: true, value: { method: 'TYPED', name: ' ', image: null } },
      ],
      at,
    ),
  ).toEqual({ ok: false, role: 'SUPERVISOR', problem: 'Type the signer’s name.' });
  expect(signatureInputs([{ role: 'INSPECTOR', required: true, value: { method: 'DRAWN', name: 'Ann Lee', image: 'data:image/png;base64,AA==' } }], at)).toEqual({
    ok: true,
    signatures: [{ role: 'INSPECTOR', name: 'Ann Lee', method: 'DRAWN', image: 'data:image/png;base64,AA==', signedAt: at }],
  });
});

it('a stroke as an SVG path: two decimals, no trailing zeros; a dot is drawn as a circle', () => {
  expect(inkPathD({ kind: 'line', start: { x: 1, y: 2 }, segments: [{ cx: 1, cy: 2, x: 3.333, y: 4 }] })).toBe('M1 2 Q1 2 3.33 4');
  expect(inkPathD({ kind: 'line', start: { x: 0.5, y: 10.1 }, segments: [{ cx: 0.5, cy: 10.1, x: 2.006, y: 3.1 }, { cx: 4, cy: 5, x: 4, y: 5 }] })).toBe('M0.5 10.1 Q0.5 10.1 2.01 3.1 Q4 5 4 5');
  expect(inkPathD({ kind: 'dot', x: 3, y: 4 })).toBe('');
});
