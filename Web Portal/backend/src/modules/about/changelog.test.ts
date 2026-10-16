import { describe, it, expect } from 'vitest';
import { bumpVersion, changelogProblems, compareVersions, parseChangelog, releaseChangelog, suggestBump } from './changelog';

const MD = `# Changelog

Intro text that is not a release.

## [Unreleased]

### New features
- Keyboard shortcuts across the web app.

## [1.1.0] - 2026-11-02

### New features
- Version history page.
  It shows every release.
### Security
- Sign-in codes expire after ten minutes.

## [1.0.0] - 2026-10-16

### Improvements
- Faster boards.
### Bug fixes
- Meetings no longer slide a week.
`;

describe('parseChangelog', () => {
  it('reads each release with its date and sections, newest first, and the unreleased changes', () => {
    const c = parseChangelog(MD);
    expect(c.unreleased.features).toEqual(['Keyboard shortcuts across the web app.']);
    expect(c.releases.map((r) => [r.version, r.date])).toEqual([
      ['1.1.0', '2026-11-02'],
      ['1.0.0', '2026-10-16'],
    ]);
    expect(c.releases[0]!.sections).toEqual({
      features: ['Version history page. It shows every release.'],
      improvements: [],
      security: ['Sign-in codes expire after ten minutes.'],
      fixes: [],
    });
    expect(c.releases[1]!.sections.fixes).toEqual(['Meetings no longer slide a week.']);
  });
});

describe('changelogProblems', () => {
  it('accepts a well-formed changelog', () => {
    expect(changelogProblems(MD)).toEqual([]);
  });

  it('names what is wrong', () => {
    const bad = `# Changelog

## [1.0] - 16/10/2026

### Fixed stuff
- x

## [0.9.0] - 2026-01-01

### Bug fixes
- y

## [1.1.0] - 2026-11-02

## [1.0.0] - 2026-10-16
- a bullet outside any section
`;
    const problems = changelogProblems(bad);
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/1\.0.*not a version/i),
        expect.stringMatching(/release date.*16\/10\/2026/i),
        expect.stringMatching(/Fixed stuff.*section/i),
        expect.stringMatching(/1\.1\.0.*no changes/i),
        expect.stringMatching(/1\.1\.0 is newer than 0\.9\.0/i),
        expect.stringMatching(/outside a section/i),
      ]),
    );
  });
});

describe('versions', () => {
  it('compares and bumps Major.Minor.Patch', () => {
    expect(compareVersions('1.10.0', '1.9.3')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(bumpVersion('0.4.0', 'major')).toBe('1.0.0');
    expect(bumpVersion('1.2.3', 'minor')).toBe('1.3.0');
    expect(bumpVersion('1.2.3', 'patch')).toBe('1.2.4');
    expect(() => bumpVersion('1.2', 'patch')).toThrow(/version/i);
  });

  it('suggests the bump from what changed: breaking → major, new features → minor, else patch', () => {
    expect(suggestBump({ features: [], improvements: [], security: [], fixes: ['x'] })).toBe('patch');
    expect(suggestBump({ features: [], improvements: ['x'], security: ['y'], fixes: [] })).toBe('patch');
    expect(suggestBump({ features: ['x'], improvements: [], security: [], fixes: [] })).toBe('minor');
    expect(suggestBump({ features: [], improvements: ['BREAKING: the old API is gone'], security: [], fixes: [] })).toBe('major');
  });
});

describe('releaseChangelog', () => {
  it('turns the unreleased changes into the new version, dated, and opens a fresh Unreleased', () => {
    const out = releaseChangelog(MD, '1.2.0', '2026-12-01');
    const c = parseChangelog(out);
    expect(c.unreleased).toEqual({ features: [], improvements: [], security: [], fixes: [] });
    expect(c.releases[0]).toMatchObject({ version: '1.2.0', date: '2026-12-01', sections: { features: ['Keyboard shortcuts across the web app.'] } });
    expect(c.releases).toHaveLength(3);
    expect(out.indexOf('## [Unreleased]')).toBeLessThan(out.indexOf('## [1.2.0] - 2026-12-01'));
    expect(changelogProblems(out)).toEqual([]);
  });

  it('refuses a release with nothing in Unreleased, or a version that already exists', () => {
    const empty = releaseChangelog(MD, '1.2.0', '2026-12-01');
    expect(() => releaseChangelog(empty, '1.3.0', '2026-12-05')).toThrow(/nothing under \[Unreleased\]/i);
    expect(() => releaseChangelog(MD, '1.1.0', '2026-12-01')).toThrow(/already/i);
  });
});
