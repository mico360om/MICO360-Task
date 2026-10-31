import { it, expect } from 'vitest';
import { appSources } from '../testing/web-source';

/** The text of each `navigation.setOptions(…)` call in a screen (balanced brackets). */
function setOptionsBlocks(text: string): string[] {
  const out: string[] = [];
  let at = text.indexOf('navigation.setOptions(');
  while (at >= 0) {
    let depth = 0;
    let end = at + 'navigation.setOptions'.length;
    for (; end < text.length; end += 1) {
      if (text[end] === '(') depth += 1;
      else if (text[end] === ')' && --depth === 0) break;
    }
    out.push(text.slice(at, end + 1));
    at = text.indexOf('navigation.setOptions(', end);
  }
  return out;
}

// The stack header is white (the surface) since Stage 1: words and buttons a screen puts in it are
// ink / text tones — white on it (onBrand, made for the old maroon header) can't be seen.
it('no stack-screen header a screen sets uses onBrand — neither inline nor in a style it uses', () => {
  const found: string[] = [];
  for (const [file, text] of appSources().filter(([f]) => f.startsWith('screens/'))) {
    for (const block of setOptionsBlocks(text)) {
      if (/onBrand/.test(block)) found.push(`${file}: inline`);
      for (const [, key] of block.matchAll(/\b(?:s|styles)\.(\w+)/g)) {
        const rule = new RegExp(`\\n\\s+${key}: \\{[^\\n]*`).exec(text)?.[0] ?? '';
        if (/onBrand/.test(rule)) found.push(`${file}: ${key}`);
      }
    }
  }
  expect(found).toEqual([]);
});

it('User Management’s New user is an icon button in the white header', () => {
  const users = appSources().find(([f]) => f === 'screens/UsersScreen.tsx')![1];
  expect(users).toMatch(/<IconButton icon="ui\.plus" label="New user"/);
  expect(users).not.toMatch(/\+ New/);
});
