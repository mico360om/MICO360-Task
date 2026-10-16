/**
 * Runs after the server is compiled (`npm run build` → postbuild): writes dist/src/release.json with
 * the version (package.json), the time of this build, the code revision and the changelog. The
 * build fails if CHANGELOG.md is broken or doesn't describe this version, so a release can't go out
 * without its notes. On the live site the build runs at each deployment: the time written here is
 * the "Last Updated" in every page's footer.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makeReleaseFile } from '../modules/about/build-info';

/** The server's folder: dist/src/scripts → three levels up. */
const backendDir = path.resolve(__dirname, '..', '..', '..');

/** CHANGELOG.md: beside the server (a server-only package) or at the repository's root. */
function findChangelog(): string {
  const candidates = [path.join(backendDir, 'CHANGELOG.md'), path.resolve(backendDir, '..', '..', 'CHANGELOG.md')];
  const found = candidates.find((f) => fs.existsSync(f));
  if (!found) throw new Error(`CHANGELOG.md not found (looked in ${candidates.join(' and ')}).`);
  return found;
}

/** The code revision: the host's deploy variable when it sets one, else git, else unknown. */
function currentCommit(): string | null {
  const fromEnv = process.env.SOURCE_COMMIT || process.env.GIT_COMMIT || process.env.COMMIT_SHA;
  if (fromEnv) return fromEnv.slice(0, 12);
  try {
    return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: backendDir, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null;
  } catch {
    return null;
  }
}

const version = (JSON.parse(fs.readFileSync(path.join(backendDir, 'package.json'), 'utf8')) as { version: string }).version;
const file = makeReleaseFile({ version, changelogMd: fs.readFileSync(findChangelog(), 'utf8'), now: new Date(), commit: currentCommit() });
const out = path.join(backendDir, 'dist', 'src', 'release.json');
fs.writeFileSync(out, `${JSON.stringify(file, null, 2)}\n`);
console.log(`Release info: v${file.build.version}, built ${file.build.builtAt}${file.build.commit ? ` (${file.build.commit})` : ''}, ${file.releases.length} releases in the changelog.`);
