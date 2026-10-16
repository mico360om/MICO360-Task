#!/usr/bin/env node
/**
 * Make a release: one version for the whole system, and its changelog entry.
 *
 *   node tools/release/release.mjs [major|minor|patch|X.Y.Z] [--date YYYY-MM-DD] [--dry-run] [--commit]
 *   (or: npm run release -- minor)
 *
 * 1. Takes the changes listed under "## [Unreleased]" in CHANGELOG.md (refuses if there are none).
 *    Without a level it picks one from them: BREAKING → major, New features → minor, else patch.
 * 2. Writes the new version everywhere: the server, web app, extension and Android packages (and
 *    their lockfiles), the extension manifest, the Android app (version and build number) and the
 *    Windows installer.
 * 3. Dates the changelog entry (Oman date) and opens a fresh [Unreleased].
 * 4. Runs the release-consistency test, which fails if anything is out of step.
 * 5. With --commit: commits "Release vX.Y.Z" and tags it vX.Y.Z (push them yourself).
 *
 * The build then stamps each deployment with its time (Web Portal/backend → dist/src/release.json),
 * which the footer of every page shows; nothing is typed by hand.
 * Needs Node 22.18+ (it reads the changelog rules from the server's TypeScript source).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BACKEND = path.join(ROOT, 'Web Portal', 'backend');
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
const level = args.find((a) => !a.startsWith('--') && a !== option('date'));
const dryRun = flag('dry-run');

// Loading the TypeScript rules makes Node print notes about the file's module type: not useful here.
process.removeAllListeners('warning');
let rules;
try {
  rules = await import(pathToFileURL(path.join(BACKEND, 'src', 'modules', 'about', 'changelog.ts')).href);
} catch (err) {
  console.error(`Couldn't read the changelog rules (Node ${process.version}; 22.18 or later is needed): ${err.message}`);
  process.exit(1);
}
const { bumpVersion, changelogProblems, parseChangelog, releaseChangelog, suggestBump, SECTION_TITLES } = rules;

const fail = (message) => {
  console.error(`✗ ${message}`);
  process.exit(1);
};

// ── What is being released ───────────────────────────────────────────────────
const changelogFile = path.join(ROOT, 'CHANGELOG.md');
const changelogMd = fs.readFileSync(changelogFile, 'utf8');
const problems = changelogProblems(changelogMd);
if (problems.length) fail(`CHANGELOG.md has problems:\n  - ${problems.join('\n  - ')}`);
const { unreleased } = parseChangelog(changelogMd);
const changes = Object.values(unreleased).flat().length;
if (changes === 0) fail('Nothing is listed under "## [Unreleased]" in CHANGELOG.md: add the changes first.');

const current = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const suggested = suggestBump(unreleased);
let next;
if (!level) next = bumpVersion(current, suggested);
else if (['major', 'minor', 'patch'].includes(level)) next = bumpVersion(current, level);
else if (/^\d+\.\d+\.\d+$/.test(level)) next = level;
else fail(`"${level}" is not major, minor, patch or a version like 1.2.3.`);
if (rules.compareVersions(next, current) <= 0) fail(`${next} is not newer than the current ${current}.`);
const date = option('date') ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Muscat', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

console.log(`Releasing ${current} → ${next} (${date}).`);
console.log(`  ${changes} change(s): ${Object.entries(unreleased).filter(([, l]) => l.length).map(([k, l]) => `${l.length} ${SECTION_TITLES[k]}`).join(', ')}.`);
if (!level) console.log(`  Level: ${suggested} (picked from the changes; pass major, minor or patch to choose).`);
else if (level !== suggested && ['major', 'minor', 'patch'].includes(level)) console.log(`  Note: the changes look like a ${suggested} release; releasing as ${level} as asked.`);

// ── Write the version everywhere ─────────────────────────────────────────────
const changed = [];
const eolOf = (text) => (text.includes('\r\n') ? '\r\n' : '\n');

/** Change a JSON file in place, refusing if rewriting it would change more than the values. */
function editJson(rel, mutate) {
  const file = path.join(ROOT, rel);
  const text = fs.readFileSync(file, 'utf8');
  const eol = eolOf(text);
  const data = JSON.parse(text);
  if (`${JSON.stringify(data, null, 2)}\n`.replace(/\n/g, eol) !== text) fail(`${rel} isn't formatted as 2-space JSON; set its version by hand.`);
  mutate(data);
  const out = `${JSON.stringify(data, null, 2)}\n`.replace(/\n/g, eol);
  if (out !== text) {
    if (!changed.includes(rel)) changed.push(rel);
    if (!dryRun) fs.writeFileSync(file, out);
  }
}

