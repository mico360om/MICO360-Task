import { describe, it, expect } from 'vitest';
import * as fontkit from 'fontkit';
import { fontData, isolate, layoutText, measureText, sanitizeText, shapingFeatures, textDirection } from './pdf-text';

const seg = (text: string, maxWidth?: number) => layoutText(text, { size: 10, maxWidth });

describe('pdf-text: fonts and shaping', () => {
  it('loads the brand fonts — IBM Plex Sans for text, Archivo for headings — plus Noto Naskh Arabic', () => {
    expect(fontkit.create(fontData('latin')).postscriptName).toBe('IBMPlexSans-Regular');
    expect(fontkit.create(fontData('latin-bold')).postscriptName).toBe('IBMPlexSans-SemiBold');
    expect(fontkit.create(fontData('display')).postscriptName).toBe('Archivo-Bold');
    const arabic = fontkit.create(fontData('arabic-bold'));
    expect(arabic.postscriptName).toBe('NotoNaskhArabic-Bold');
    expect(arabic.hasGlyphForCodePoint('خ'.codePointAt(0)!)).toBe(true);
  });

  it('sets headings in Archivo, keeping Arabic in Naskh and symbols Archivo lacks in Plex', () => {
    const [line] = layoutText('Report ✓ تقرير', { size: 12, bold: true, family: 'display' });
    const fonts = line!.segments.map((s) => s.font);
    expect(fonts).toContain('display');
    expect(fonts).toContain('arabic-bold');
    // Archivo has no check mark; the body font draws it.
    expect(line!.segments.find((s) => s.logical.includes('✓'))?.font).toBe('latin-bold');
  });

  it('falls back to Noto Sans for a character the brand fonts lack', () => {
    const [line] = layoutText('Ɓuilding', { size: 10 });
    expect(line!.segments[0]!.font).toBe('fallback');
  });

  it('applies Arabic contextual shaping (joined initial/medial/final forms, not isolated letters)', () => {
    const font = fontkit.create(fontData('arabic'));
    const word = 'خالد';
    const nominal = [...word].map((ch) => font.glyphForCodePoint(ch.codePointAt(0)!).id);
    const shaped = font.layout(word, shapingFeatures());
    expect(shaped.direction).toBe('rtl');
    // fontkit returns RTL runs in visual order; at least the joined letters take other glyphs
    const shapedLogical = [...shaped.glyphs].reverse().map((g) => g.id);
    expect(shapedLogical).not.toEqual(nominal);
    expect(shapedLogical[0]).not.toBe(nominal[0]); // initial form of خ
  });
});

describe('pdf-text: sanitizeText', () => {
  it('keeps Arabic and Latin, replaces undrawable characters, drops controls', () => {
    expect(sanitizeText('خالد & Ada')).toBe('خالد & Ada');
    expect(sanitizeText('ok 🎉')).toBe('ok ?');
    // IBM Plex draws arrows and check marks; heavier symbols no font has get a readable stand-in.
    expect(sanitizeText('A → B ✓')).toBe('A → B ✓');
    expect(sanitizeText('done ✔')).toBe('done v');
    expect(sanitizeText('a\tb\u0007c')).toBe('a bc');
    expect(sanitizeText('x\ufe0fy\u0085')).toBe('xy'); // variation selector and C1 control dropped
  });
});

