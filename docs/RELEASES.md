# Versions and releases

MICO360 Tasks has one release version for the server, the web portal and the Chrome extension, and
the Android app shares it when it changes; a release that changes only the website keeps the app's
own version (see *Website-only releases* below). It follows [Semantic Versioning](https://semver.org):
**Major.Minor.Patch**, e.g. v1.2.3.

| Release | When | Example |
| --- | --- | --- |
| **Major** | Something people or other systems rely on changes or goes away. Mark the entry `BREAKING:` | 1.4.2 → 2.0.0 |
| **Minor** | New features, nothing broken | 1.4.2 → 1.5.0 |
| **Patch** | Improvements, security fixes and bug fixes only | 1.4.2 → 1.4.3 |

## Where people see it

- **Every signed-in page's footer:** `Version: v1.0.0 | Last Updated: 16/10/2026, 08:17 PM (Oman Time)`.
  - The version is the deployed server's.
  - **Last Updated** is when that copy was built. On the live site the build runs at each
    deployment, so a redeploy updates it even when the version stays the same.
  - Both values come from the build (`Web Portal/backend/dist/src/release.json`), never from the
    browser's clock or from text typed into the page.
  - The time is shown in the company's time zone (Oman time).
- **About and version history** (footer link, profile menu, or search "version"): each release's new
  features, improvements and bug fixes.
  - Administrators also see its security fixes and the technical details of what is deployed: the
    server's and the web app's versions and build times, the code revision, the environment and the
    uptime, and whether server and web app are in step.
  - Other users only learn that a release included security updates. The details are removed on
    the server, so they are not in the page's code either.
- **The sidebar** shows the web app's version under the logo.

A page left open across a deployment notices it and offers **Reload**: when the window gets focus
again, and every five minutes. It does this by comparing the web app it runs with the
`build-info.json` deployed beside it. The server also serves a rebuilt web app at once, without a
restart.

## Making a release

1. While working, list each change under `## [Unreleased]` in [CHANGELOG.md](../CHANGELOG.md),
   in one of four sections:
   - `### New features`
   - `### Improvements`
   - `### Security` (administrators only)
   - `### Bug fixes`

   Write one bullet per change, in plain words for the people who use the system.
2. When releasing, run from the repository root:

   ```bash
   npm run release
   ```

   With no argument, it picks the level from the changes (BREAKING → major, new features → minor,
   else patch) and says which. To choose, pass `major`, `minor`, `patch` or an exact version
   (`npm run release -- minor`). Add `--dry-run` to see what would change, and `--commit` to commit
   and tag `vX.Y.Z` as well.

   The script:
   - refuses a release with nothing under [Unreleased];
   - dates the entry (Oman date) and opens a fresh [Unreleased];
   - writes the new version to every package and its lockfile, the extension manifest, the Android
     app (its version, and its build number plus one) and the Windows installer;
   - runs the release checks.
3. Commit and tag (or use `--commit`), push, then build and deploy as usual:
   - the live site: Redeploy in hPanel;
   - the packages: `tools/release/build-release.mjs` and `tools/release/build-apk.sh`.

### Website-only releases

When nothing under `Android App/` changed, release with `--web-only`
(`npm run release -- patch --web-only`). The Android app keeps its version and build number, so there
is no new app to build or sign.

Phones don't learn about releases from the website's version. The server reads the version written
inside the app file it offers at `/downloads/MICO360-Tasks.apk` (the downloads folder beside the
uploads, else the web build's copy) and sends it as `androidAppVersion` in `GET /api/v1/config`. The
app shows "A new version is available" only when that file is newer than itself. So after an app
release, upload its signed APK to the downloads folder as `MICO360-Tasks.apk`; until then nobody is
told to update. Apps from before 1.3.3 still compare with the server's version.

## What keeps it accurate

- `Web Portal/backend/src/modules/about/release-consistency.test.ts`, run with every backend test
  run, fails if:
  - any package, lockfile, manifest or the Windows installer carries a different version;
  - the Android app's files disagree with each other, or are ahead of the release (they may be
    behind it after website-only releases; the rule is in `release-versions.ts`);
  - CHANGELOG.md is malformed;
  - CHANGELOG.md's newest release isn't the current version.
- The server's build (`npm run build` → `postbuild`) writes `dist/src/release.json`, and refuses to
  build a version that CHANGELOG.md doesn't describe. The web app's build writes `build-info.json`
  and compiles in its version and build time.
- The footer's data is never cached:
  - the version API answers `Cache-Control: no-store`;
  - `build-info.json` and the start page are revalidated on every load;
  - the scripts and styles have content-hashed names, so a new build always loads.

The changelog rules (sections, version and date format, newest first) are in
`Web Portal/backend/src/modules/about/changelog.ts`. The server and the release script share that
file.

## Checked by

- **Unit tests:** `changelog.test.ts`, `about.test.ts` (endpoints and roles),
  `release-consistency.test.ts`, the web app's `release.test.ts`, `AppFooter.test.tsx` and
  `AboutPage.test.tsx`.
- **Browser test:** `D:/mico-release/audit-tools/version-e2e.mjs`, 21 checks:
  - the footer on ten pages, on a computer and a phone;
  - the chat page still fits the window;
  - the About page as an admin and as a regular user, with an accessibility check;
  - a stale copy;
  - a real redeployment, after which the open page notices it and, once reloaded, shows the new
    build time, also after an ordinary reload with the browser cache in play.
