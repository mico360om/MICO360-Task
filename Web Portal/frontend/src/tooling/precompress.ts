import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';
import type { Plugin } from 'vite';

/** Text files worth compressing. Images, fonts (woff2) and archives are compressed formats already. */
const COMPRESSIBLE = /\.(js|css|svg|json|txt|xml)$/i;
/** Below this a compressed copy saves nothing worth a second file. */
const MIN_BYTES = 1024;

/**
 * Write a `.br` and a `.gz` copy next to every large text file under `dir` (recursively) and return
 * the files that were compressed. The API's built-in web server sends the copy to browsers that
 * accept it, so an install with nothing in front of it (the Windows server) still serves the app
 * at about a third of its size. index.html is left alone: the server sends it from memory.
 */
export function precompressDir(dir: string): string[] {
  const done: string[] = [];
  for (const name of readdirSync(dir)) {
    const file = join(dir, name);
    if (statSync(file).isDirectory()) {
      done.push(...precompressDir(file));
      continue;
    }
    if (!COMPRESSIBLE.test(name)) continue;
    const raw = readFileSync(file);
    if (raw.length < MIN_BYTES) continue;
    const br = brotliCompressSync(raw, {
      params: { [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length },
    });
    const gz = gzipSync(raw, { level: constants.Z_BEST_COMPRESSION });
    // A copy that is not smaller would only cost the browser time.
    if (br.length < raw.length) writeFileSync(`${file}.br`, br);
    if (gz.length < raw.length) writeFileSync(`${file}.gz`, gz);
    done.push(file);
  }
  return done;
}

/** Vite plugin: after a production build, add the compressed copies to the output folder. */
export function precompress(): Plugin {
  let outDir = 'dist';
  return {
    name: 'mico360-precompress',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      precompressDir(outDir);
    },
  };
}
