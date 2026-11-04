import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chunkName, createMapStore, parseStack, resolveStack } from './stack';

/** A source map in which every listed (generated line, column) maps to an original place. */
function encode(n: number): string {
  const B = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let v = n < 0 ? (-n << 1) | 1 : n << 1;
  let out = '';
  do {
    let digit = v & 31;
    v >>>= 5;
    if (v > 0) digit |= 32;
    out += B[digit];
  } while (v > 0);
  return out;
}
function mapOf(sources: string[], names: string[], points: { col: number; src: number; line: number; ocol: number; name?: number }[]): string {
  // All on generated line 1 (a minified bundle), sorted by column.
  let pc = 0, ps = 0, pl = 0, po = 0, pn = 0;
  const segs = points.map((p) => {
    const s = encode(p.col - pc) + encode(p.src - ps) + encode(p.line - pl) + encode(p.ocol - po) + (p.name !== undefined ? encode(p.name - pn) : '');
    pc = p.col; ps = p.src; pl = p.line; po = p.ocol; if (p.name !== undefined) pn = p.name;
    return s;
  });
  return JSON.stringify({ version: 3, sources, names, mappings: segs.join(',') });
}

describe('parseStack', () => {
  it('reads Chrome / Edge (V8) frames', () => {
    const stack = [
      "TypeError: Cannot read properties of undefined (reading 'name')",
      '    at Xy (https://task.mico360.com/assets/BoardPage-B3x9kQ2a.js:1:120)',
      '    at async https://task.mico360.com/assets/index-Ab12Cd34.js:1:5000',
      '    at new Qz (https://task.mico360.com/assets/index-Ab12Cd34.js:2:7)',
    ].join('\n');
    expect(parseStack(stack)).toEqual([
      { fn: 'Xy', url: 'https://task.mico360.com/assets/BoardPage-B3x9kQ2a.js', line: 1, column: 120 },
      { fn: null, url: 'https://task.mico360.com/assets/index-Ab12Cd34.js', line: 1, column: 5000 },
      { fn: 'new Qz', url: 'https://task.mico360.com/assets/index-Ab12Cd34.js', line: 2, column: 7 },
    ]);
  });

  it('reads Firefox / Safari frames', () => {
    const stack = ['Xy@https://task.mico360.com/assets/BoardPage-B3x9kQ2a.js:1:120', '@https://task.mico360.com/assets/index-Ab12Cd34.js:1:9'].join('\n');
    expect(parseStack(stack)).toEqual([
      { fn: 'Xy', url: 'https://task.mico360.com/assets/BoardPage-B3x9kQ2a.js', line: 1, column: 120 },
      { fn: null, url: 'https://task.mico360.com/assets/index-Ab12Cd34.js', line: 1, column: 9 },
    ]);
  });

  it('reads Node frames (server errors), Windows paths too', () => {
    const stack = ['Error: boom', '    at Object.run (D:\\app\\dist\\src\\modules\\x.js:12:3)', '    at node:internal/process/task_queues:95:5'].join('\n');
    expect(parseStack(stack)).toEqual([
      { fn: 'Object.run', url: 'D:\\app\\dist\\src\\modules\\x.js', line: 12, column: 3 },
      { fn: null, url: 'node:internal/process/task_queues', line: 95, column: 5 },
    ]);
  });

  it('ignores lines that are not frames', () => {
    expect(parseStack('just a message\nno frames here')).toEqual([]);
    expect(parseStack('')).toEqual([]);
  });
});

describe('chunkName: a built file without its hash', () => {
  it('drops the content hash', () => {
    expect(chunkName('https://task.mico360.com/assets/BoardPage-B3x9kQ2a.js')).toBe('BoardPage.js');
    expect(chunkName('/assets/index-Ab12_Cd3.js')).toBe('index.js');
    expect(chunkName('/assets/vendor-react-Zz99aa11.js')).toBe('vendor-react.js');
    expect(chunkName('/assets/plain.js')).toBe('plain.js');
  });
});

