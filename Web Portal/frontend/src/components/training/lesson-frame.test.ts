import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// 1.23.36: the lesson page's panel and phone bar stick (position: sticky). The staff shell's <main> clips sideways with
// overflow-x: hidden — a scroll container that never scrolls, so nothing in it could stick. On a lesson page ONLY it
// clips with `clip` instead (no scroll container); every other page keeps its frame (ruling LP1).
const css = readFileSync(resolve(__dirname, '../../index.css'), 'utf8');
const shell = readFileSync(resolve(__dirname, '../AppShell.tsx'), 'utf8');
const player = readFileSync(resolve(__dirname, 'LessonPlayer.tsx'), 'utf8');

describe('the lesson page’s frame (sticky panel and bar)', () => {
  it('the shell’s main is the one the rule names, and still clips sideways everywhere else', () => {
    expect(shell).toMatch(/<main\s+id="main-content"/);
    expect(shell).toMatch(/overflow-x-hidden/);
  });

  it('only a page holding a lesson layout swaps hidden for clip (and only where clip exists)', () => {
    const rule = /@supports \(overflow-x: clip\) \{\s*main#main-content:has\(\[data-lesson-layout\]\) \{\s*overflow-x: clip;\s*\}\s*\}/;
    expect(css).toMatch(rule);
    // No other rule changes main's overflow.
    expect(css.match(/main#main-content/g)).toHaveLength(1);
    expect(player).toMatch(/data-lesson-layout/);
  });
});