/** Change one pattern in a text file; it must be found exactly once. */
function editText(rel, pattern, replace) {
  const file = path.join(ROOT, rel);
  const text = fs.readFileSync(file, 'utf8');
  const hits = text.match(new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`));
  if (!hits || hits.length !== 1) fail(`${rel}: expected one match for ${pattern}, found ${hits?.length ?? 0}.`);
  const out = text.replace(pattern, replace);
  if (out !== text) {
    if (!changed.includes(rel)) changed.push(rel);
    if (!dryRun) fs.writeFileSync(file, out);
  }
}

const setVersion = (d) => {
  d.version = next;
};
for (const rel of ['package.json', 'Web Portal/backend/package.json', 'Web Portal/frontend/package.json', 'Extension/package.json', 'Android App/package.json']) {
  editJson(rel, setVersion);
}
// The manifest keeps its own layout: only its version changes.
editText('Extension/manifest.json', /"version": "[^"]*"/, `"version": "${next}"`);
editJson('package-lock.json', (d) => {
  d.version = next;
  for (const key of ['', 'Web Portal/backend', 'Web Portal/frontend', 'Extension']) {
    if (!d.packages?.[key]) fail(`package-lock.json has no "${key}" package.`);
    d.packages[key].version = next;
  }
});
for (const rel of ['Web Portal/backend/package-lock.json', 'Android App/package-lock.json']) {
  editJson(rel, (d) => {
    d.version = next;
    d.packages[''].version = next;
  });
}
// The Android app keeps its own layout: its version, and the build number Android uses to tell an
// update from an older copy (one more each release).
const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'Android App', 'app.json'), 'utf8'));
const versionCode = (Number(appJson.expo.android.versionCode) || 0) + 1;
editText('Android App/app.json', /"version": "[^"]*"/, `"version": "${next}"`);
editText('Android App/app.json', /"versionCode": \d+/, `"versionCode": ${versionCode}`);
editText('tools/release/windows/Shared/ServerCore.cs', /public const string Version = "[^"]*";/, `public const string Version = "${next}";`);
editText('tools/release/windows/app.manifest', /assemblyIdentity version="[^"]*"/, `assemblyIdentity version="${next}.0"`);

const newChangelog = releaseChangelog(changelogMd, next, date);
changed.push('CHANGELOG.md');
if (!dryRun) fs.writeFileSync(changelogFile, newChangelog);

console.log(`  Version ${next} written to ${changed.length} files (Android build number ${versionCode}).`);
if (dryRun) {
  console.log(`  Dry run: nothing was written.\n  ${changed.join('\n  ')}`);
  process.exit(0);
}

// ── Check ─────────────────────────────────────────────────────────────────────
console.log('Checking that everything is in step…');
const check = spawnSync('npx vitest run src/modules/about/', { cwd: BACKEND, stdio: 'inherit', shell: true });
if (check.status !== 0) fail('The release checks failed (see above). Fix them, or undo the changes with git checkout.');

if (flag('commit')) {
  const git = (...a) => {
    const r = spawnSync('git', a, { cwd: ROOT, stdio: 'inherit' });
    if (r.status !== 0) fail(`git ${a.join(' ')} failed.`);
  };
  git('add', '--', ...changed);
  git('commit', '-m', `Release v${next}`);
  git('tag', '-a', `v${next}`, '-m', `MICO360 Tasks v${next}`);
  console.log(`✓ Released v${next}: committed and tagged. Push with: git push && git push origin v${next}`);
} else {
  console.log(`✓ v${next} is ready. Review the changes, then commit them and tag v${next} (or run again with --commit).`);
}