describe('resolveStack: the site’s own file and line', () => {
  function webRootWith(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), 'mico-el-maps-'));
    mkdirSync(join(root, 'assets'));
    for (const [name, text] of Object.entries(files)) writeFileSync(join(root, 'assets', name), text);
    return root;
  }

  it('maps each frame through the hidden map; the top frame is the first of the site’s own code', async () => {
    const root = webRootWith({
      'BoardPage-B3x9kQ2a.js.map': mapOf(['../../src/pages/BoardPage.tsx'], ['boardTitle'], [{ col: 100, src: 0, line: 41, ocol: 4 }, { col: 200, src: 0, line: 9, ocol: 2, name: 0 }]),
      'vendor-react-Zz99aa11.js.map': mapOf(['../../node_modules/react-dom/cjs/react-dom.production.js'], ['renderWithHooks'], [{ col: 0, src: 0, line: 9999, ocol: 0, name: 0 }]),
    });
    const maps = createMapStore({ webRoot: root });
    const stack = [
      'TypeError: x is undefined',
      '    at aa (https://task.mico360.com/assets/vendor-react-Zz99aa11.js:1:5)',
      '    at Xy (https://task.mico360.com/assets/BoardPage-B3x9kQ2a.js:1:120)',
      '    at Bz (https://task.mico360.com/assets/BoardPage-B3x9kQ2a.js:1:250)',
    ].join('\n');
    const out = await resolveStack(stack, maps);
    expect(out.top).toEqual({ file: 'src/pages/BoardPage.tsx', fn: 'boardTitle', line: 42, column: 5, mapped: true });
    expect(out.stack.split('\n')).toEqual([
      'TypeError: x is undefined',
      '    at aa (node_modules/react-dom/cjs/react-dom.production.js:10000:1)',
      '    at Xy (src/pages/BoardPage.tsx:42:5)',
      '    at Bz (src/pages/BoardPage.tsx:10:3)',
    ]);
  });

  it('without a map (an older version’s report): the chunk name without its hash, the frames as sent', async () => {
    const maps = createMapStore({ webRoot: webRootWith({}) });
    const stack = 'Error: boom\n    at Xy (https://task.mico360.com/assets/BoardPage-OLDhash1.js:1:120)';
    const out = await resolveStack(stack, maps);
    expect(out.top).toEqual({ file: 'BoardPage.js', fn: null, line: 1, column: 120, mapped: false });
    expect(out.stack).toBe('Error: boom\n    at Xy (/assets/BoardPage-OLDhash1.js:1:120)');
  });

  it('never reads outside the assets folder, nor anything but a map', async () => {
    const root = webRootWith({ 'x.js.map': mapOf(['../../src/x.ts'], [], [{ col: 0, src: 0, line: 0, ocol: 0 }]) });
    writeFileSync(join(root, 'secret.js.map'), mapOf(['../../src/secret.ts'], [], [{ col: 0, src: 0, line: 0, ocol: 0 }]));
    const maps = createMapStore({ webRoot: root });
    expect(await maps.forUrl('https://h/assets/../secret.js')).toBeNull();
    expect(await maps.forUrl('https://h/assets/%2e%2e/secret.js')).toBeNull();
    expect(await maps.forUrl('https://h/secret.js')).toBeNull();
    expect(await maps.forUrl('https://h/assets/x.css')).toBeNull();
    expect(await maps.forUrl('https://h/assets/x.js')).not.toBeNull();
  });

  it('server frames: the built file of the server’s own code, mapped to its .ts when the map is beside it', async () => {
    const dist = mkdtempSync(join(tmpdir(), 'mico-el-dist-'));
    mkdirSync(join(dist, 'src', 'modules'), { recursive: true });
    const file = join(dist, 'src', 'modules', 'x.js');
    writeFileSync(`${file}.map`, mapOf(['../../../src/modules/x.ts'], [], [{ col: 2, src: 0, line: 20, ocol: 4 }]));
    const maps = createMapStore({ webRoot: null, serverRoot: dist });
    const out = await resolveStack(`Error: boom\n    at Object.run (${file}:1:3)\n    at node:internal/process/task_queues:95:5`, maps);
    expect(out.top).toEqual({ file: 'src/modules/x.ts', fn: 'Object.run', line: 21, column: 5, mapped: true });
    expect(out.stack.split('\n')[1]).toBe('    at Object.run (src/modules/x.ts:21:5)');
  });

  it('a map that fails to read or parse is just missing', async () => {
    const root = webRootWith({ 'bad-Ab12Cd34.js.map': '{not json' });
    const out = await resolveStack('E\n    at q (https://h/assets/bad-Ab12Cd34.js:1:1)', createMapStore({ webRoot: root }));
    expect(out.top).toMatchObject({ file: 'bad.js', mapped: false });
  });
});
