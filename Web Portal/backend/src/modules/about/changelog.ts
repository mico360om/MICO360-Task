/**
 * CHANGELOG.md, read and written. It is the one record of what each version changed, kept with the
 * code and released with it (tools/release/release.mjs moves "Unreleased" into the new version).
 *
 *   ## [Unreleased]
 *   ## [1.2.0] - 2026-11-02
 *   ### New features | ### Improvements | ### Security | ### Bug fixes
 *   - One change per bullet (lines indented under a bullet continue it).
 *
 * No imports and no TypeScript-only runtime syntax: the release script (plain Node) loads this file
 * directly, so the server and the release tooling share one set of rules.
 */

export type SectionKey = 'features' | 'improvements' | 'security' | 'fixes';
export type Sections = Record<SectionKey, string[]>;
export type Bump = 'major' | 'minor' | 'patch';

export interface Release {
  version: string;
  /** 'YYYY-MM-DD' — the day it was released. */
  date: string;
  sections: Sections;
}

export interface Changelog {
  unreleased: Sections;
  releases: Release[];
}

/** The section headings, in the order they are written. */
export const SECTION_TITLES: Record<SectionKey, string> = {
  features: 'New features',
  improvements: 'Improvements',
  security: 'Security',
  fixes: 'Bug fixes',
};
const SECTION_BY_TITLE = new Map(Object.entries(SECTION_TITLES).map(([k, v]) => [v.toLowerCase(), k as SectionKey]));

const VERSION = /^\d+\.\d+\.\d+$/;
const RELEASE_HEADING = /^## \[([^\]]+)\](?:\s+-\s+(\S+))?\s*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const emptySections = (): Sections => ({ features: [], improvements: [], security: [], fixes: [] });
const isEmpty = (s: Sections) => Object.values(s).every((list) => list.length === 0);

interface Block {
  /** "Unreleased" or the version as written. */
  name: string;
  date: string | null;
  line: number;
  sections: Sections;
  problems: string[];
}

/** The release blocks as written, with any problems found in each. */
function readBlocks(md: string): Block[] {
  const blocks: Block[] = [];
  let block: Block | null = null;
  let section: SectionKey | null = null;
  let bullet: { list: string[]; index: number } | null = null;
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    const heading = RELEASE_HEADING.exec(line);
    if (heading) {
      block = { name: heading[1]!, date: heading[2] ?? null, line: i + 1, sections: emptySections(), problems: [] };
      blocks.push(block);
      section = null;
      bullet = null;
      return;
    }
    if (!block) return; // the title and introduction
    const b: Block = block;
    if (line.startsWith('### ')) {
      const title = line.slice(4).trim();
      section = SECTION_BY_TITLE.get(title.toLowerCase()) ?? null;
      bullet = null;
      if (!section) b.problems.push(`"${title}" is not a changelog section (use ${Object.values(SECTION_TITLES).join(', ')}).`);
      return;
    }
    if (/^\s*[-*] /.test(line)) {
      const text = line.replace(/^\s*[-*] /, '').trim();
      if (!section) {
        b.problems.push(`A change outside a section (line ${i + 1}).`);
        bullet = null;
        return;
      }
      b.sections[section].push(text);
      bullet = { list: b.sections[section], index: b.sections[section].length - 1 };
      return;
    }
    // An indented line carries on the bullet above it.
    if (bullet && /^\s+\S/.test(line)) {
      const { list, index } = bullet as { list: string[]; index: number };
      list[index] = `${list[index]} ${line.trim()}`;
      return;
    }
    if (!line.trim()) return;
    bullet = null;
  });
  return blocks;
}

/** The changelog's releases (newest first) and the changes not released yet. */
export function parseChangelog(md: string): Changelog {
  const blocks = readBlocks(md);
  const unreleased = blocks.find((b) => b.name.toLowerCase() === 'unreleased')?.sections ?? emptySections();
  const releases = blocks
    .filter((b) => b.name.toLowerCase() !== 'unreleased' && VERSION.test(b.name))
    .map((b) => ({ version: b.name, date: b.date ?? '', sections: b.sections }));
  return { unreleased, releases };
}

/** What is wrong with a changelog: an empty list means it is fine. */
export function changelogProblems(md: string): string[] {
  const problems: string[] = [];
  const blocks = readBlocks(md);
  let previous: string | null = null;
  for (const b of blocks) {
    problems.push(...b.problems.map((p) => `[${b.name}] ${p}`));
    if (b.name.toLowerCase() === 'unreleased') {
      if (previous) problems.push('[Unreleased] must come before every release.');
      continue;
    }
    if (!b.date || !DATE.test(b.date)) problems.push(`[${b.name}] needs its release date as YYYY-MM-DD (found "${b.date ?? ''}").`);
    if (!VERSION.test(b.name)) {
      problems.push(`[${b.name}] is not a version: use Major.Minor.Patch, e.g. 1.2.3.`);
      continue;
    }
    if (isEmpty(b.sections)) problems.push(`[${b.name}] has no changes listed.`);
    if (previous && compareVersions(b.name, previous) >= 0) problems.push(`[${previous}] is listed above [${b.name}], but ${b.name} is newer than ${previous} — newest first.`);
    previous = b.name;
  }
  return problems;
}

/** Negative, zero or positive, as for sorting: compareVersions('1.10.0', '1.9.3') > 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** The next version: 1.2.3 → major 2.0.0, minor 1.3.0, patch 1.2.4. */
export function bumpVersion(current: string, bump: Bump): string {
  if (!VERSION.test(current)) throw new Error(`"${current}" is not a version (Major.Minor.Patch).`);
  const [major, minor, patch] = current.split('.').map(Number) as [number, number, number];
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/**
 * How big a release this is, from its changes: anything marked "BREAKING" is a major release, new
 * features a minor one, and improvements, security and bug fixes alone a patch.
 */
export function suggestBump(changes: Sections): Bump {
  const all = Object.values(changes).flat();
  if (all.some((c) => /^BREAKING\b/i.test(c))) return 'major';
  if (changes.features.length > 0) return 'minor';
  return 'patch';
}

/** The changelog with the unreleased changes released as `version` on `date`, and a fresh Unreleased. */
export function releaseChangelog(md: string, version: string, date: string): string {
  if (!VERSION.test(version)) throw new Error(`"${version}" is not a version (Major.Minor.Patch).`);
  if (!DATE.test(date)) throw new Error(`"${date}" is not a date (YYYY-MM-DD).`);
  const parsed = parseChangelog(md);
  if (parsed.releases.some((r) => r.version === version)) throw new Error(`${version} is already in the changelog.`);
  if (isEmpty(parsed.unreleased)) throw new Error('There is nothing under [Unreleased] to release: list the changes there first.');
  const text = md.replace(/\r\n?/g, '\n');
  const heading = /^## \[Unreleased\][^\n]*$/im;
  if (!heading.test(text)) throw new Error('The changelog has no "## [Unreleased]" section.');
  return text.replace(heading, `## [Unreleased]\n\n## [${version}] - ${date}`);
}
