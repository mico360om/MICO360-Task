/**
 * A small reader for source maps (version 3), so the Error log can show the site's own file and line
 * for a browser error: the web build writes hidden maps (never served), and the server reads them
 * when a report arrives. No package: base64 VLQ decoding and a binary search are all it takes.
 */

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const DIGIT = new Map([...BASE64].map((c, i) => [c, i] as const));

/** The numbers in one base64 VLQ segment ("2HwcO" → [123, 456, 7]); null when it is broken. */
export function decodeVlq(segment: string): number[] | null {
  const out: number[] = [];
  let value = 0;
  let shift = 0;
  let pending = false;
  for (const char of segment) {
    const digit = DIGIT.get(char);
    if (digit === undefined) return null;
    value += (digit & 31) * 2 ** shift;
    if (digit & 32) {
      shift += 5;
      pending = true;
      if (shift > 30) return null;
      continue;
    }
    out.push(value % 2 === 1 ? -Math.floor(value / 2) : Math.floor(value / 2));
    value = 0;
    shift = 0;
    pending = false;
  }
  return pending ? null : out;
}

export interface OriginalPosition {
  /** The original file, as a project path (src/pages/BoardPage.tsx). */
  source: string;
  /** 1-based. */
  line: number;
  /** 1-based. */
  column: number;
  /** The original name at that position, when the map has one. */
  name?: string;
}

export interface ParsedSourceMap {
  /** The original position of a 1-based line and column in the built file, or null. */
  lookup(line: number, column: number): OriginalPosition | null;
  /** Roughly how much memory the decoded map takes (the cache keeps a budget). */
  bytes: number;
}

/** A source path as a project path: no ../, ./, webpack:// or folders above src/ or node_modules/. */
export function tidySource(path: string): string {
  let p = path.replace(/\\/g, '/').replace(/^[a-z]+:\/\/\/?/i, '');
  const at = Math.max(p.lastIndexOf('/src/') >= 0 ? p.lastIndexOf('/src/') + 1 : -1, p.startsWith('src/') ? 0 : -1);
  const modules = p.lastIndexOf('node_modules/');
  if (modules >= 0) p = p.slice(modules);
  else if (at >= 0) p = p.slice(at);
  return p.replace(/^(\.\.?\/)+/, '');
}

/** Fields per decoded segment: generated column, source, original line, original column, name (-1: none). */
const FIELDS = 5;

/** Read a source map's JSON; null when it isn't one this reader understands (never a throw). */
export function parseSourceMap(json: string): ParsedSourceMap | null {
  let raw: { version?: unknown; sources?: unknown; names?: unknown; mappings?: unknown; sourceRoot?: unknown };
  try {
    raw = JSON.parse(json) as typeof raw;
  } catch {
    return null;
  }
  if (!raw || raw.version !== 3 || !Array.isArray(raw.sources) || typeof raw.mappings !== 'string') return null;
  const root = typeof raw.sourceRoot === 'string' && raw.sourceRoot ? raw.sourceRoot.replace(/\/?$/, '/') : '';
  const sources = raw.sources.map((s) => tidySource(`${root}${typeof s === 'string' ? s : ''}`));
  const names = Array.isArray(raw.names) ? raw.names.map((n) => (typeof n === 'string' ? n : '')) : [];

  // Decode every segment into one flat array; lineStart[i] is where generated line i begins.
  const lines = raw.mappings.split(';');
  const lineStart = new Int32Array(lines.length + 1);
  const chunks: number[] = [];
  let source = 0;
  let oLine = 0;
  let oCol = 0;
  let name = 0;
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    lineStart[i] = count;
    let col = 0;
    for (const seg of lines[i]!.split(',')) {
      if (!seg) continue;
      const v = decodeVlq(seg);
      if (!v || v.length === 0) return null;
      col += v[0]!;
      if (v.length >= 4) {
        source += v[1]!;
        oLine += v[2]!;
        oCol += v[3]!;
        if (v.length >= 5) name += v[4]!;
        chunks.push(col, source, oLine, oCol, v.length >= 5 ? name : -1);
      } else {
        chunks.push(col, -1, -1, -1, -1);
      }
      count += 1;
    }
  }
  lineStart[lines.length] = count;
  const segs = Int32Array.from(chunks);

  return {
    bytes: segs.byteLength + lineStart.byteLength + json.length,
    lookup(line, column) {
      const li = line - 1;
      if (!Number.isInteger(li) || li < 0 || li >= lines.length) return null;
      const col = column - 1;
      let lo = lineStart[li]!;
      let hi = lineStart[li + 1]! - 1;
      let found = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (segs[mid * FIELDS]! <= col) {
          found = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      if (found < 0) return null;
      const at = found * FIELDS;
      const src = segs[at + 1]!;
      if (src < 0 || src >= sources.length) return null;
      const n = segs[at + 4]!;
      const position: OriginalPosition = { source: sources[src]!, line: segs[at + 2]! + 1, column: segs[at + 3]! + 1 };
      if (n >= 0 && names[n]) position.name = names[n];
      return position;
    },
  };
}
