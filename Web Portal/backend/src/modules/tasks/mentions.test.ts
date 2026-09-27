import { describe, it, expect } from 'vitest';
import { matchMentions, parseMentions } from './mentions';

describe('parseMentions (loose)', () => {
  it('keeps dots, hyphens and non-Latin letters inside a name, and drops trailing punctuation', () => {
    expect(parseMentions('hi @ahmed.ali, and @sara-k.')).toEqual(['ahmed.ali', 'sara-k']);
    expect(parseMentions('شكراً @أحمد')).toEqual(['أحمد']);
  });
  it('ignores an @ inside a word or an email address', () => {
    expect(parseMentions('mail me at omar@mico.om')).toEqual([]);
  });
});

describe('matchMentions (against real usernames)', () => {
  const users = ['ahmed', 'ahmed.ali', 'mico', 'sara-k', 'أحمد', 'Omar'];

  it('prefers the longest username: "@ahmed.ali" is not a mention of "ahmed"', () => {
    expect(matchMentions('ping @ahmed.ali please', users)).toEqual(['ahmed.ali']);
    expect(matchMentions('ping @ahmed please', users)).toEqual(['ahmed']);
  });

  it('only matches at a word boundary', () => {
    expect(matchMentions('@ahmedx and @ahmed_1', users)).toEqual([]);
    expect(matchMentions('thanks @ahmed.', users)).toEqual(['ahmed']); // sentence punctuation
    expect(matchMentions('see @ahmed.bob', ['ahmed'])).toEqual([]); // a different, longer name
  });

  it('never treats an email address as a mention', () => {
    expect(matchMentions('write to sales@mico.om', users)).toEqual([]);
  });

  it('matches Arabic usernames, hyphens, and is case-insensitive', () => {
    expect(matchMentions('مرحبا @أحمد، شكراً', users)).toEqual(['أحمد']);
    expect(matchMentions('cc @sara-k @OMAR', users)).toEqual(['sara-k', 'Omar']);
  });

  it('ignores names that are not in the list (e.g. people without access)', () => {
    expect(matchMentions('hey @stranger', users)).toEqual([]);
  });
});
