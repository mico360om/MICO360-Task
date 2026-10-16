import fs from 'node:fs';
import { changelogProblems, parseChangelog, type Release } from './changelog';

/**
 * What a build of the server is: its version, when it was built and from which code. Written once by
 * the build (src/scripts/write-build-info.ts → dist/src/release.json), never by a browser: on the
 * live site the build runs at each deployment, so `builtAt` is when the running copy was deployed.
 */
export interface BuildInfo {
  version: string;
  /** ISO time the build ran (UTC). */
  builtAt: string;
  /** The code revision (short commit), when the build knew it. */
  commit: string | null;
}

export interface ReleaseFile {
  build: BuildInfo;
  /** CHANGELOG.md's releases, newest first. */
  releases: Release[];
}

/** The build's release file: its build info and the changelog, checked against each other. */
export function makeReleaseFile(opts: { version: string; changelogMd: string; now: Date; commit: string | null }): ReleaseFile {
  const problems = changelogProblems(opts.changelogMd);
  if (problems.length) throw new Error(`CHANGELOG.md is not valid:\n- ${problems.join('\n- ')}`);
  const { releases } = parseChangelog(opts.changelogMd);
  if (!releases.some((r) => r.version === opts.version)) {
    throw new Error(`Version ${opts.version} has no entry in CHANGELOG.md. Release it with tools/release/release.mjs, which writes both.`);
  }
  return { build: { version: opts.version, builtAt: opts.now.toISOString(), commit: opts.commit }, releases };
}

/**
 * The running server's release file. Without one (running from source in development) it says so,
 * with the package version and the time the server started.
 */
export function loadReleaseFile(
  file: string,
  fallback: { version: string; startedAt: Date },
): ReleaseFile & { source: 'build' | 'development' } {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as ReleaseFile;
    if (parsed?.build?.version && parsed.build.builtAt) return { source: 'build', build: parsed.build, releases: parsed.releases ?? [] };
  } catch {
    // No build file: a development run.
  }
  return { source: 'development', build: { version: fallback.version, builtAt: fallback.startedAt.toISOString(), commit: null }, releases: [] };
}
