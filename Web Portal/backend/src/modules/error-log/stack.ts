import { promises as fs } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSourceMap, type ParsedSourceMap } from './source-map';

/** One line of a stack: the function (when the browser named one), the file's address, line and column. */
export interface StackFrame {
  fn: string | null;
  url: string;
  line: number;
  column: number;
}

const V8_FRAME = /^\s*at\s+(?:async\s+)?(?:(.+?)\s+\()?(\S+?):(\d+):(\d+)\)?\s*$/;
const GECKO_FRAME = /^\s*(.*?)@(\S+?):(\d+):(\d+)\s*$/;

/** The frames of a stack, in Chrome / Edge / Node ("at fn (url:1:2)") or Firefox / Safari ("fn@url:1:2") form. */
export function parseStack(stack: string): StackFrame[] {
  const frames: StackFrame[] = [];
  for (const line of String(stack ?? '').split('\n')) {
    const m = (/^\s*at\s/.test(line) ? V8_FRAME : GECKO_FRAME).exec(line);
    if (!m) continue;
    frames.push({ fn: m[1]?.trim() || null, url: m[2]!, line: Number(m[3]), column: Number(m[4]) });
  }
  return frames;
}

/** A built file's name without its content hash: BoardPage-B3x9kQ2a.js → BoardPage.js (also .css and the like). */
export function chunkName(url: string): string {
  const file = url.split(/[?#]/)[0]!.split('/').pop() ?? '';
  return file.replace(/^(.*)-[A-Za-z0-9_-]{8}(\.[A-Za-z0-9]+)$/, '$1$2');
}

/** The path of an address (no scheme, host, query or hash). */
function pathOf(url: string): string {
  return url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '').split(/[?#]/)[0]!;
}

export interface MapStore {
  /** The hidden map of a frame's file: the web app's /assets/*.js, or the server's own built code. */
  forUrl(url: string): Promise<ParsedSourceMap | null>;
  /** A server frame's file inside the server's own code, as a project path (src/modules/x.js); else null. */
  serverPath(url: string): string | null;
}

const ASSET = /^\/assets\/([A-Za-z0-9._-]+\.m?js)$/;
/** Maps bigger than this are not read. */
const MAX_MAP_BYTES = 30 * 1024 * 1024;
/** What decoded maps may take in memory together. */
const CACHE_BUDGET_BYTES = 64 * 1024 * 1024;
/** A map that wasn't there is looked for again after this long (a deploy may have brought it). */
const MISSING_FOR_MS = 10 * 60 * 1000;

/**
 * Hidden source maps, read when a report needs them and kept in a small cache: the web app's from
 * `<webRoot>/assets/<file>.js.map` (never served to browsers), the server's own from beside its built
 * files (`serverRoot`, the backend's dist folder). Nothing outside those folders is ever read.
 */
export function createMapStore(opts: { webRoot: string | null; serverRoot?: string | null; now?: () => number }): MapStore {
  const now = opts.now ?? Date.now;
  const assets = opts.webRoot ? resolve(opts.webRoot, 'assets') : null;
  const server = opts.serverRoot ? resolve(opts.serverRoot) : null;
  const cache = new Map<string, { map: Promise<ParsedSourceMap | null>; bytes: number; missingUntil: number }>();
  let used = 0;

  function serverFile(url: string): string | null {
    if (!server) return null;
    let file = url;
    if (/^file:\/\//i.test(file)) {
      try {
        file = fileURLToPath(file);
      } catch {
        return null;
      }
    }
    if (!isAbsolute(file) || !/\.c?js$/.test(file)) return null;
    const rel = relative(server, resolve(file));
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || rel.split(sep).includes('node_modules')) return null;
    return resolve(file);
  }

  function mapFileFor(url: string): string | null {
    const asset = assets ? ASSET.exec(pathOf(url)) : null;
    if (asset && assets) {
      const file = join(assets, `${asset[1]}.map`);
      return file.startsWith(assets + sep) ? file : null;
    }
    const own = serverFile(url);
    return own ? `${own}.map` : null;
  }

  async function read(file: string): Promise<ParsedSourceMap | null> {
    try {
      const info = await fs.stat(file);
      if (!info.isFile() || info.size > MAX_MAP_BYTES) return null;
      return parseSourceMap(await fs.readFile(file, 'utf8'));
    } catch {
      return null;
    }
  }

  return {
    async forUrl(url) {
      const file = mapFileFor(url);
      if (!file) return null;
      const hit = cache.get(file);
      if (hit && (hit.missingUntil === 0 || hit.missingUntil > now())) {
        cache.delete(file);
        cache.set(file, hit); // most recently used last
        return hit.map;
      }
      if (hit) {
        cache.delete(file);
        used -= hit.bytes;
      }
      const entry = { map: read(file), bytes: 0, missingUntil: 0 };
      cache.set(file, entry);
      const map = await entry.map;
      entry.bytes = map?.bytes ?? 0;
      entry.missingUntil = map ? 0 : now() + MISSING_FOR_MS;
      used += entry.bytes;
      for (const [key, old] of cache) {
        if (used <= CACHE_BUDGET_BYTES || old === entry) break;
        cache.delete(key);
        used -= old.bytes;
      }
      return map;
    },
    serverPath(url) {
      const own = serverFile(url);
      return own && server ? relative(server, own).split(sep).join('/') : null;
    },
  };
}

/** Where a report happened: the site's own original file and function when a map knew them. */
export interface TopFrame {
  file: string;
  fn: string | null;
  line: number;
  column: number;
  mapped: boolean;
}

/** A frame's place as the Error log shows it: a project path when known, else the address's path. */
function shortPlace(url: string): string {
  if (/^node:/.test(url)) return url;
  const p = url.replace(/\\/g, '/');
  const modules = p.lastIndexOf('node_modules/');
  if (modules >= 0) return p.slice(modules);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(p)) return pathOf(p);
  const src = p.lastIndexOf('/src/');
  return src >= 0 ? p.slice(src + 1) : p.split('/').slice(-2).join('/');
}

/**
 * A stack with each frame of the site's code put back to its original file:line (through the hidden
 * maps), and the top frame of the site's own code — what the Error log groups by and shows first.
 */
export async function resolveStack(stack: string, maps: MapStore): Promise<{ stack: string; top: TopFrame | null }> {
  const lines = String(stack ?? '').split('\n');
  const frames = parseStack(stack);
  const resolved = await Promise.all(
    frames.map(async (f) => {
      const map = await maps.forUrl(f.url).catch(() => null);
      const at = map?.lookup(f.line, f.column) ?? null;
      return { frame: f, at, server: maps.serverPath(f.url) };
    }),
  );

  // The resolved text: frame lines rewritten in order, every other line (the message) kept.
  let i = 0;
  const text = lines.map((line) => {
    const m = (/^\s*at\s/.test(line) ? V8_FRAME : GECKO_FRAME).exec(line);
    if (!m) return line;
    const r = resolved[i++];
    if (!r) return line;
    const place = r.at ? `${r.at.source}:${r.at.line}:${r.at.column}` : `${r.server ?? shortPlace(r.frame.url)}:${r.frame.line}:${r.frame.column}`;
    return r.frame.fn ? `    at ${r.frame.fn} (${place})` : `    at ${place}`;
  });

  // The top frame: the first of the site's own code (mapped to src/), else the first of its files.
  const own = (r: (typeof resolved)[number]) => (r.at ? r.at.source.startsWith('src/') : false);
  let topIndex = resolved.findIndex(own);
  if (topIndex < 0) topIndex = resolved.findIndex((r) => r.server !== null || ASSET.test(pathOf(r.frame.url)));
  let top: TopFrame | null = null;
  if (topIndex >= 0) {
    const r = resolved[topIndex]!;
    // The function's name: the name its caller used (the next frame's mapped name, which a map keeps
    // even for minified code); a server frame's own name is a real one. Minified names change with
    // each build, so an unmapped browser frame has none.
    const callerName = resolved[topIndex + 1]?.at?.name ?? null;
    const fn = r.server ? (r.frame.fn ?? callerName) : r.at ? callerName : null;
    if (r.at) top = { file: r.at.source, fn, line: r.at.line, column: r.at.column, mapped: true };
    else top = { file: r.server ?? chunkName(r.frame.url), fn, line: r.frame.line, column: r.frame.column, mapped: false };
  }
  return { stack: text.join('\n'), top };
}
