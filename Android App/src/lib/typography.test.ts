import { describe, it, expect } from 'vitest';
import { typeStyle, typeScale, fontFamilies, type TypeRole } from './typography';

describe('typography', () => {
  it('provides a style for every role with a positive size and a line height >= size', () => {
    const roles: TypeRole[] = ['display', 'title', 'heading', 'subheading', 'body', 'bodyStrong', 'label', 'caption'];
    for (const r of roles) {
      const s = typeScale[r];
      expect(s.fontSize).toBeGreaterThan(0);
      expect(s.lineHeight).toBeGreaterThanOrEqual(s.fontSize);
    }
  });

  it('orders the scale from display (largest) down to caption (smallest)', () => {
    expect(typeScale.display.fontSize).toBeGreaterThan(typeScale.title.fontSize);
    expect(typeScale.title.fontSize).toBeGreaterThan(typeScale.heading.fontSize);
    expect(typeScale.body.fontSize).toBeGreaterThan(typeScale.caption.fontSize);
  });

  it('maps titles/headings to the display face and body/labels to the body face', () => {
    expect(typeScale.title.family).toBe('display');
    expect(typeScale.heading.family).toBe('display');
    expect(typeScale.body.family).toBe('body');
    expect(typeScale.label.family).toBe('body');
  });

  it('omits fontFamily by default (system font) and applies the brand face when loaded', () => {
    const sys = typeStyle('title');
    expect(sys.fontFamily).toBeUndefined();
    expect(sys.fontWeight).toBe('700');

    const branded = typeStyle('title', { brandFonts: true });
    expect(branded.fontFamily).toBe(fontFamilies.display);

    const brandedBody = typeStyle('body', { brandFonts: true });
    expect(brandedBody.fontFamily).toBe(fontFamilies.body);
  });

  it('carries letterSpacing only where the scale defines it', () => {
    expect(typeStyle('display').letterSpacing).toBe(-0.5);
    expect(typeStyle('heading').letterSpacing).toBeUndefined();
  });
});
