import { describe, it, expect } from 'vitest';
import { MAX_TERMS, escapeLike, parseTaskQuery } from './task-search-query';

describe('parseTaskQuery — what a task search looks for', () => {
  it('splits words, case-folded, with extra spaces dropped', () => {
    expect(parseTaskQuery('  Scaff   PERMIT ').terms).toEqual(['scaff', 'permit']);
  });

  it('keeps a "quoted phrase" as one term', () => {
    expect(parseTaskQuery('"The  Scaffold" permit').terms).toEqual(['the scaffold', 'permit']);
  });

  it('reads the curly quotes phones type as quotes too', () => {
    expect(parseTaskQuery('“scaffold permit” rig').terms).toEqual(['scaffold permit', 'rig']);
    expect(parseTaskQuery('«تصريح العمل»').terms).toEqual(['تصريح العمل']);
  });

  it('reads an unclosed quote as plain words (the phrase is still being typed)', () => {
    expect(parseTaskQuery('"scaffold per').terms).toEqual(['scaffold', 'per']);
  });

  it('ignores empty quotes and a query of only spaces', () => {
    expect(parseTaskQuery('""').terms).toEqual([]);
    expect(parseTaskQuery('   ').terms).toEqual([]);
    expect(parseTaskQuery('').terms).toEqual([]);
  });

  it('normalises Arabic letter forms and drops diacritics', () => {
    expect(parseTaskQuery('إدارة').terms).toEqual(['اداره']);
    expect(parseTaskQuery('أحمد آمال مستشفى').terms).toEqual(['احمد', 'امال', 'مستشفي']);
    expect(parseTaskQuery('مُدِير').terms).toEqual(['مدير']);
  });

  it('drops repeated words and keeps at most MAX_TERMS', () => {
    expect(parseTaskQuery('rig RIG rig').terms).toEqual(['rig']);
    const many = Array.from({ length: MAX_TERMS + 5 }, (_, i) => `w${i}`).join(' ');
    expect(parseTaskQuery(many).terms).toHaveLength(MAX_TERMS);
  });

  it('gives the whole query normalised, for an exact task key ("RIG-4")', () => {
    expect(parseTaskQuery(' RIG-4 ').whole).toBe('rig-4');
    expect(parseTaskQuery('"RIG-4"').whole).toBe('rig-4');
  });
});

describe('escapeLike', () => {
  it('escapes the LIKE wildcards and the escape character itself', () => {
    expect(escapeLike('50%_a\\b')).toBe('50\\%\\_a\\\\b');
    expect(escapeLike('plain')).toBe('plain');
  });
});
