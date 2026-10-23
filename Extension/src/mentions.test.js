import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as ext from './mentions.js';

const { detectMention, applyMention, suggestMentions, mentionMenu, tokenizeMentions, isNameCharFallback } = ext;

const people = [
  { id: 'u1', username: 'omar', name: 'Omar Ahmed' },
  { id: 'u2', username: 'flowa.ma', name: 'Flowa Mahmood' },
  { id: 'u3', username: 'al-amri', name: 'Said Al Amri' },
  { id: 'u4', username: 'aisha', name: 'Aisha Al Balushi' },
];

describe('@mentions — the rules the web and the Android app share', () => {
  it('finds the @mention being typed at the caret, with the server’s name rules', () => {
    expect(detectMention('hi @om', 6)).toEqual({ query: 'om', start: 3 });
    expect(detectMention('hi @flowa.ma', 12)).toEqual({ query: 'flowa.ma', start: 3 });
    expect(detectMention('شكرا @أحم', 9)).toEqual({ query: 'أحم', start: 5 });
    expect(detectMention('email me@x.com', 14)).toBeNull();
    expect(detectMention('done @omar ', 11)).toBeNull();
  });

  it('puts the picked @username in, with a space after it', () => {
    expect(applyMention('hi @om there', 3, 'omar', 6)).toEqual({ text: 'hi @omar  there', caret: 9 });
  });

  it('suggests usernames that start with what was typed first, then names', () => {
    expect(suggestMentions(people, 'a').map((p) => p.username)).toEqual(['al-amri', 'aisha', 'omar', 'flowa.ma']);
    expect(suggestMentions(people, 'bal').map((p) => p.username)).toEqual(['aisha']);
  });

  it('a menu: people to pick, “nobody matches”, or closed', () => {
    expect(mentionMenu('hi @om', 6, people)).toMatchObject({ kind: 'people', start: 3, query: 'om' });
    expect(mentionMenu('hi @zz', 6, people)).toEqual({ kind: 'no-match', query: 'zz' });
    expect(mentionMenu('hi @zz', 6, [])).toEqual({ kind: 'closed' });
  });

  it('marks only real people’s names in a comment, the longest name first', () => {
    expect(tokenizeMentions('thanks @omar and @nobody.', ['omar'])).toEqual([
      { type: 'text', value: 'thanks ' },
      { type: 'mention', value: '@omar', username: 'omar' },
      { type: 'text', value: ' and @nobody.' },
    ]);
  });

  it('has no \\p{…} in a regex literal, like the shared original', () => {
    const source = readFileSync(resolve(__dirname, 'mentions.js'), 'utf8');
    expect(source).not.toMatch(/\/[^/\n]*\\p\{[^/\n]*\/[a-z]*u/);
    expect(isNameCharFallback('أ')).toBe(true);
    expect(isNameCharFallback('،')).toBe(false);
  });
});

// The web app and the Android app share Web Portal/frontend/src/lib/mentions.ts (their own copies
// are compared as text). The extension's copy is plain JavaScript, so it can't be compared as text:
// both run over the same inputs and this fails when the answers drift (skipped where the web app
// isn't checked out next to the extension).
const repo = resolve(__dirname, '../..');
const WEB = resolve(repo, 'Web Portal/frontend/src/lib/mentions.ts');
const web = existsSync(WEB) ? await import(pathToFileURL(WEB).href) : null;

describe.skipIf(!web)('@mentions: src/mentions.js matches the web app (lib/mentions.ts)', () => {
  const TEXTS = [
    '', '@', '@@', 'hi @om', 'hi @om there', '@ad', 'email me@x.com', 'done @omar ', 'hi @flowa.ma', 'hi @flowa.ma.', 'cc @al-amri',
    'cc @al-amri-', 'شكرا @أحم', '(@om', 'x.@om', 'x-@om', '@@om', 'cc @ª', 'a @b @c', 'tab\t@om', 'new\n@om', '«@om»',
    '@omar, @aisha!', '@omar.@aisha', 'thanks @omar and @nobody.', '@OMAR', '@omar_1 ok', '@中文', '@한국', '@a—b', '@x😀y', 'ends with @',
    '@flowa.mahmood', 'mail @omar@x.com', '@al-amri.', '@1234', '@_x', 'x@', '@ omar',
  ];
  const USERNAMES = [undefined, [], ['omar'], ['omar', 'om'], ['flowa.ma', 'flowa'], ['al-amri', 'aisha', 'OMAR'], ['أحمد', 'omar_1'], ['', 'b', 'c']];
  const QUERIES = ['', 'a', 'om', 'OM', 'al', 'amri', 'bal', 'ma', 'flowa.m', 'x', 'أ', ' ', 'amz', 'mz', 'hme', 'z', 'k', 'li', 'an'];
  // Every kind of match, in an order where the ranking (not the list order) decides.
  const crowd = [
    { id: 'c1', username: 'zed', name: 'Hamza Khan' },
    { id: 'c2', username: 'samzi', name: 'Bob Li' },
    { id: 'c3', username: 'k.amzar', name: 'Khalid' },
    { id: 'c4', username: 'amz', name: '' },
    { id: 'c5', username: 'li_an', name: 'Ann Lian' },
    ...people,
  ];

  it('exports the same helpers', () => {
    for (const name of ['isNameCharFallback', 'detectMention', 'applyMention', 'suggestMentions', 'mentionMenu', 'tokenizeMentions']) {
      expect(typeof ext[name], name).toBe('function');
      expect(typeof web[name], name).toBe('function');
    }
  });

  it('treats the same characters as part of a name (the stand-in for engines without \\p{…})', () => {
    for (let c = 0; c < 0x3100; c += 1) {
      const ch = String.fromCharCode(c);
      if (isNameCharFallback(ch) !== web.isNameCharFallback(ch)) expect(c.toString(16)).toBe('the same answer');
    }
    for (const ch of ['\ud83d', 'ﻼ', '︰', '﹏', '＠', '！', '［', '｛', '﻿']) expect(isNameCharFallback(ch), ch).toBe(web.isNameCharFallback(ch));
  });

  it('finds the same mention at every caret, and puts a picked name in the same way', () => {
    for (const text of TEXTS) {
      for (let caret = -1; caret <= text.length + 1; caret += 1) {
        expect(detectMention(text, caret), `${JSON.stringify(text)} @${caret}`).toEqual(web.detectMention(text, caret));
        const found = web.detectMention(text, caret);
        if (found) expect(applyMention(text, found.start, 'omar.k', caret)).toEqual(web.applyMention(text, found.start, 'omar.k', caret));
      }
    }
  });

  it('suggests the same people in the same order, and opens the same menu', () => {
    for (const q of QUERIES) {
      for (const limit of [undefined, 1, 2, 6, 20]) {
        for (const list of [people, crowd, [...crowd].reverse()]) {
          expect(suggestMentions(list, q, limit), `${q}/${limit}`).toEqual(web.suggestMentions(list, q, limit));
        }
      }
    }
    for (const text of TEXTS) {
      for (const list of [people, [], people.slice(0, 1)]) {
        expect(mentionMenu(text, text.length, list), text).toEqual(web.mentionMenu(text, text.length, list));
      }
    }
  });

  it('marks the same mentions in a comment', () => {
    for (const text of TEXTS) {
      for (const names of USERNAMES) {
        expect(tokenizeMentions(text, names), `${JSON.stringify(text)} ${JSON.stringify(names)}`).toEqual(web.tokenizeMentions(text, names));
      }
    }
  });
});
