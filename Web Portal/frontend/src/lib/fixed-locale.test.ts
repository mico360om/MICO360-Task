import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * Lower-casing, upper-casing and sorting text must not depend on the browser's language: in a
 * Turkish browser "I".toLocaleLowerCase() is "ı", so a search for "item" never finds "ITEM", and
 * names sort differently from one person to the next. Every call names its locale ('en').
 */
const SRC = resolve(__dirname, '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/** The argument list of the call that opens at `open` (the index of its "("), as written. */
function argsAt(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return text.slice(open + 1, i);
  }
  return text.slice(open + 1);
}

/** How many arguments, counting only top-level commas. */
function argCount(args: string): number {
  if (!args.trim()) return 0;
  let depth = 0;
  let n = 1;
  for (const ch of args) {
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    else if (ch === ',' && depth === 0) n++;
  }
  return n;
}

function offenders(): string[] {
  const found: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    const at = (i: number) => `${relative(SRC, file).replace(/\\/g, '/')}:${text.slice(0, i).split('\n').length}`;
    for (const m of text.matchAll(/\.toLocale(Lower|Upper)Case\(\s*\)/g)) found.push(`${at(m.index!)} toLocale${m[1]}Case()`);
    for (const m of text.matchAll(/\.localeCompare\(/g)) {
      const open = m.index! + m[0].length - 1;
      const args = argsAt(text, open);
      const second = args.split(',')[1]?.trim();
      if (argCount(args) < 2 || second === 'undefined') found.push(`${at(m.index!)} localeCompare(${args.trim()})`);
    }
  }
  return found;
}

describe('text case and sorting follow one fixed locale, whatever the browser’s language', () => {
  it('no toLocaleLowerCase()/toLocaleUpperCase() without a locale, and no localeCompare without one', () => {
    expect(offenders()).toEqual([]);
  });

  it('a Turkish-style capital I still matches with the fixed locale', () => {
    expect('ITEM'.toLocaleLowerCase('en')).toBe('item');
    expect('istanbul'.toLocaleUpperCase('en')).toBe('ISTANBUL');
  });
});
