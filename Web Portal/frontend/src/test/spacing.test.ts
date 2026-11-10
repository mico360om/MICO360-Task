import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { SPACE } from '../lib/spacing';

/**
 * 1.23.8 Consistent spacing (lib/spacing.ts): one page header layout on every list page, one padding inside
 * cards, one gap between sections.
 */
const SRC = resolve(__dirname, '..');
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [p] : [];
  });
}
const rel = (p: string) => relative(SRC, p).replace(/\\/g, '/');

/** Pages with a header of their own, and why. */
const OWN_HEADER: Record<string, string> = {
  'pages/LoginPage.tsx': 'the sign-in card (no app shell)',
  'pages/ForgotPasswordPage.tsx': 'the sign-in card (no app shell)',
  'pages/ResetPasswordPage.tsx': 'the sign-in card (no app shell)',
  'pages/LegalPages.tsx': 'a public document',
  'pages/ClientViewPage.tsx': 'the client’s shared page (no app shell)',
  'pages/DashboardPage.tsx': 'the welcome band is its header',
  'pages/ProjectDetailPage.tsx': 'a project’s own header (picture, name, health, tabs)',
  'pages/MeetingDetailPage.tsx': 'a meeting’s own header',
  'pages/MeetingSeriesPage.tsx': 'a series’ own header',
  'pages/InspectionPage.tsx': 'an inspection’s own header',
  'pages/ChatPage.tsx': 'a window-tall conversation workspace',
  'pages/MicoAiPage.tsx': 'a window-tall conversation workspace',
};

describe('one page header layout (1.23.8)', () => {
  const pages = files(resolve(SRC, 'pages')).filter((p) => !rel(p).startsWith('pages/portal/'));
  it('every other page uses PageHeader (or its title, PageTitle, in a toolbar row of the same layout)', () => {
    const missing = pages.filter((p) => !OWN_HEADER[rel(p)] && !/<Page(Header|Title)\b/.test(readFileSync(p, 'utf8'))).map(rel);
    expect(missing).toEqual([]);
  });
  it('the list of pages with their own header is still true', () => {
    for (const page of Object.keys(OWN_HEADER)) expect(pages.map(rel), page).toContain(page);
  });
});

describe('one padding inside cards (1.23.8)', () => {
  it('cards use card-pad (16px on a phone, 20px from 640px), not a padding of their own', () => {
    // The Client portal too: its sections are the same cards as the team's.
    const own = files(SRC)
      .flatMap((p) => readFileSync(p, 'utf8').split(/\r?\n/).map((line, i) => [rel(p), i + 1, line] as const))
      .filter(([, , line]) => /\bcard p-[45]\b/.test(line) || line.includes('rounded-2xl border border-line bg-surface p-4 shadow-soft sm:p-6'))
      .map(([f, n]) => `${f}:${n}`);
    expect(own).toEqual([]);
    expect(SPACE.card).toBe('card-pad');
    const css = readFileSync(resolve(SRC, 'index.css'), 'utf8');
    expect(css).toMatch(/\.card-pad \{\s*@apply p-4 sm:p-5;/);
  });
});
