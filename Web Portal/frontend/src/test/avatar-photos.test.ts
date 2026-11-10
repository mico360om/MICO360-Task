import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

// Avatar hotfix (owner, 10 Nov: "Icon was not showing, fix it."): a face drawn for a known person passes
// their photo (`src=`), so the Avatar shows it and falls back to the initials only when there is none or
// it doesn't load. This guard reads the website's source: every `<Avatar …>` must pass `src`, unless it
// is listed below with the reason there is no person behind it (a typed name, say).
//
// The Client portal and the public client page are skipped on purpose: clients are never sent the
// team's photos (their payloads carry none), so a face there stays initials.

const SRC = resolve(__dirname, '..');
const CLIENT_FACING = [
  `components${sep}portal${sep}`,
  `pages${sep}portal${sep}`,
  `pages${sep}ClientViewPage.tsx`,
  // The public client page's inspection report.
  `components${sep}inspections${sep}ClientInspectionBody.tsx`,
  `api${sep}portal.ts`,
];

/** `<file>` → the tags (their first words, e.g. `<Avatar name={typed}`) that may go without `src`, and why. */
const NO_PERSON_BEHIND: Array<{ file: string; tag: RegExp; why: string }> = [];

/** The website's source files (no tests): `.tsx`, and with `withTs` the `.ts` files too. */
function sourceFiles(dir: string, withTs = false): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path, withTs);
    return (withTs ? /\.tsx?$/ : /\.tsx$/).test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/**
 * Each `<Avatar …>` opening tag in the text, whole (and a face drawn through PresenceAvatar, chat's
 * face with a live dot): braces, strings and arrows inside it are skipped.
 */
function avatarTags(text: string): string[] {
  const tags: string[] = [];
  const re = /<(?:Presence)?Avatar(?=[\s/>])/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    let depth = 0;
    let quote: string | null = null;
    let i = m.index + m[0].length;
    for (; i < text.length; i++) {
      const c = text[i]!;
      if (quote) {
        if (c === quote && text[i - 1] !== '\\') quote = null;
      } else if (c === '"' || c === "'" || c === '`') quote = c;
      else if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    tags.push(text.slice(m.index, i + 1));
  }
  return tags;
}

/** Passes a photo: `src={…}` with something in it (a bare `src={null}` or `src=""` is no photo). */
const passesSrc = (tag: string) => /\ssrc=\{(?!\s*(?:null|undefined)\s*\})/.test(tag);

describe('every face of a known person on the website passes their photo (avatar hotfix)', () => {
  const files = sourceFiles(SRC).filter((f) => !CLIENT_FACING.some((part) => relative(SRC, f).startsWith(part)));

  it('finds the faces (the scan works)', () => {
    const all = files.flatMap((f) => avatarTags(readFileSync(f, 'utf8')));
    expect(all.length).toBeGreaterThan(30);
    expect(avatarTags('<Avatar name={a.name} src={a.userId ? map.get(a.userId)?.avatarUrl : null} size="sm" />')).toEqual([
      '<Avatar name={a.name} src={a.userId ? map.get(a.userId)?.avatarUrl : null} size="sm" />',
    ]);
    expect(passesSrc('<Avatar name={a.name} size="sm" dense />')).toBe(false);
    expect(passesSrc('<Avatar name={a.name} src={null} />')).toBe(false);
    expect(passesSrc('<Avatar name={a.name} src="" />')).toBe(false);
    expect(avatarTags('<PresenceAvatar name={n} src={s} online />')).toHaveLength(1);
    expect(avatarTags('<AvatarStack people={p} />')).toHaveLength(0);
  });

  it('no `<Avatar name=…>` goes without `src` (allow-list: no person behind it)', () => {
    const missing: string[] = [];
    for (const f of files) {
      const rel = relative(SRC, f).split(sep).join('/');
      for (const tag of avatarTags(readFileSync(f, 'utf8'))) {
        if (passesSrc(tag)) continue;
        if (NO_PERSON_BEHIND.some((x) => x.file === rel && x.tag.test(tag))) continue;
        missing.push(`${rel}: ${tag.replace(/\s+/g, ' ')}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('the allow-list has no stale lines', () => {
    for (const x of NO_PERSON_BEHIND) {
      const tags = avatarTags(readFileSync(join(SRC, x.file), 'utf8'));
      expect(tags.some((t) => !passesSrc(t) && x.tag.test(t)), `${x.file} (${x.why})`).toBe(true);
    }
  });

  it('the client-facing pages never pass a photo (clients get none)', () => {
    const clientFiles = sourceFiles(SRC, true).filter((f) => CLIENT_FACING.some((part) => relative(SRC, f).startsWith(part)));
    expect(clientFiles.length).toBeGreaterThan(3);
    for (const f of clientFiles) {
      for (const tag of avatarTags(readFileSync(f, 'utf8'))) expect(passesSrc(tag), `${relative(SRC, f)}: ${tag}`).toBe(false);
      expect(readFileSync(f, 'utf8'), relative(SRC, f)).not.toMatch(/avatarUrl/);
    }
  });
});
