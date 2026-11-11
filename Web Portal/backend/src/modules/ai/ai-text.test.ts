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
