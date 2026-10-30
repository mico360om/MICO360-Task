import { describe, it, expect, afterEach } from 'vitest';
import { FONT_FACES, font, fontFamilyFor, setBrandFaces, typeStyle, type FontWeight, type TypeRole } from './typography';

// Final review L4: when the brand fonts didn't load (an error, or 3 s without them), styles name the
// weight for the phone's own font instead of a face it doesn't have — headings stay bold.
describe('on the phone’s fonts (the brand faces did not load)', () => {
  afterEach(() => setBrandFaces(true));
  it('font() and typeStyle() give the weight, not a missing face', () => {
    setBrandFaces(false);
    expect(font('700')).toEqual({ fontWeight: '700' });
    expect(font('bold')).toEqual({ fontWeight: '700' });
    expect(font('600', 'display')).toEqual({ fontWeight: '600' });
    expect(typeStyle('title')).toEqual({ fontWeight: '800', fontSize: 22, lineHeight: 28, letterSpacing: -0.2 });
    expect(typeStyle('body')).toEqual({ fontWeight: '400', fontSize: 14, lineHeight: 20 });
    expect(typeStyle('eyebrow')).toMatchObject({ fontWeight: '600', textTransform: 'uppercase' });
    expect(typeStyle('title')).not.toHaveProperty('fontFamily');
  });
  it('back on the brand faces, the face again and no weight', () => {
    setBrandFaces(false);
    setBrandFaces(true);
    expect(font('700')).toEqual({ fontFamily: 'IBMPlexSans-Bold' });
    expect(typeStyle('title')).not.toHaveProperty('fontWeight');
  });
});

const ROLES: TypeRole[] = ['display', 'title', 'heading', 'subheading', 'body', 'bodyStrong', 'label', 'caption', 'eyebrow', 'badge', 'button', 'tab', 'number'];

describe('typography', () => {
  it('every role has the website type scale on the loaded faces, never a fontWeight', () => {
    expect(typeStyle('body')).toEqual({ fontFamily: 'IBMPlexSans-Regular', fontSize: 14, lineHeight: 20 });
    expect(typeStyle('title')).toMatchObject({ fontFamily: 'Archivo-ExtraBold', fontSize: 22, lineHeight: 28 });
    expect(typeStyle('display')).toMatchObject({ fontFamily: 'Archivo-ExtraBold', fontSize: 30, fontVariant: ['tabular-nums'] });
    expect(typeStyle('eyebrow')).toMatchObject({ fontFamily: 'IBMPlexSans-SemiBold', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.55 });
    expect(typeStyle('number').fontVariant).toEqual(['tabular-nums']);
    for (const r of ROLES) expect(typeStyle(r)).not.toHaveProperty('fontWeight');
  });

  it('the whole scale, role by role', () => {
    expect(Object.fromEntries(ROLES.map((r) => [r, typeStyle(r)]))).toEqual({
      display: { fontFamily: 'Archivo-ExtraBold', fontSize: 30, lineHeight: 36, letterSpacing: -0.3, fontVariant: ['tabular-nums'] },
      title: { fontFamily: 'Archivo-ExtraBold', fontSize: 22, lineHeight: 28, letterSpacing: -0.2 },
      heading: { fontFamily: 'Archivo-Bold', fontSize: 18, lineHeight: 24 },
      subheading: { fontFamily: 'IBMPlexSans-SemiBold', fontSize: 15, lineHeight: 20 },
      body: { fontFamily: 'IBMPlexSans-Regular', fontSize: 14, lineHeight: 20 },
      bodyStrong: { fontFamily: 'IBMPlexSans-SemiBold', fontSize: 14, lineHeight: 20 },
      label: { fontFamily: 'IBMPlexSans-Medium', fontSize: 14, lineHeight: 20 },
      caption: { fontFamily: 'IBMPlexSans-Regular', fontSize: 12, lineHeight: 16 },
      eyebrow: { fontFamily: 'IBMPlexSans-SemiBold', fontSize: 11, lineHeight: 14, textTransform: 'uppercase', letterSpacing: 0.55 },
      badge: { fontFamily: 'IBMPlexSans-SemiBold', fontSize: 11, lineHeight: 14, textTransform: 'uppercase', letterSpacing: 0.3 },
      button: { fontFamily: 'IBMPlexSans-SemiBold', fontSize: 14, lineHeight: 20 },
      tab: { fontFamily: 'IBMPlexSans-SemiBold', fontSize: 11, lineHeight: 14 },
      number: { fontFamily: 'IBMPlexSans-SemiBold', fontSize: 14, lineHeight: 20, fontVariant: ['tabular-nums'] },
    });
  });

  it('font() and fontFamilyFor() pick the nearest bundled face', () => {
    expect(font('700')).toEqual({ fontFamily: 'IBMPlexSans-Bold' });
    expect(font('bold')).toEqual({ fontFamily: 'IBMPlexSans-Bold' });
    expect(font('normal')).toEqual({ fontFamily: 'IBMPlexSans-Regular' });
    expect(font('800', 'display')).toEqual({ fontFamily: 'Archivo-ExtraBold' });
    expect(fontFamilyFor('display', '400')).toBe('Archivo-SemiBold');
    expect(fontFamilyFor('body', '900')).toBe('IBMPlexSans-Bold');
  });

  it('every weight of both families lands on a bundled face of that family', () => {
    const weights: FontWeight[] = ['400', '500', '600', '700', '800', '900'];
    expect(weights.map((w) => fontFamilyFor('body', w))).toEqual(['IBMPlexSans-Regular', 'IBMPlexSans-Medium', 'IBMPlexSans-SemiBold', 'IBMPlexSans-Bold', 'IBMPlexSans-Bold', 'IBMPlexSans-Bold']);
    expect(weights.map((w) => fontFamilyFor('display', w))).toEqual(['Archivo-SemiBold', 'Archivo-SemiBold', 'Archivo-SemiBold', 'Archivo-Bold', 'Archivo-ExtraBold', 'Archivo-Black']);
    for (const [face, { family, weight }] of Object.entries(FONT_FACES)) expect(fontFamilyFor(family, weight), face).toBe(face);
  });
});
