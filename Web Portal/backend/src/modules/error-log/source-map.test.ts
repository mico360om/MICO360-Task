import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { decodeVlq, parseSourceMap } from './source-map';

/** A real source map, made by TypeScript from a small file (so the decoder is checked against a real producer). */
function compiled(source: string, fileName = 'src/pages/BoardPage.tsx') {
  const out = ts.transpileModule(source, {
    fileName,
    compilerOptions: { sourceMap: true, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, removeComments: true, jsx: ts.JsxEmit.ReactJSX },
  });
  return { js: out.outputText, map: out.sourceMapText! };
}

/** 1-based line and column of `needle` in `text`. */
function where(text: string, needle: string): { line: number; column: number } {
  const at = text.indexOf(needle);
  if (at < 0) throw new Error(`${needle} not found`);
  const before = text.slice(0, at).split('\n');
  return { line: before.length, column: before[before.length - 1]!.length + 1 };
}

describe('decodeVlq', () => {
  it('reads base64 VLQ numbers (the source map format)', () => {
    expect(decodeVlq('AAAA')).toEqual([0, 0, 0, 0]);
    expect(decodeVlq('AACA')).toEqual([0, 0, 1, 0]);
    expect(decodeVlq('D')).toEqual([-1]);
    expect(decodeVlq('2HwcO')).toEqual([123, 456, 7]);
    expect(decodeVlq('gB')).toEqual([16]);
  });

  it('a broken segment gives nothing rather than a wrong number', () => {
    expect(decodeVlq('!!')).toBeNull();
    expect(decodeVlq('g')).toBeNull(); // a continuation with nothing after it
  });
});

describe('parseSourceMap: a built file:line back to the original file:line', () => {
  const source = [
    'export function boardTitle(project: { name: string } | null): string {',
    '  const name = project!.name;',
    '  return `Board: ${name}`;',
    '}',
    '',
    'export function crash(): never {',
    "  throw new Error('boom');",
    '}',
  ].join('\n');

  it('finds the original line, column and file of a position in the built file', () => {
    const { js, map } = compiled(source);
    const parsed = parseSourceMap(map)!;
    expect(parsed).not.toBeNull();
    const built = where(js, 'throw new Error');
    const original = parsed.lookup(built.line, built.column);
    // TypeScript names the source by its file name (beside the output).
    expect(original).toMatchObject({ source: 'BoardPage.tsx', line: 7 });
    const first = parsed.lookup(where(js, 'project.name').line, where(js, 'project.name').column);
    expect(first).toMatchObject({ source: 'BoardPage.tsx', line: 2 });
  });

  it('a position before any mapping on its line, or past the end, finds nothing', () => {
    const { map } = compiled(source);
    const parsed = parseSourceMap(map)!;
    expect(parsed.lookup(999, 1)).toBeNull();
    expect(parsed.lookup(0, 1)).toBeNull();
  });

  it('names: the original name of a mapped identifier when the map has one', () => {
    const map = JSON.stringify({ version: 3, sources: ['src/a.ts'], names: ['loadBoard'], mappings: 'AAAAA' });
    expect(parseSourceMap(map)!.lookup(1, 1)).toEqual({ source: 'src/a.ts', line: 1, column: 1, name: 'loadBoard' });
  });

  it('sourceRoot and Vite-style ../../src paths are tidied to the project path', () => {
    const map = JSON.stringify({ version: 3, sourceRoot: '', sources: ['../../src/lib/x.ts'], names: [], mappings: 'AAAA' });
    expect(parseSourceMap(map)!.lookup(1, 1)!.source).toBe('src/lib/x.ts');
  });

  it('not a map: null, never a throw', () => {
    expect(parseSourceMap('nope')).toBeNull();
    expect(parseSourceMap(JSON.stringify({ version: 2 }))).toBeNull();
    expect(parseSourceMap(JSON.stringify({ version: 3, sources: 'x', mappings: 1 }))).toBeNull();
  });
});
