import { describe, it, expect } from 'vitest';
import { cutChars, wellFormed } from './ai-text';

describe('ai-text', () => {
  it('cutChars never ends on half an emoji', () => {
    expect(cutChars('ab😀', 3)).toBe('ab');
    expect(cutChars('ab😀', 4)).toBe('ab😀');
    expect(cutChars('abcdef', 3)).toBe('abc');
    expect(cutChars('😀', 1)).toBe('');
  });

  it('wellFormed replaces a lone half and keeps whole pairs (Arabic and emoji intact)', () => {
    expect(wellFormed('a\ud83d')).toBe('a�');
    expect(wellFormed('\ude00b')).toBe('�b');
    expect(wellFormed('مضخة 😀')).toBe('مضخة 😀');
    expect(JSON.stringify(wellFormed('x\ud83d'))).not.toContain('\\ud83d');
  });
});

describe('wellFormed: NUL (MICO360 Connect 2.6.30 refuses U+0000 with 400)', () => {
  it('takes out every NUL character, keeping the rest of the text', () => {
    expect(wellFormed('Pump\u0000 report\u0000\u0000 2026')).toBe('Pump report 2026');
  });
  it('leaves other text and a well-formed emoji as they were', () => {
    expect(wellFormed('Site 😀 check\ttab\nline')).toBe('Site 😀 check\ttab\nline');
  });
});
