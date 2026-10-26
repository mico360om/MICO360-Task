import { describe, it, expect } from 'vitest';
import { highlightNames } from './name-highlight';

const NAMES = ['Sara Al Balushi', 'Bilal Ahmed', 'Bilal', 'Sara', 'سارة'];

describe('highlightNames', () => {
  it('marks every whole name, any case, longest first', () => {
    expect(highlightNames('Agreed with sara al balushi and BILAL.', NAMES)).toEqual([
      { text: 'Agreed with ', name: false },
      { text: 'sara al balushi', name: true },
      { text: ' and ', name: false },
      { text: 'BILAL', name: true },
      { text: '.', name: false },
    ]);
  });

  it('never marks part of a longer word', () => {
    expect(highlightNames('Bilalco supplies and Sarasota', NAMES)).toEqual([{ text: 'Bilalco supplies and Sarasota', name: false }]);
  });

  it('marks Arabic names too', () => {
    expect(highlightNames('اتفقنا مع سارة اليوم', NAMES)).toEqual([
      { text: 'اتفقنا مع ', name: false },
      { text: 'سارة', name: true },
      { text: ' اليوم', name: false },
    ]);
  });

  it('leaves text without names (or no names to look for) as one plain piece', () => {
    expect(highlightNames('Nothing here.', NAMES)).toEqual([{ text: 'Nothing here.', name: false }]);
    expect(highlightNames('Bilal', [])).toEqual([{ text: 'Bilal', name: false }]);
    expect(highlightNames('', NAMES)).toEqual([]);
  });

  it('treats names as text, not patterns', () => {
    expect(highlightNames('Ask (A.B.) today', ['(A.B.)'])).toEqual([
      { text: 'Ask ', name: false },
      { text: '(A.B.)', name: true },
      { text: ' today', name: false },
    ]);
  });
});