describe('pdf-text: bidi layout', () => {
  it('detects the paragraph direction from the first strong character', () => {
    expect(textDirection('اجتماع مراجعة الميزانية')).toBe('rtl');
    expect(textDirection('Budget review')).toBe('ltr');
    expect(textDirection('10:30 الموعد')).toBe('rtl');
    // isolated fragments are skipped when finding the paragraph direction (UAX #9 P2)
    expect(textDirection(`${isolate('خالد')} joined`)).toBe('ltr');
  });

  it('orders a mixed Arabic/English/number line right-to-left with each run intact', () => {
    const [line] = seg('الموعد 10:30 in Room B');
    expect(line!.rtl).toBe(true);
    // visual order, left to right: the English run, the time, then the Arabic word at the right
    expect(line!.segments.map((s) => s.logical)).toEqual(['in Room B', ' ', '10:30', 'الموعد ']);
    expect(line!.segments.map((s) => s.font)).toEqual(['latin', 'arabic', 'latin', 'arabic']);
    expect(line!.segments.map((s) => s.rtl)).toEqual([false, true, false, true]);
    expect(line!.text).toBe('الموعد 10:30 in Room B');
  });

  it('keeps an Arabic phrase inside an English sentence in place and reversed as a unit', () => {
    const [line] = seg('Send to وزارة المالية today');
    expect(line!.rtl).toBe(false);
    expect(line!.segments.map((s) => s.logical)).toEqual(['Send to ', 'وزارة المالية', ' today']);
  });

  it('hands fontkit logical order for Arabic runs (it reverses them itself)', () => {
    const [line] = seg('خالد البلوشي');
    expect(line!.segments).toHaveLength(1);
    expect(line!.segments[0]!.draw).toBe('خالد البلوشي');
  });

  it('pre-reverses right-to-left runs that fontkit would not reverse (neutral punctuation)', () => {
    const [line] = seg('مرحبا in Room B!?');
    const last = line!.segments[0]!; // the trailing "!?" sits at the far left in an RTL paragraph
    expect(last.logical).toBe('!?');
    expect(last.draw).toBe('?!');
  });

  it('keeps Arabic-Indic digits in reading order inside right-to-left text', () => {
    const [line] = seg('الأرقام: ١٢٣٤ و 5678');
    const digits = line!.segments.find((s) => s.logical === '١٢٣٤')!;
    expect(digits.rtl).toBe(false);
    // fontkit would reverse an Arabic-script run, so the string handed to it is pre-reversed
    expect(digits.draw).toBe('٤٣٢١');
    expect(line!.segments.map((s) => s.logical)).toEqual(['5678', ' و ', '١٢٣٤', 'الأرقام: ']);
  });

  it('mirrors brackets in right-to-left runs', () => {
    const [line] = seg('(ملاحظة) مهمة');
    expect(line!.segments).toHaveLength(1);
    expect(line!.segments[0]!.logical).toBe(')ملاحظة( مهمة');
  });

  it('strips bidi control characters from the drawn text and the logical line text', () => {
    const [line] = seg(`${isolate('خالد')} · Oct 1`);
    expect(line!.text).toBe('خالد · Oct 1');
    const isolateControl = (c: string) => c.charCodeAt(0) >= 0x2066 && c.charCodeAt(0) <= 0x2069;
    expect(line!.segments.every((s) => ![...s.draw].some(isolateControl))).toBe(true);
  });
});

describe('pdf-text: wrapping and measuring', () => {
  it('wraps a long Arabic paragraph within the width without losing words', () => {
    const text = 'ناقش الفريق خطة التوظيف للعام القادم وتم الاتفاق على مراجعة الأرقام مع قسم الموارد البشرية قبل نهاية الشهر '.repeat(4).trim();
    const lines = seg(text, 200);
    expect(lines.length).toBeGreaterThan(3);
    for (const l of lines) {
      expect(l.width).toBeLessThanOrEqual(200.01);
      expect(l.rtl).toBe(true);
    }
    expect(lines.map((l) => l.text).join(' ')).toBe(text);
  });

  it('hard-breaks a single token wider than the line', () => {
    const lines = seg('x'.repeat(400), 150);
    expect(lines.length).toBeGreaterThan(2);
    for (const l of lines) expect(l.width).toBeLessThanOrEqual(150.01);
    expect(lines.map((l) => l.text).join('')).toBe('x'.repeat(400));
  });

  it('keeps blank lines between paragraphs', () => {
    expect(seg('one\n\ntwo').map((l) => l.text)).toEqual(['one', '', 'two']);
  });

  it('measures bold wider than regular and Arabic with real shaped advances', () => {
    expect(measureText('Meeting', 12, true)).toBeGreaterThan(measureText('Meeting', 12, false));
    expect(measureText('اجتماع', 12)).toBeGreaterThan(0);
    expect(measureText('اجتماع اجتماع', 12)).toBeGreaterThan(measureText('اجتماع', 12) * 2);
  });
});
