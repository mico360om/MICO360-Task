import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { detectMention, applyMention, tokenizeMentions, suggestMentions, mentionMenu, isNameCharFallback, type MentionPerson } from './mentions';

describe('name characters on engines without \\p{…} (the Android app’s Hermes)', () => {
  it('counts letters, digits and marks in any script, and _', () => {
    for (const ch of ['a', 'Z', '5', '_', 'é', 'ß', 'أ', 'ح', '٣', 'َ', 'ж', 'α', '中', 'ア', '한']) expect(isNameCharFallback(ch), ch).toBe(true);
  });
  it('does not count spaces, punctuation or symbols', () => {
    for (const ch of [' ', ' ', '.', '-', '@', ',', '!', '(', '«', '،', '؛', '؟', '۔', '—', '…', '“', '€', '→', '、', '。', '！', '\ud83d']) expect(isNameCharFallback(ch), ch).toBe(false);
  });
  it('is only a stand-in: where the engine has \\p{…} (browsers, Node), names follow the exact Unicode classes', () => {
    // 'ª' is a letter the stand-in misses
    expect(isNameCharFallback('ª')).toBe(false);
    expect(detectMention('cc @ª', 5)).toEqual({ query: 'ª', start: 3 });
  });
  it('has no \\p{…} in a regex literal: the Android build mangles those without a word of warning', () => {
    const source = readFileSync(resolve(__dirname, 'mentions.ts'), 'utf8');
    expect(source).not.toMatch(/\/[^/\n]*\\p\{[^/\n]*\/[a-z]*u/);
  });
});

describe('detectMention', () => {
  it('detects an @mention being typed at the caret', () => {
    expect(detectMention('hi @om', 6)).toEqual({ query: 'om', start: 3 });
    expect(detectMention('@ad', 3)).toEqual({ query: 'ad', start: 0 });
  });
  it('returns null when not in an @mention', () => {
    expect(detectMention('hello world', 11)).toBeNull();
    expect(detectMention('email me@x.com', 14)).toBeNull(); // '@' not preceded by whitespace/start
    expect(detectMention('done @omar ', 11)).toBeNull(); // trailing space closes it
  });
  it('follows the server’s name rules: dots and hyphens inside a name, any script', () => {
    expect(detectMention('hi @flowa.ma', 12)).toEqual({ query: 'flowa.ma', start: 3 });
    expect(detectMention('cc @al-amri', 11)).toEqual({ query: 'al-amri', start: 3 });
    expect(detectMention('شكرا @أحم', 9)).toEqual({ query: 'أحم', start: 5 });
    expect(detectMention('(@om', 4)).toEqual({ query: 'om', start: 1 }); // after punctuation is fine
  });
  it('is not a mention when the @ is glued to a word, a dot, a hyphen or another @', () => {
    expect(detectMention('x.@om', 5)).toBeNull();
    expect(detectMention('x-@om', 5)).toBeNull();
    expect(detectMention('@@om', 4)).toBeNull();
  });
  it('only looks at the text before the caret', () => {
    expect(detectMention('hi @om there', 6)).toEqual({ query: 'om', start: 3 });
    expect(detectMention('hi @om there', 12)).toBeNull();
  });
});

describe('applyMention', () => {
  it('replaces the partial token with @username and a trailing space', () => {
    const r = applyMention('hi @om', 3, 'omar', 6);
    expect(r.text).toBe('hi @omar ');
    expect(r.caret).toBe(9);
  });
  it('keeps text after the caret intact', () => {
    const r = applyMention('hi @om there', 3, 'omar', 6);
    expect(r.text).toBe('hi @omar  there');
  });
});

describe('tokenizeMentions', () => {
  it('splits body into text and mention tokens', () => {
    const t = tokenizeMentions('hey @omar and @ada!');
    expect(t).toEqual([
      { type: 'text', value: 'hey ' },
      { type: 'mention', value: '@omar', username: 'omar' },
      { type: 'text', value: ' and ' },
      { type: 'mention', value: '@ada', username: 'ada' },
      { type: 'text', value: '!' },
    ]);
  });
  it('returns a single text token when there are no mentions', () => {
    expect(tokenizeMentions('plain text')).toEqual([{ type: 'text', value: 'plain text' }]);
  });
  it('keeps dotted names whole and leaves a sentence’s full stop outside', () => {
    expect(tokenizeMentions('ask @flowa.main.')).toEqual([
      { type: 'text', value: 'ask ' },
      { type: 'mention', value: '@flowa.main', username: 'flowa.main' },
      { type: 'text', value: '.' },
    ]);
  });
  it('never treats an email address as a mention', () => {
    expect(tokenizeMentions('mail omar@x.com')).toEqual([{ type: 'text', value: 'mail omar@x.com' }]);
  });
  it('with the real usernames, marks only those — longest name first, any case', () => {
    const names = ['ahmed', 'ahmed.ali', 'flowa.main'];
    expect(tokenizeMentions('@Ahmed.Ali and @ahmed, not @nobody', names)).toEqual([
      { type: 'mention', value: '@Ahmed.Ali', username: 'ahmed.ali' },
      { type: 'text', value: ' and ' },
      { type: 'mention', value: '@ahmed', username: 'ahmed' },
      { type: 'text', value: ', not @nobody' },
    ]);
    // "@ahmedx" is not a mention of "ahmed": a name must end at a word boundary
    expect(tokenizeMentions('@ahmedx', names)).toEqual([{ type: 'text', value: '@ahmedx' }]);
  });
});

describe('suggestMentions', () => {
  const people: MentionPerson[] = [
    { id: 'u1', username: 'omar', name: 'Omar Ahmed' },
    { id: 'u2', username: 'flowa.main', name: 'Main FLOW-A' },
    { id: 'u3', username: 'bilal', name: 'Bilal Khan' },
    { id: 'u4', username: 'flowa.pw', name: 'Pw FLOW-A' },
    { id: 'u5', username: 'sara', name: 'Sara Omari' },
  ];
  it('lists everyone (up to the limit) for a bare @', () => {
    expect(suggestMentions(people, '').map((p) => p.username)).toEqual(['omar', 'flowa.main', 'bilal', 'flowa.pw', 'sara']);
    expect(suggestMentions(people, '', 2)).toHaveLength(2);
  });
  it('matches the username or the name, ignoring case', () => {
    expect(suggestMentions(people, 'FL').map((p) => p.username)).toEqual(['flowa.main', 'flowa.pw']);
    expect(suggestMentions(people, 'khan').map((p) => p.username)).toEqual(['bilal']);
    expect(suggestMentions(people, 'zz')).toEqual([]);
  });
  it('puts names that start with what was typed before ones that merely contain it', () => {
    // "omar" starts with "om"; "Sara Omari" has a word starting with it — both before mere contains
    expect(suggestMentions(people, 'om').map((p) => p.username)).toEqual(['omar', 'sara']);
    expect(suggestMentions(people, 'ma').map((p) => p.username)).toEqual(['flowa.main', 'omar', 'sara']);
  });
});

describe('mentionMenu', () => {
  const people: MentionPerson[] = [
    { id: 'u1', username: 'omar', name: 'Omar Ahmed' },
    { id: 'u2', username: 'flowa.main', name: 'Main FLOW-A' },
  ];
  it('is closed when the caret is not in an @mention', () => {
    expect(mentionMenu('hello', 5, people)).toEqual({ kind: 'closed' });
    expect(mentionMenu('hi @omar ', 9, people)).toEqual({ kind: 'closed' });
  });
  it('lists the people matching what was typed, with where the mention starts', () => {
    expect(mentionMenu('hi @om', 6, people)).toEqual({ kind: 'people', start: 3, query: 'om', people: [people[0]] });
    expect(mentionMenu('@', 1, people)).toEqual({ kind: 'people', start: 0, query: '', people });
  });
  it('says nobody matches once something was typed; a bare @ with nobody to list stays closed', () => {
    expect(mentionMenu('hi @zz', 6, people)).toEqual({ kind: 'no-match', query: 'zz' });
    expect(mentionMenu('@', 1, [])).toEqual({ kind: 'closed' });
  });
  it('never says nobody matches while there is no one to match against (still loading, or it failed)', () => {
    expect(mentionMenu('hi @zz', 6, [])).toEqual({ kind: 'closed' });
  });
});
